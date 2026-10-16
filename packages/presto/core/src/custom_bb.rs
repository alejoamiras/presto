//! Developer mode's custom bb: one user-chosen file, pinned by canonical path and SHA-256, that
//! answers exactly one version label. Everything here is static inspection except [`test_run`],
//! which executes the file once under proof containment.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::bb::{AdmitGuard, SpawnGate};
use crate::config::ConfigStore;
use crate::versions::{self, AztecVersion, VersionRejection};

mod binary_format;
mod path_policy;

const TEST_RUN_TIMEOUT: Duration = Duration::from_secs(5);
const TEST_RUN_OUTPUT_CAP: usize = 4 * 1024;
const EXCERPT_CHARS: usize = 300;

/// The persisted pin. `path` is canonical, so no component is a symlink; `sha256` is lowercase hex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CustomBbPin {
    pub path: PathBuf,
    pub sha256: String,
    #[serde(serialize_with = "serialize_label")]
    pub label: AztecVersion,
    /// Unix seconds.
    pub pinned_at: i64,
}

fn serialize_label<S: serde::Serializer>(label: &AztecVersion, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(label.as_str())
}

/// Field-level deserializer: a malformed record loads as `None` (logged) instead of failing the
/// whole config into read-only defaults. A revoked label still loads, so Settings can say so.
pub fn de_custom_bb<'de, D>(d: D) -> Result<Option<CustomBbPin>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let Some(value) = Option::<serde_json::Value>::deserialize(d)? else {
        return Ok(None);
    };
    match pin_from_value(&value) {
        Ok(pin) => Ok(Some(pin)),
        Err(field) => {
            tracing::warn!(field, "Dropped a malformed custom bb record on load");
            Ok(None)
        }
    }
}

fn pin_from_value(value: &serde_json::Value) -> Result<CustomBbPin, &'static str> {
    let text = |key| value.get(key).and_then(serde_json::Value::as_str);
    let path = text("path")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .ok_or("path")?;
    let sha256 = text("sha256")
        .filter(|s| versions::is_hex64(s))
        .ok_or("sha256")?
        .to_string();
    let label = text("label")
        .and_then(|l| label_against(l, &[]).ok())
        .ok_or("label")?;
    let pinned_at = value
        .get("pinned_at")
        .and_then(serde_json::Value::as_i64)
        .ok_or("pinned_at")?;
    Ok(CustomBbPin {
        path,
        sha256,
        label,
        pinned_at,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LabelError {
    /// Fails the gate every `x-aztec-version` request passes, so no request could ever select it.
    Version(VersionRejection),
    /// A hyphen inside the prerelease part: presto-noir's `bbVersion` check refuses it.
    NotNoirCompatible,
}

impl LabelError {
    pub fn reason(self) -> &'static str {
        match self {
            Self::Version(rejection) => rejection.reason(),
            Self::NotNoirCompatible => {
                "has a hyphen inside its prerelease part, which presto-noir refuses"
            }
        }
    }
}

/// The labels a request can select: the request gate (canonical semver, no build metadata, not
/// revoked) intersected with presto-noir's `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$`.
pub fn check_label(raw: &str) -> Result<AztecVersion, LabelError> {
    label_against(raw, versions::KNOWN_VULNERABLE_VERSIONS)
}

fn label_against(raw: &str, revoked: &[&str]) -> Result<AztecVersion, LabelError> {
    versions::check_version_against(raw, revoked).map_err(LabelError::Version)?;
    let noir_compatible = raw.split_once('-').is_none_or(|(_, prerelease)| {
        prerelease
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.')
    });
    if !noir_compatible {
        return Err(LabelError::NotNoirCompatible);
    }
    AztecVersion::parse(raw).ok_or(LabelError::Version(VersionRejection::NotSemver))
}

/// Why a picked file cannot be pinned, worded for Settings. `fix` is a command the user can copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub code: RefusalCode,
    pub message: String,
    pub fix: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    Unreadable,
    UnsupportedPath,
    NotRegularFile,
    NotExecutable,
    WrongFormat,
    WrongArchitecture,
    ForeignOwner,
    WritableByOthers,
    AclGrantsWrite,
    OutsideProfile,
    Quarantined,
    Unsigned,
}

impl Refusal {
    fn new(code: RefusalCode, message: String, fix: Option<String>) -> Self {
        Self { code, message, fix }
    }

    fn unreadable(path: &Path, e: &std::io::Error) -> Self {
        Self::new(
            RefusalCode::Unreadable,
            format!("Presto could not read {}: {e}", display_path(path)),
            None,
        )
    }
}

