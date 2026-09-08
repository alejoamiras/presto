//! `bb prove --scheme ultra_honk`: one Noir circuit, one witness, `proof` + `public_inputs` bytes.
//!
//! Shares everything with the chonk path except the inputs (gzipped ACIR, gzipped witness, optional
//! verification key) and the outputs (read from bb's JSON field arrays into their exact byte forms;
//! no field-count header; `public_inputs` may be empty; a `vk` comes back only when bb computed it).
//! bb 5.2.0 refuses to prove without a key file, so the key-less form is `--write_vk`, never
//! `--vk_policy recompute`.

use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use serde::de::{self, DeserializeSeed};

use super::{
    acquire_version_lease, create_prove_tempdir, find_bb, finish_command, read_capped, run_bb,
    validate_proof_len, write_witness, BbError, MAX_PROOF_BYTES, PROVE_TIMEOUT,
};
use crate::versions;

/// A verification key is a few KiB; anything past this is not a key.
const MAX_VK_BYTES: u64 = 64 * 1024;
/// Public inputs are 32-byte fields; even a circuit with thousands stays far under this.
const MAX_PUBLIC_INPUT_BYTES: u64 = 4 * 1024 * 1024;

/// bb's `--verifier_target` values. Parsed once at ingress so a client string never reaches argv.
/// The list mirrors bb's own, which is wider than what it proves: bb 5.2.0 refuses the starknet
/// pair as an invalid settings combination, surfaced to the caller as an ordinary `prove_failed`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum VerifierTarget {
    Evm,
    EvmNoZk,
    NoirRecursive,
    NoirRecursiveNoZk,
    NoirRollup,
    NoirRollupNoZk,
    Starknet,
    StarknetNoZk,
}

impl VerifierTarget {
    pub const ALL: [VerifierTarget; 8] = [
        Self::Evm,
        Self::EvmNoZk,
        Self::NoirRecursive,
        Self::NoirRecursiveNoZk,
        Self::NoirRollup,
        Self::NoirRollupNoZk,
        Self::Starknet,
        Self::StarknetNoZk,
    ];

    /// The exact spelling bb accepts after `-t`.
    pub fn as_flag(self) -> &'static str {
        match self {
            Self::Evm => "evm",
            Self::EvmNoZk => "evm-no-zk",
            Self::NoirRecursive => "noir-recursive",
            Self::NoirRecursiveNoZk => "noir-recursive-no-zk",
            Self::NoirRollup => "noir-rollup",
            Self::NoirRollupNoZk => "noir-rollup-no-zk",
            Self::Starknet => "starknet",
            Self::StarknetNoZk => "starknet-no-zk",
        }
    }

    /// ZK targets add prover randomness, so only the `-no-zk` family yields reproducible bytes.
    pub fn is_deterministic(self) -> bool {
        matches!(
            self,
            Self::EvmNoZk | Self::NoirRecursiveNoZk | Self::NoirRollupNoZk | Self::StarknetNoZk
        )
    }
}

/// The rejected string, so the 400 body can name it without echoing arbitrary length.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownVerifierTarget(pub String);

impl fmt::Display for UnknownVerifierTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown verifier_target {:?}", self.0)
    }
}

impl std::error::Error for UnknownVerifierTarget {}

impl FromStr for VerifierTarget {
    type Err = UnknownVerifierTarget;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|t| t.as_flag() == s)
            .ok_or_else(|| UnknownVerifierTarget(s.chars().take(64).collect()))
    }
}

impl fmt::Display for VerifierTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_flag())
    }
}

/// Validated inputs for one UltraHonk proof. `bytecode` and `witness` are the gzipped blobs exactly
/// as the Noir toolchain emits them (bb inflates them itself); `vk` skips bb's key recomputation.
/// Owned so the workspace writes can run on a blocking worker.
#[derive(Clone, Debug)]
pub struct UltraHonkJob {
    pub bytecode: Vec<u8>,
    pub witness: Vec<u8>,
    pub vk: Option<Vec<u8>>,
    pub target: VerifierTarget,
}

/// Raw bb outputs. `vk` is present only when the job carried no key (bb ran `--write_vk`).
#[derive(Debug, PartialEq, Eq)]
pub struct UltraHonkOutput {
    pub proof: Vec<u8>,
    pub public_inputs: Vec<u8>,
    pub vk: Option<Vec<u8>>,
}

