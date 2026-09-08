Read-only audit of `f331a78`. Live GitHub/npm configuration was not queried; no repository files were changed.

## Findings

### F-1: Registry dependencies execute with publishing privileges

**Impact factors:** Violates package integrity and publishing authorization; malicious SDK code could subsequently compromise consumers’ confidentiality and availability. All three npm packages are affected. Network supply-chain vector; attacker needs control of a dependency release selected by npm, but no Presto repository access. Low complexity after that compromise; an ordinary maintainer release triggers execution.

**Evidence confidence:** High.

**OWASP / CWE mapping:** OWASP Software Supply Chain Failures; CWE-269, Improper Privilege Management.

**Trace:** A registry-resolved dependency range, such as `@logtape/logtape@^2.3.2` (`packages/sdk-noir/package.json:27`, `packages/sdk-core/package.json:24`), survives manifest preparation (`scripts/prepare-sdk-publish.ts:60`). The consumer host installs the candidate (`scripts/tarball-consumer/host-manifest.ts:28`) with lifecycle scripts enabled (`scripts/sdk-tarball-consumer.sh:79`). This executes inside the publishing job (`.github/workflows/_publish-npm.yml:162`), which already holds `id-token: write` and `contents: write` (`.github/workflows/_publish-npm.yml:44`). The writable tarball path is exported beforehand (`.github/workflows/_publish-npm.yml:158`) and published afterward (`.github/workflows/_publish-npm.yml:167`).

**Missing control:** Consumer execution is not isolated from publishing credentials or the artifact subsequently published. There is no protected artifact digest comparison across this execution boundary. Build and consumer jobs should run without publication privileges; a separate publisher should receive the verified artifact.

**Exploit story:**

1. An attacker publishes a compatible malicious dependency version satisfying `^2.3.2`, with a `postinstall` hook.
2. Earlier frozen-lockfile gates continue using the committed `2.3.2` resolution (`bun.lock:553`).
3. The fresh consumer install selects the malicious version. Its hook reads `TARBALL` and replaces that archive, preserving package identity and expected APIs while adding malicious SDK code.
4. The consumer can finish against its already-extracted copy; publication subsequently reads the replaced archive (`.github/workflows/_publish-npm.yml:167`).
5. Alternatively, the hook can use the job’s publishing identity directly.

**Preconditions:** A normal authorized release reaches the consumer step, and npm selects the compromised dependency. No malicious merge or modification of the release workflow is required.

**Why mitigations fail:** `bun.lock` and Bun’s release-age policy govern the earlier Bun install, not the fresh npm consumer resolution (`bunfig.toml:16`, `scripts/sdk-tarball-consumer.sh:79`). Provenance records publication by the legitimate workflow; it does not establish that dependencies left the artifact unchanged. The signature-audit helper correctly disables install scripts (`scripts/verify-sdk-package-signatures.ts:51`), but other execution paths remain privileged.

**Instances:** Credential grants: `.github/workflows/_publish-npm.yml:44`, `.github/workflows/release-sdk.yml:143`, `.github/workflows/release-sdk.yml:172`, `.github/workflows/release-sdk.yml:185`. Privileged dependency execution: `scripts/sdk-tarball-consumer.sh:79`, `scripts/sdk-tarball-consumer.sh:93` (fresh `npx typescript@5.9`), `scripts/sdk-tarball-consumer.sh:96`, `scripts/sdk-tarball-consumer.sh:111`; additionally `.github/workflows/_publish-npm.yml:245`, where the fresh install also inherits `GH_TOKEN` from `.github/workflows/_publish-npm.yml:227`. All three packages share this reusable publisher.

### F-2: Verified provenance is not bound to the deployed tarball

**Impact factors:** Violates deployed application integrity and potentially playground users’ confidentiality. An attacker can supply browser code that exfiltrates data available to the playground. Network vector; requires control over registry metadata and tarball responses across successive requests. High complexity and substantial upstream access; an ordinary playground deployment triggers the path.

**Evidence confidence:** High for the source-level substitution path; no live registry attack was performed.

**OWASP / CWE mapping:** OWASP Software or Data Integrity Failures; CWE-287, Improper Authentication of the artifact’s claimed origin.

**Trace:** `fetchVerified` checks provenance and signatures through separate operations (`scripts/published-playground.ts:103`, `scripts/published-playground.ts:104`). It then downloads another tarball using `npm pack` (`scripts/published-playground.ts:107`). Its integrity is compared only with a new registry-provided digest (`scripts/published-playground.ts:111`), not the digest covered by the preceding verified attestation. That archive enters the swap script (`scripts/published-playground.ts:153`), is extracted into the playground dependency tree (`.github/scripts/packaged-e2e-swap-sdk.sh:71`), and is built and deployed (`.github/workflows/release-sdk.yml:232`, `.github/workflows/release-sdk.yml:238`).