/// What Settings shows before the user ticks "I trust this file".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Inspection {
    pub path: PathBuf,
    pub sha256: String,
    pub size: u64,
    pub warnings: Vec<String>,
}

/// Check a picked file without executing it: canonical path, regular file, Presto's own format and
/// architecture, executable, the path policy, and on macOS quarantine and (arm64) an embedded
/// code signature, present rather than valid: the test run shows whether it lets the file start.
/// Blocking: it hashes the whole file.
pub fn inspect(picked: &Path) -> Result<Inspection, Refusal> {
    let path = std::fs::canonicalize(picked).map_err(|e| Refusal::unreadable(picked, &e))?;
    if path.to_str().is_none() {
        return Err(Refusal::new(
            RefusalCode::UnsupportedPath,
            "Presto can only pin a file whose path is valid Unicode.".to_string(),
            None,
        ));
    }
    let meta = std::fs::metadata(&path).map_err(|e| Refusal::unreadable(&path, &e))?;
    if !meta.is_file() {
        return Err(Refusal::new(
            RefusalCode::NotRegularFile,
            format!("{} is not a regular file.", display_path(&path)),
            None,
        ));
    }
    binary_format::check_host(&path)?;
    check_executable(&path, &meta)?;
    path_policy::check(&path)?;
    os_gates(&path)?;
    let sha256 = versions::sha256_file(&path).map_err(|e| Refusal::unreadable(&path, &e))?;
    Ok(Inspection {
        warnings: os_warnings(&path),
        size: meta.len(),
        sha256,
        path,
    })
}

#[cfg(unix)]
fn check_executable(path: &Path, meta: &std::fs::Metadata) -> Result<(), Refusal> {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 != 0 {
        return Ok(());
    }
    Err(Refusal::new(
        RefusalCode::NotExecutable,
        format!("{} is not marked executable.", display_path(path)),
        Some(format!("chmod +x {}", shell_quote(path))),
    ))
}

#[cfg(not(unix))]
fn check_executable(_path: &Path, _meta: &std::fs::Metadata) -> Result<(), Refusal> {
    Ok(())
}

/// Presto refuses rather than clears these: clearing quarantine or re-signing a stranger's file is
/// a Gatekeeper bypass the user should choose with their own hands.
#[cfg(target_os = "macos")]
fn os_gates(path: &Path) -> Result<(), Refusal> {
    use std::os::unix::ffi::OsStrExt;
    let cpath = std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|e| Refusal::unreadable(path, &std::io::Error::from(e)))?;
    let quarantined = unsafe {
        libc::getxattr(
            cpath.as_ptr(),
            c"com.apple.quarantine".as_ptr(),
            std::ptr::null_mut(),
            0,
            0,
            libc::XATTR_NOFOLLOW,
        )
    } >= 0;
    if quarantined {
        return Err(Refusal::new(
            RefusalCode::Quarantined,
            "macOS marks this file as downloaded, so it will refuse to run it.".to_string(),
            Some(format!(
                "xattr -d com.apple.quarantine {}",
                shell_quote(path)
            )),
        ));
    }
    // Intel Macs run unsigned code; Apple silicon kills an unsigned binary at exec. Presence is the
    // question, not `codesign --verify`'s verdict: the kernel accepts signatures Security.framework
    // calls unsigned (see `binary_format::has_code_signature`), and the test run lets it judge.
    #[cfg(target_arch = "aarch64")]
    {
        let signed =
            binary_format::has_code_signature(path).map_err(|e| Refusal::unreadable(path, &e))?;
        if !signed {
            return Err(Refusal::new(
                RefusalCode::Unsigned,
                "This file has no code signature, so Apple silicon will refuse to run it."
                    .to_string(),
                Some(format!("codesign --force --sign - {}", shell_quote(path))),
            ));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn os_gates(_path: &Path) -> Result<(), Refusal> {
    Ok(())
}

/// Mark-of-the-Web only warns: SmartScreen does not gate `CreateProcess`, and clearing the mark is
/// never promised to make a blocked file run.
#[cfg(windows)]
fn os_warnings(path: &Path) -> Vec<String> {
    let mut stream = path.as_os_str().to_os_string();
    stream.push(":Zone.Identifier");
    if std::fs::metadata(&stream).is_ok() {
        vec!["Windows marks this file as downloaded from the internet.".to_string()]
    } else {
        Vec::new()
    }
}

#[cfg(not(windows))]
fn os_warnings(_path: &Path) -> Vec<String> {
    Vec::new()
}

/// Why a pinned file may not run now. Wire responses never carry this detail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unavailable {
    /// Gone, or unreadable.
    Missing,
    /// Different bytes, or no longer the same canonical regular file.
    Changed,
    /// Another account could now change it.
    Unsafe(Refusal),
    /// Stopped, re-pinned, overridden, or developer mode turned off before it started.
    Withdrawn,
}

impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => f.write_str("the pinned file is missing or unreadable"),
            Self::Changed => f.write_str("the pinned file changed since it was trusted"),
            Self::Unsafe(refusal) => f.write_str(&refusal.message),
            Self::Withdrawn => {
                f.write_str("the custom bb was stopped or replaced before it started")
            }
        }
    }
}