/// The three stages of one proof — write the workspace, run bb, read the outputs — as a single call.
/// The two file stages run on blocking workers; a caller that must keep admission guards alive
/// across them (the HTTP handler) drives the stages itself so the guards travel with the work.
pub async fn prove_ultra_honk(
    job: UltraHonkJob,
    version: Option<&versions::AztecVersion>,
    threads: Option<usize>,
) -> Result<UltraHonkOutput, BbError> {
    prove_ultra_honk_with_timeout(job, version, threads, PROVE_TIMEOUT).await
}

/// [`prove_ultra_honk`] with the timeout injected so tests can exercise the kill path quickly.
pub(super) async fn prove_ultra_honk_with_timeout(
    job: UltraHonkJob,
    version: Option<&versions::AztecVersion>,
    threads: Option<usize>,
    timeout: Duration,
) -> Result<UltraHonkOutput, BbError> {
    let target = job.target;
    let workspace = blocking(move || UltraHonkWorkspace::create(&job)).await?;
    run_ultra_honk_with_timeout(&workspace, target, version, threads, timeout, None).await?;
    blocking(move || read_outputs(&workspace)).await
}

/// Run bb over a prepared workspace; notifying `cancel` kills the tree and the call returns once the
/// child is reaped (see [`super::prove_cancellable`]). The caller owns the workspace.
pub(crate) async fn run_ultra_honk(
    workspace: &UltraHonkWorkspace,
    target: VerifierTarget,
    version: Option<&versions::AztecVersion>,
    threads: Option<usize>,
    cancel: super::Cancel,
) -> Result<(), BbError> {
    run_ultra_honk_with_timeout(
        workspace,
        target,
        version,
        threads,
        PROVE_TIMEOUT,
        Some(cancel),
    )
    .await
}

async fn run_ultra_honk_with_timeout(
    workspace: &UltraHonkWorkspace,
    target: VerifierTarget,
    version: Option<&versions::AztecVersion>,
    threads: Option<usize>,
    timeout: Duration,
    cancel: Option<super::Cancel>,
) -> Result<(), BbError> {
    // Same lease discipline as the chonk path: held across the whole run so an eviction cannot
    // unlink the binary between resolution and execution.
    let _lease = acquire_version_lease(version)?;
    let bb_path = find_bb(version).map_err(|e| -> BbError { e.into() })?;
    tracing::info!(
        version = version.map_or("bundled", |v| v.as_str()),
        ?threads,
        %target,
        client_vk = workspace.vk_path.is_some(),
        "Starting bb prove (ultra_honk)"
    );
    let mut cmd = build_ultra_honk_command(&bb_path, workspace, target, threads)?;
    run_bb(&mut cmd, timeout, cancel).await
}