**Missing control:** Verification does not carry an authenticated digest forward to the exact local archive consumed. Download once, cryptographically verify the attestation, apply provenance policy to that verified payload, and compare the local archive’s hash with its subject digest before extraction.

**Exploit story:**

1. For an existing legitimate package version, the compromised registry serves authentic artifact A and its valid provenance during the verification operations.
2. For the subsequent `npm pack`, it serves malicious artifact B under the same name and version, with matching metadata integrity B.
3. The following `npm view dist.integrity` also returns B, so the comparison passes.
4. B preserves the original manifest, dependency pins, exports and usable APIs. Manifest and resolution checks therefore pass.
5. The workflow deploys B’s JavaScript. The attacker never needs to forge A’s signature or obtain Presto’s publishing identity.

**Preconditions:** A legitimate signed version exists, registry responses can differ between verification and consumption, and the replacement remains build-compatible.

**Why mitigations fail:** Package identity checks authenticate neither code nor byte identity (`scripts/npm-pack-result.ts:27`). A hash compared against another attacker-controlled response establishes consistency only. The signature verifier returns no verified artifact or digest (`scripts/verify-sdk-package-signatures.ts:39`); the provenance result contains only source metadata (`scripts/sdk-release-verification.ts:97`). Neither result binds the later download. `--ignore-scripts` prevents install hooks here, but malicious runtime JavaScript still enters the deployed bundle.

**Instances:** Shared download/verification gap: `scripts/published-playground.ts:103`, `scripts/published-playground.ts:104`, `scripts/published-playground.ts:107`, `scripts/published-playground.ts:111`. Affected package calls: `scripts/published-playground.ts:127` (Presto), `scripts/published-playground.ts:140` (Noir), `scripts/published-playground.ts:152` (core). Extraction sinks: `.github/scripts/packaged-e2e-swap-sdk.sh:71`, `.github/scripts/packaged-e2e-swap-sdk.sh:85`, `.github/scripts/packaged-e2e-swap-sdk.sh:134`.

## Non-findings considered

- **Dispatch/shell injection:** External dispatch values enter environment variables and quoted argument arrays; package selection is allowlisted (`.github/workflows/release-sdk.yml:99`, `scripts/release-plan.ts:71`). No independent injection trace established.
- **Non-main/fork publishing:** The ordinary release checks `GITHUB_REF` (`.github/workflows/release-sdk.yml:55`); documented environment restrictions and trusted-publisher identity provide additional controls (`docs/RELEASE_RUNBOOK.md:18`, `docs/RELEASE_RUNBOOK.md:83`). No bypass established; live configuration remains unverified.
- **PR permissions and action references:** Package CI declares `contents: read`; inspected external actions use commit SHAs (`.github/workflows/_ts-package-ci.yml:30`, `.github/workflows/sdk-noir.yml:24`). No privileged PR execution path established.
- **Signature-audit install hooks:** This helper uses `--ignore-scripts` (`scripts/verify-sdk-package-signatures.ts:51`); its installation is not the lifecycle-execution instance in F-1.
- **Bootstrap substitution:** The host rejects replacement of the candidate; supplied dependency archives are checked against installation integrity (`scripts/tarball-consumer/host-manifest.ts:20`, `scripts/tarball-consumer/assert-local-dependency.ts:38`).
- **Wrong release commit:** Checkout uses the triggering revision; tagging is followed by comparison against `GITHUB_SHA` (`.github/workflows/_publish-npm.yml:52`, `.github/workflows/_publish-npm.yml:204`, `.github/workflows/_publish-npm.yml:235`). Dependency-induced mutation falls under F-1.
- **Promotion race:** Fresh tag-state checks narrow the explicitly documented race; no additional attacker capability or concrete security violation established (`scripts/promote-sdk-latest.ts:234`, `scripts/promote-sdk-latest.ts:237`).
- **Fixture regeneration:** Executable and fixture-name inputs come from the invoking developer; subprocesses use argument arrays, and regeneration requires its explicit flag (`scripts/noir-fixture.ts:282`, `scripts/noir-fixture.ts:328`).
- **Live-log disclosure:** The upload targets the fixture-test server log; no production secret or private-user witness source was established (`.github/workflows/_ts-package-ci.yml:239`, `.github/workflows/_ts-package-ci.yml:251`).
- **Package contents:** Both new packages allowlist `src` and `dist`; no secret-bearing packaging path established (`packages/sdk-core/package.json:13`, `packages/sdk-noir/package.json:13`).