impl std::error::Error for Unavailable {}

/// The check right before every spawn: same canonical regular file, the path policy, and the
/// pinned hash. Blocking. The same-user swap between this hash and the exec is a known limit.
pub fn verify_for_spawn(pin: &CustomBbPin) -> Result<PathBuf, Unavailable> {
    verify_file(&pin.path, &pin.sha256)?;
    Ok(pin.path.clone())
}

fn verify_file(path: &Path, sha256: &str) -> Result<(), Unavailable> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| missing(path, &e))?;
    if !meta.file_type().is_file() {
        return Err(Unavailable::Changed);
    }
    if std::fs::canonicalize(path).ok().as_deref() != Some(path) {
        return Err(Unavailable::Changed);
    }
    path_policy::check(path).map_err(Unavailable::Unsafe)?;
    match versions::sha256_file(path) {
        Ok(actual) if actual == sha256 => Ok(()),
        Ok(_) => Err(Unavailable::Changed),
        Err(e) => Err(missing(path, &e)),
    }
}

fn missing(path: &Path, e: &std::io::Error) -> Unavailable {
    if e.kind() != std::io::ErrorKind::NotFound {
        tracing::warn!(path = %path.display(), error = %e, "Custom bb unreadable");
    }
    Unavailable::Missing
}

/// A request naming the label runs the pinned file, admitted only while that pin is still the
/// custom bb in effect.
pub(crate) struct CustomRoute {
    pin: CustomBbPin,
    config: Arc<ConfigStore>,
}

impl CustomRoute {
    pub(crate) fn new(pin: CustomBbPin, config: Arc<ConfigStore>) -> Self {
        Self { pin, config }
    }
}

impl SpawnGate for CustomRoute {
    fn path(&self) -> &Path {
        &self.pin.path
    }

    fn verify(&self) -> Result<(), Unavailable> {
        verify_for_spawn(&self.pin).map(drop)
    }

    fn admit(&self) -> Result<Box<dyn AdmitGuard + '_>, Unavailable> {
        if env_override_active() {
            return Err(Unavailable::Withdrawn);
        }
        let held = self
            .config
            .hold_custom_bb(&self.pin)
            .ok_or(Unavailable::Withdrawn)?;
        Ok(Box::new(held))
    }
}

/// What Settings shows about recent use. Memory only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CustomBbActivity {
    /// Unix seconds of the last proof the custom bb produced.
    pub last_proof_at: Option<i64>,
    pub last_failure: Option<CustomBbFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CustomBbFailure {
    pub at: i64,
    /// Local detail (may name paths); never sent to a site.
    pub detail: String,
}

impl CustomBbActivity {
    pub(crate) fn record(&mut self, outcome: Result<(), String>) {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        match outcome {
            Ok(()) => self.last_proof_at = Some(at),
            Err(detail) => self.last_failure = Some(CustomBbFailure { at, detail }),
        }
    }
}

/// The result of one `bb --version`: a label suggestion only when its output passes
/// [`check_label`] (a local build may print a placeholder), and a short excerpt for display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestRun {
    pub version_suggestion: Option<AztecVersion>,
    pub excerpt: String,
}

#[derive(Debug)]
pub enum TestRunError {
    /// A proof holds the prove permit.
    Busy,
    Unavailable(Unavailable),
    /// The OS refused to start the file.
    WontStart(String),
    /// It ran past the time limit and was killed.
    TimedOut,
    /// It exited unsuccessfully.
    Failed(String),
    /// Presto could not set the run up.
    Internal(String),
}

impl std::fmt::Display for TestRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => f.write_str("A proof is running. Try again when it finishes."),
            Self::Unavailable(why) => write!(f, "Not run: {why}."),
            Self::WontStart(why) => write!(f, "It did not start: {why}."),
            Self::TimedOut => write!(
                f,
                "It did not exit within {} seconds and was stopped.",
                TEST_RUN_TIMEOUT.as_secs()
            ),
            Self::Failed(status) => write!(f, "It exited with an error ({status})."),
            Self::Internal(why) => write!(f, "Presto could not run it: {why}."),
        }
    }
}