async fn blocking<T: Send + 'static, E: Into<BbError> + Send + 'static>(
    work: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, BbError> {
    match tokio::task::spawn_blocking(work).await {
        Ok(result) => result.map_err(Into::into),
        Err(join) => Err(format!("prove workspace worker failed: {join}").into()),
    }
}

/// Private 0700 tempdir holding the three input files (0600) and bb's output directory. Writing it
/// is tens of MiB of I/O, so it is created on a blocking worker.
pub(crate) struct UltraHonkWorkspace {
    _dir: tempfile::TempDir,
    bytecode_path: PathBuf,
    witness_path: PathBuf,
    /// The client's key on disk, when bb is given one.
    vk_path: Option<PathBuf>,
    /// Whether the job carried a key: the response never echoes one, computed or not.
    client_key: bool,
    output_dir: PathBuf,
}

/// bb.exe 5.2.0 reads the `-k` file in text mode: it stops at the first 0x1A byte (a 3680-byte key
/// came back as 983) and would fold CRLF. Bytecode and witness are read in binary mode. So on Windows
/// a client key is set aside and bb recomputes it: a proof for the same circuit, under the true key.
const BB_READS_KEY_IN_TEXT_MODE: bool = cfg!(windows);

impl UltraHonkWorkspace {
    pub(crate) fn create(job: &UltraHonkJob) -> std::io::Result<Self> {
        let dir = create_prove_tempdir()?;
        let bytecode_path = dir.path().join("bytecode.gz");
        let witness_path = dir.path().join("witness.gz");
        let output_dir = dir.path().join("output");
        std::fs::create_dir_all(&output_dir)?;
        write_witness(&bytecode_path, &job.bytecode)?;
        write_witness(&witness_path, &job.witness)?;
        let vk_path = match &job.vk {
            Some(_) if BB_READS_KEY_IN_TEXT_MODE => {
                tracing::info!("Client key set aside: this bb reads key files in text mode");
                None
            }
            Some(vk) => {
                let path = dir.path().join("vk");
                write_witness(&path, vk)?;
                Some(path)
            }
            None => None,
        };
        Ok(Self {
            _dir: dir,
            bytecode_path,
            witness_path,
            vk_path,
            client_key: job.vk.is_some(),
            output_dir,
        })
    }
}

fn utf8(path: &Path) -> Result<&str, BbError> {
    path.to_str()
        .ok_or_else(|| "temp path contains non-UTF-8 characters".into())
}

fn build_ultra_honk_command(
    bb_path: &Path,
    workspace: &UltraHonkWorkspace,
    target: VerifierTarget,
    threads: Option<usize>,
) -> Result<tokio::process::Command, BbError> {
    let mut command = tokio::process::Command::new(bb_path);
    command.args([
        "prove",
        "--scheme",
        "ultra_honk",
        "--output_format",
        "json",
        "-b",
        utf8(&workspace.bytecode_path)?,
        "-w",
        utf8(&workspace.witness_path)?,
        "-t",
        target.as_flag(),
        "-o",
        utf8(&workspace.output_dir)?,
    ]);
    match &workspace.vk_path {
        Some(vk) => {
            command.args(["-k", utf8(vk)?]);
        }
        None => {
            command.arg("--write_vk");
        }
    }
    finish_command(&mut command, threads);
    Ok(command)
}

/// Whole 32-byte fields under the cap; unlike a proof, zero public inputs is a valid circuit.
fn validate_public_inputs_len(len: u64) -> Result<(), BbError> {
    if len > MAX_PUBLIC_INPUT_BYTES {
        return Err(format!(
            "bb public_inputs file is {len} bytes, exceeding the {MAX_PUBLIC_INPUT_BYTES}-byte cap"
        )
        .into());
    }
    if !len.is_multiple_of(32) {
        return Err(format!(
            "bb public_inputs is not a whole number of 32-byte fields ({len} bytes)"
        )
        .into());
    }
    Ok(())
}

fn validate_vk_len(len: u64) -> Result<(), BbError> {
    if len == 0 {
        return Err("bb reported success but produced an empty vk file".into());
    }
    if len > MAX_VK_BYTES {
        return Err(
            format!("bb vk file is {len} bytes, exceeding the {MAX_VK_BYTES}-byte cap").into(),
        );
    }
    Ok(())
}

/// One bb output as bytes, from its JSON form `{"<name>": ["0x<64 hex>", …], …}` — the fields are
/// the exact bytes of the binary form. JSON is requested on every platform because bb.exe 5.2.0
/// writes files in text mode, which corrupts binary output and leaves hex text intact. The file is
/// named on failure (a missing `public_inputs.json` is otherwise an anonymous "No such file").
fn read_fields(workspace: &UltraHonkWorkspace, name: &str, cap: u64) -> Result<Vec<u8>, BbError> {
    // Each 32-byte field is 69 JSON bytes; the file cap follows the byte cap plus metadata headroom.
    let json_cap = cap * 3 + 1024;
    let text = read_capped(&workspace.output_dir.join(format!("{name}.json")), json_cap)
        .map_err(|e| format!("bb output {name}.json: {e}"))?;
    if text.len() as u64 > json_cap {
        return Err(format!("bb output {name}.json exceeds {json_cap} bytes").into());
    }
    parse_fields(&text, name, cap / 32).map_err(|e| format!("bb output {name}.json: {e}").into())
}

/// Stream `{"<name>": ["0x<64 hex>", …], …}` into bytes without building a value tree: each element
/// is validated as it arrives and the count is capped, so a malformed file cannot cost more memory
/// than its byte cap. Other keys are skipped; trailing content is rejected.
fn parse_fields(text: &[u8], name: &str, max_fields: u64) -> Result<Vec<u8>, String> {
    let mut de = serde_json::Deserializer::from_slice(text);
    let bytes = FieldsSeed { name, max_fields }
        .deserialize(&mut de)
        .map_err(|e| e.to_string())?;
    de.end().map_err(|e| e.to_string())?;
    Ok(bytes)
}

struct FieldsSeed<'a> {
    name: &'a str,
    max_fields: u64,
}