## Out of cluster

- No additional serious issue established within the inspected handoff edges.
## Cross-rebuttal (Codex, after reading the Claude report)

## Cross-rebuttal

### 1. What the other reviewer missed

**My F-2 remains a finding: the deployed archive is not bound to the verified provenance. Confidence: high.**

The reviewer’s extraction non-finding assumes the downloaded tarball has been authenticated. The source does not establish that:

`scripts/published-playground.ts:103` → provenance check; `scripts/published-playground.ts:104` → separate signature audit; `scripts/published-playground.ts:107` → another tarball download; `scripts/published-playground.ts:111` → comparison against another registry response; `.github/scripts/packaged-e2e-swap-sdk.sh:71` → extraction; `.github/workflows/release-sdk.yml:232` and `.github/workflows/release-sdk.yml:238` → build and deployment.

A compromised registry can serve authentic artifact A during verification, then unsigned malicious artifact B with matching metadata during packing. Preserving the name, version and dependency manifest satisfies the remaining checks. No signature forgery is required. The missing control is comparison of the **consumed archive’s digest with the authenticated attestation’s digest**. This threatens deployed-code integrity and playground users’ confidentiality; it requires control over successive registry responses and an ordinary deployment.

The same gap affects all three package calls: `scripts/published-playground.ts:127`, `scripts/published-playground.ts:140`, `scripts/published-playground.ts:152`. Extraction instances are `.github/scripts/packaged-e2e-swap-sdk.sh:71`, `.github/scripts/packaged-e2e-swap-sdk.sh:85`, `.github/scripts/packaged-e2e-swap-sdk.sh:134`. This establishes artifact substitution, not a separate archive-traversal finding.

Their F-1 also omits executable dependency paths beyond lifecycle hooks: `npx --package=typescript@5.9` and the runtime import execute inside the same privileged consumer step (`scripts/sdk-tarball-consumer.sh:93`, `scripts/sdk-tarball-consumer.sh:96`). Merely adding `--ignore-scripts` would leave those paths.

### 2. What looks overconfident in their claims

**Their F-1: VERIFIED, confidence high, with narrower credential claims.**

The job grants publication and repository-write permissions before consumer execution (`.github/workflows/_publish-npm.yml:44`, `.github/workflows/_publish-npm.yml:162`). The final fresh install additionally receives `GH_TOKEN` explicitly (`.github/workflows/_publish-npm.yml:227`, `.github/workflows/_publish-npm.yml:245`). Thus the credential-exposure finding survives independently of the asserted checkout credential-storage location.

However:

- The precise claim that credentials reside in `.git/config` is not established by this repository’s checkout invocation (`.github/workflows/_publish-npm.yml:52`). Avoid asserting that implementation detail.
- Publishing authority applies to individually registered npm packages, not arbitrary packages across the organization (`docs/RELEASE_RUNBOOK.md:79`). Likewise, `contents: write` does not establish that protected branches can be overwritten.
- The actual attacker prerequisite is control of a selected upstream package or its delivery. “No privileges” should not obscure that prerequisite.

Two non-finding rationales also overstate their evidence:

- **“Every interpolation goes through env” is false:** direct interpolation appears at `.github/workflows/_publish-npm.yml:92`, `.github/workflows/_ts-package-ci.yml:90`, and `.github/workflows/_ts-package-ci.yml:245`. These instances do not establish an independent injection exploit.
- **The logging rationale is inaccurate:** bb stderr text is logged, subject to truncation (`packages/presto/core/src/bb.rs:463`); withholding it from HTTP clients is a different control (`packages/presto/core/src/bb.rs:477`). No private-user witness or secret source was established in this CI job, so disclosure remains a non-finding.

The main-only conclusion is also better supported by documented environment restrictions (`docs/RELEASE_RUNBOOK.md:18`) than by branch-editable workflow conditions alone.

### 3. Revisions to my own findings

**F-1: retain and strengthen; no withdrawal or downgrade.** Independent agreement supports the privilege-boundary diagnosis. The strongest artifact-integrity scenario needs no credential theft: malicious consumer code can replace the exported archive before the official publish step (`.github/workflows/_publish-npm.yml:158`, `.github/workflows/_publish-npm.yml:167`). Remediation must isolate execution and publishing, including runtime imports and `npx`.

**F-2: retain at high source-evidence confidence.** Reinspection confirms that the signature verifier returns no authenticated artifact digest (`scripts/verify-sdk-package-signatures.ts:42`), and deployment downloads again afterward (`scripts/published-playground.ts:107`). The reviewer’s assertion of verified archives does not close that trace. Exploitability remains conditional on registry-response compromise; no live attack or configuration verification was performed.