/// The prove permit, without waiting. Containment tracks one bb at a time, so a test run may only
/// start while no proof holds it.
pub fn take_test_permit(prove: &Arc<Semaphore>) -> Result<OwnedSemaphorePermit, TestRunError> {
    prove
        .clone()
        .try_acquire_owned()
        .map_err(|_| TestRunError::Busy)
}

/// Rehash the file, then run `bb --version` once under proof containment with no witness, a 5 s
/// limit and 4 KiB of output. This executes the file as the user: containment is not a sandbox.
/// `admit` is asked after the rehash; the guard it returns is held across the spawn and dropped
/// before the wait, so what it checked still holds when the file starts. `None` leaves the file
/// unrun, for a candidate withdrawn while the hash was computed.
pub async fn test_run<G>(
    path: &Path,
    sha256: &str,
    permit: OwnedSemaphorePermit,
    admit: impl FnOnce() -> Option<G>,
) -> Result<TestRun, TestRunError> {
    test_run_within(path, sha256, permit, admit, TEST_RUN_TIMEOUT).await
}

async fn test_run_within<G>(
    path: &Path,
    sha256: &str,
    _permit: OwnedSemaphorePermit,
    admit: impl FnOnce() -> Option<G>,
    timeout: Duration,
) -> Result<TestRun, TestRunError> {
    let (owned_path, owned_sha) = (path.to_path_buf(), sha256.to_string());
    tokio::task::spawn_blocking(move || verify_file(&owned_path, &owned_sha))
        .await
        .map_err(|e| TestRunError::Internal(e.to_string()))?
        .map_err(TestRunError::Unavailable)?;
    let probe_error = |e| match e {
        crate::bb::ProbeError::Workspace(e) => TestRunError::Internal(e.to_string()),
        crate::bb::ProbeError::Spawn(e) => TestRunError::WontStart(wont_start(&e)),
        crate::bb::ProbeError::DidNotFinish(e) => {
            tracing::warn!(error = %e, "Custom bb test run did not finish");
            TestRunError::TimedOut
        }
    };
    let started = {
        let _admitted = admit().ok_or(TestRunError::Unavailable(Unavailable::Withdrawn))?;
        crate::bb::start_version_probe(path, TEST_RUN_OUTPUT_CAP).map_err(probe_error)?
    };
    let probe = crate::bb::finish_version_probe(started, timeout)
        .await
        .map_err(probe_error)?;
    if !probe.status.success() {
        return Err(TestRunError::Failed(probe.status.to_string()));
    }
    let output = String::from_utf8_lossy(&probe.stdout);
    Ok(TestRun {
        version_suggestion: suggest_label(&output),
        excerpt: excerpt(&output),
    })
}

fn wont_start(e: &std::io::Error) -> String {
    // ERROR_SYSTEM_INTEGRITY_POLICY_VIOLATION: Smart App Control or WDAC blocked the file.
    if cfg!(windows) && e.raw_os_error() == Some(4551) {
        return "Windows Smart App Control blocked it".to_string();
    }
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        return format!(
            "the system refused to start it, for example a noexec mount or a privacy setting ({e})"
        );
    }
    e.to_string()
}

fn suggest_label(output: &str) -> Option<AztecVersion> {
    output
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')'))
        .filter(|token| !token.is_empty())
        .find_map(|token| {
            check_label(token)
                .or_else(|_| check_label(token.strip_prefix('v').unwrap_or(token)))
                .ok()
        })
}

fn excerpt(output: &str) -> String {
    output
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() && c != '\n' {
                '\u{FFFD}'
            } else {
                c
            }
        })
        .take(EXCERPT_CHARS)
        .collect()
}

/// `BB_BINARY_PATH` names an existing path, so it outranks every route, the custom one included.
pub fn env_override_active() -> bool {
    crate::bb::env_override().is_some()
}

/// For messages: drops Windows' verbatim `\\?\` prefix that `canonicalize` adds.
pub fn display_path(path: &Path) -> String {
    let shown = path.display().to_string();
    match shown.strip_prefix(r"\\?\") {
        Some(rest) if cfg!(windows) => rest.to_string(),
        _ => shown,
    }
}

/// POSIX single-quoting, for the copyable fix commands.
#[cfg(unix)]
fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', r"'\''"))
}

/// Developer mode on with `pin` saved. Lives here because server code, tests included, must
/// never write developer settings.
#[cfg(test)]
pub(crate) fn developer_config(pin: CustomBbPin) -> crate::config::PrestoConfig {
    let mut config = crate::config::PrestoConfig::default();
    config.set_developer_mode(true);
    config.set_custom_bb(Some(pin)).unwrap();
    config
}

#[cfg(test)]
mod tests;