impl<'de> de::DeserializeSeed<'de> for FieldsSeed<'_> {
    type Value = Vec<u8>;

    fn deserialize<D: de::Deserializer<'de>>(self, d: D) -> Result<Vec<u8>, D::Error> {
        d.deserialize_map(self)
    }
}

impl<'de> de::Visitor<'de> for FieldsSeed<'_> {
    type Value = Vec<u8>;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "an object with a {:?} array", self.name)
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<Vec<u8>, A::Error> {
        let mut found = None;
        while let Some(key) = map.next_key::<String>()? {
            if key != self.name {
                map.next_value::<de::IgnoredAny>()?;
            } else if found.is_some() {
                return Err(de::Error::custom(format!("duplicate {:?} key", self.name)));
            } else {
                found = Some(map.next_value_seed(FieldArray(self.max_fields))?);
            }
        }
        found.ok_or_else(|| de::Error::custom(format!("no {:?} array", self.name)))
    }
}

struct FieldArray(u64);

impl<'de> de::DeserializeSeed<'de> for FieldArray {
    type Value = Vec<u8>;

    fn deserialize<D: de::Deserializer<'de>>(self, d: D) -> Result<Vec<u8>, D::Error> {
        d.deserialize_seq(self)
    }
}

impl<'de> de::Visitor<'de> for FieldArray {
    type Value = Vec<u8>;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("an array of 0x-prefixed 32-byte hex fields")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<u8>, A::Error> {
        let mut bytes = Vec::new();
        let mut count: u64 = 0;
        while let Some(field) = seq.next_element::<String>()? {
            if count >= self.0 {
                return Err(de::Error::custom(format!("more than {} fields", self.0)));
            }
            let decoded = field
                .strip_prefix("0x")
                .filter(|h| h.len() == 64)
                .and_then(|h| hex::decode(h).ok())
                .ok_or_else(|| {
                    de::Error::custom(format!("field {count} is not a 32-byte hex field"))
                })?;
            bytes.extend_from_slice(&decoded);
            count += 1;
        }
        Ok(bytes)
    }
}

/// Read and validate bb's output files; blocking, so callers run it on a worker.
pub(crate) fn read_outputs(workspace: &UltraHonkWorkspace) -> Result<UltraHonkOutput, BbError> {
    let proof = read_fields(workspace, "proof", MAX_PROOF_BYTES)?;
    validate_proof_len(proof.len() as u64)?;
    let public_inputs = read_fields(workspace, "public_inputs", MAX_PUBLIC_INPUT_BYTES)?;
    validate_public_inputs_len(public_inputs.len() as u64)?;
    let vk = if workspace.client_key {
        None
    } else {
        let vk = read_fields(workspace, "vk", MAX_VK_BYTES)?;
        validate_vk_len(vk.len() as u64)?;
        Some(vk)
    };
    tracing::debug!(
        proof_bytes = proof.len(),
        public_input_bytes = public_inputs.len(),
        "bb prove (ultra_honk) completed"
    );
    Ok(UltraHonkOutput {
        proof,
        public_inputs,
        vk,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_targets_round_trip_bb_spellings_and_reject_unknown_ones() {
        for target in VerifierTarget::ALL {
            assert_eq!(target.as_flag().parse::<VerifierTarget>().unwrap(), target);
            assert_eq!(target.to_string(), target.as_flag());
            assert_eq!(
                target.is_deterministic(),
                target.as_flag().ends_with("-no-zk")
            );
        }
        let err = "noir_recursive".parse::<VerifierTarget>().unwrap_err();
        assert_eq!(err, UnknownVerifierTarget("noir_recursive".into()));
        let long = "x".repeat(200).parse::<VerifierTarget>().unwrap_err();
        assert_eq!(long.0.len(), 64, "the rejected spelling is truncated");
    }

    #[test]
    fn json_fields_are_streamed_validated_and_bounded() {
        let field = format!("\"0x{}\"", "ab".repeat(32));
        let two = format!("{{\"proof\":[{field},{field}],\"bb_version\":\"x\",\"scheme\":{{}}}}");
        assert_eq!(
            parse_fields(two.as_bytes(), "proof", 2).unwrap(),
            [0xab; 64].to_vec()
        );
        assert_eq!(
            parse_fields(b"{\"public_inputs\":[]}", "public_inputs", 0).unwrap(),
            b""
        );
        let err = |json: &str, max| parse_fields(json.as_bytes(), "proof", max).unwrap_err();
        assert!(err(&two, 1).contains("more than 1 fields"));
        assert!(err("{\"proof\":[0]}", 2).contains("expected a string"));
        assert!(err("{\"proof\":[\"0x00\"]}", 2).contains("field 0 is not a 32-byte hex field"));
        assert!(err("{\"vk\":[]}", 2).contains("no \"proof\" array"));
        assert!(err(&format!("{two}{two}"), 2).contains("trailing"));
        assert!(err(&format!("{{\"proof\":[],\"proof\":[{field}]}}"), 2).contains("duplicate"));
    }

    #[test]
    fn output_length_rules_allow_empty_public_inputs_but_not_empty_keys() {
        assert!(validate_public_inputs_len(0).is_ok());
        assert!(validate_public_inputs_len(64).is_ok());
        assert!(validate_public_inputs_len(33).is_err());
        assert!(validate_public_inputs_len(MAX_PUBLIC_INPUT_BYTES + 32).is_err());
        assert!(validate_vk_len(0).is_err());
        assert!(validate_vk_len(3680).is_ok());
        assert!(validate_vk_len(MAX_VK_BYTES + 1).is_err());
    }

    fn job(vk: Option<&[u8]>) -> UltraHonkJob {
        UltraHonkJob {
            bytecode: b"acir".to_vec(),
            witness: b"witness".to_vec(),
            vk: vk.map(<[u8]>::to_vec),
            target: VerifierTarget::NoirRecursiveNoZk,
        }
    }

    fn argv(cmd: &tokio::process::Command) -> Vec<String> {
        cmd.as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn command_carries_k_for_a_client_key_and_write_vk_without_one() {
        let bb = Path::new("/bin/true");
        let with_key = UltraHonkWorkspace::create(&job(Some(b"vk"))).unwrap();
        let args =
            argv(&build_ultra_honk_command(bb, &with_key, VerifierTarget::Evm, Some(4)).unwrap());
        assert_eq!(
            &args[..5],
            ["prove", "--scheme", "ultra_honk", "--output_format", "json"]
        );
        assert_eq!(args[9], "-t");
        assert_eq!(args[10], "evm");
        assert!(with_key.client_key);
        if BB_READS_KEY_IN_TEXT_MODE {
            assert!(
                with_key.vk_path.is_none(),
                "the key is set aside, not written"
            );
            assert_eq!(args.last().map(String::as_str), Some("--write_vk"));
        } else {
            assert_eq!(args[13], "-k");
            assert_eq!(
                Path::new(&args[14]).file_name(),
                Some(std::ffi::OsStr::new("vk"))
            );
            assert!(!args.iter().any(|a| a == "--write_vk"));
        }

        let without = UltraHonkWorkspace::create(&job(None)).unwrap();
        let cmd =
            build_ultra_honk_command(bb, &without, VerifierTarget::NoirRollupNoZk, None).unwrap();
        let args = argv(&cmd);
        assert_eq!(args.last().map(String::as_str), Some("--write_vk"));
        assert!(!args.iter().any(|a| a == "-k"));
        assert!(without.vk_path.is_none());
        let envs: Vec<_> = cmd.as_std().get_envs().collect();
        assert!(
            envs.is_empty(),
            "no HARDWARE_CONCURRENCY without a thread cap: {envs:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn workspace_files_are_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let ws = UltraHonkWorkspace::create(&job(Some(b"vk"))).unwrap();
        for path in [
            &ws.bytecode_path,
            &ws.witness_path,
            ws.vk_path.as_ref().unwrap(),
        ] {
            let mode = std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{}", path.display());
        }
        assert_eq!(std::fs::read(&ws.bytecode_path).unwrap(), b"acir");
    }

    // ── end to end through a fake bb (same harness as the chonk tests) ──

    #[cfg(unix)]
    use super::super::test_support::{install_fake_bb, FIND_OUTDIR};
    #[cfg(unix)]
    use serial_test::serial;

    /// Shell prelude for a fake bb: `$out` from `-o`, `$f` one zero field in JSON form.
    #[cfg(unix)]
    const FIELD: &str = "f=\"\\\"0x$(printf '%064d' 0)\\\"\"";

    /// A fake bb that writes JSON outputs: a two-field proof, `public_input_fields` public inputs,
    /// and a one-field vk when asked.
    #[cfg(unix)]
    fn fake_prover(public_input_fields: usize) -> String {
        format!(
            "{FIND_OUTDIR}\n{FIELD}\nprintf '{{\"proof\":[%s,%s]}}' \"$f\" \"$f\" > \"$out/proof.json\"\npubs=\"\"; i=0; while [ $i -lt {public_input_fields} ]; do pubs=\"$pubs${{pubs:+,}}$f\"; i=$((i+1)); done\nprintf '{{\"public_inputs\":[%s]}}' \"$pubs\" > \"$out/public_inputs.json\"\nfor a in \"$@\"; do [ \"$a\" = --write_vk ] && printf '{{\"vk\":[%s]}}' \"$f\" > \"$out/vk.json\"; done\ntrue"
        )
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn returns_raw_outputs_and_the_key_only_when_bb_computed_it() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = install_fake_bb(dir.path(), &fake_prover(1));

        let with_key = prove_ultra_honk(job(Some(b"vk")), None, None)
            .await
            .unwrap();
        assert_eq!(
            with_key.proof.len(),
            64,
            "two fields, no field-count header"
        );
        assert_eq!(with_key.public_inputs.len(), 32);
        assert_eq!(with_key.vk, None);

        let without = prove_ultra_honk(job(None), None, None).await.unwrap();
        assert_eq!(without.vk.as_deref(), Some([0u8; 32].as_slice()));
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn accepts_empty_public_inputs_but_rejects_missing_or_malformed_outputs() {
        let dir = tempfile::tempdir().unwrap();
        {
            let _guard = install_fake_bb(dir.path(), &fake_prover(0));
            let out = prove_ultra_honk(job(Some(b"vk")), None, None)
                .await
                .unwrap();
            assert!(out.public_inputs.is_empty());
        }
        {
            // A field that is not 32 bytes: the binary form would be misaligned.
            let _guard = install_fake_bb(
                dir.path(),
                &format!("{FIND_OUTDIR}\n{FIELD}\nprintf '{{\"proof\":[%s]}}' \"$f\" > \"$out/proof.json\"\nprintf '{{\"public_inputs\":[\"0x00\"]}}' > \"$out/public_inputs.json\""),
            );
            let err = prove_ultra_honk(job(Some(b"vk")), None, None)
                .await
                .unwrap_err();
            let text = err.to_string();
            assert!(
                text.contains("public_inputs.json") && text.contains("field 0 is not a 32-byte"),
                "got: {err}"
            );
        }
        {
            let _guard = install_fake_bb(
                dir.path(),
                &format!("{FIND_OUTDIR}\n{FIELD}\nprintf '{{\"proof\":[%s]}}' \"$f\" > \"$out/proof.json\""),
            );
            let err = prove_ultra_honk(job(Some(b"vk")), None, None)
                .await
                .unwrap_err();
            assert!(err.to_string().contains("public_inputs.json"), "got: {err}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    #[serial]
    async fn rejects_an_empty_key_and_times_out_a_hung_bb() {
        let dir = tempfile::tempdir().unwrap();
        {
            let _guard = install_fake_bb(
                dir.path(),
                &format!("{FIND_OUTDIR}\n{FIELD}\nprintf '{{\"proof\":[%s]}}' \"$f\" > \"$out/proof.json\"\nprintf '{{\"public_inputs\":[]}}' > \"$out/public_inputs.json\"\nprintf '{{\"vk\":[]}}' > \"$out/vk.json\""),
            );
            let err = prove_ultra_honk(job(None), None, None).await.unwrap_err();
            assert!(err.to_string().contains("empty vk"), "got: {err}");
        }
        {
            let _guard = install_fake_bb(dir.path(), "sleep 30");
            let err =
                prove_ultra_honk_with_timeout(job(None), None, None, Duration::from_millis(150))
                    .await
                    .unwrap_err();
            assert!(err.to_string().contains("timed out"), "got: {err}");
        }
    }
}
