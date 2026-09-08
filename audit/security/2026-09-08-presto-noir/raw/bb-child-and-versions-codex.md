Static review at `f331a787`. No files changed, builds run, or network calls made. F-2–F-5 require a malicious bb release; no circuit-triggered exploit of the official binary was established. Current CWE Top-25 membership could not be independently verified offline.

## Findings

### F-1: Invalid requests can defeat cache-size cleanup indefinitely

**Impact factors:** Availability: attacker-controlled downloads can retain more than the intended 2 GiB, potentially exhausting the user’s filesystem. Browser-to-loopback vector; approved origin required; repeated requests and sufficient downloadable releases required; no further interaction after approval.

**Evidence confidence:** High for the cleanup bypass; moderate for practical disk exhaustion.

**OWASP / CWE:** Insecure Design; CWE-770, Allocation of Resources Without Limits or Throttling.

**Trace:** Version header at `packages/presto/core/src/server/prove.rs:374` → cache verification at `packages/presto/core/src/server/prove.rs:82` → activity refresh at `packages/presto/core/src/versions/cache_layout.rs:249` and `packages/presto/core/src/versions/cache_layout.rs:274` → eviction exemption at `packages/presto/core/src/versions/version_policy.rs:414`. The delayed pass ignores further deferral at `packages/presto/core/src/versions/version_policy.rs:477`.

**Missing control:** No capacity reservation before installation, and no continuing cleanup after the retry encounters another activity exemption.

**Exploit story:** Send `{"bytecode":"","witness":"","verifier_target":"noir-recursive"}` with different existing release versions. Download and cache activity happen before gzip rejection: `packages/presto/core/src/server/ultra_honk.rs:333` precedes `packages/presto/core/src/server/ultra_honk.rs:338`. Refresh cached versions with the same invalid requests less than five minutes apart while adding versions. Continue refreshing until every download-triggered delayed cleanup has fired, then stop. The excess remains until another download or restart schedules cleanup.

**Preconditions:** Approved origin; sufficient official releases with available digests; enough request/hash throughput to refresh the selected entries within the activity window.

**Why mitigations fail:** Request concurrency limits do not bound accumulated disk usage. Leases need not remain held: even rejected jobs refresh the exemption. Cache hits schedule no cleanup because `packages/presto/core/src/server/prove.rs:388` excludes them.

**Instances:** Activity refresh at `packages/presto/core/src/versions/cache_layout.rs:249`; first-pass exemption at `packages/presto/core/src/versions/version_policy.rs:379`; terminal retry at `packages/presto/core/src/versions/version_policy.rs:477`. Shared acquisition exposes this through both handlers at `packages/presto/core/src/server/prove.rs:216` and `packages/presto/core/src/server/ultra_honk.rs:333`.

### F-2: A FIFO output permanently occupies the global prover permit

**Impact factors:** Availability: one malicious proof execution can block subsequent proving across both schemes until restart. Supply-chain vector; control of an executed bb release required; low complexity once executed; no additional user interaction.

**Evidence confidence:** High from source; not runtime-tested.

**OWASP / CWE:** Insecure Design; CWE-770.

**Trace:** bb-controlled output directory passed at `packages/presto/core/src/bb/ultra_honk.rs:265` → output worker at `packages/presto/core/src/server/ultra_honk.rs:365` → `read_outputs` at `packages/presto/core/src/bb/ultra_honk.rs:410` → `read_fields` at `packages/presto/core/src/bb/ultra_honk.rs:315` → blocking `File::open` at `packages/presto/core/src/bb.rs:487`.

**Missing control:** Output opens do not reject special files through a nonblocking open and descriptor validation. The output stage has no effective cancellation or deadline.

**Exploit story:** The malicious prover creates a FIFO named `proof.json` in its output directory, leaves no writer, and exits successfully. Presto finishes child containment and then blocks opening the FIFO. The worker retains `Held`, including the single global permit.

**Preconditions:** Unix; malicious bb executes and controls its output directory.

**Why mitigations fail:** The byte cap applies only after opening. The 300-second timeout covers `child.wait()` at `packages/presto/core/src/bb.rs:446`, not output reads. Disconnect cancellation cannot stop this closure: it ignores its cancellation argument at `packages/presto/core/src/server/ultra_honk.rs:365`.

**Instances:** Shared open at `packages/presto/core/src/bb.rs:487`; UltraHonk proof/public-input/key reads at `packages/presto/core/src/bb/ultra_honk.rs:410`, `packages/presto/core/src/bb/ultra_honk.rs:412`, `packages/presto/core/src/bb/ultra_honk.rs:417`; chonk proof read at `packages/presto/core/src/bb.rs:332`.

### F-3: Windows ordinary child exit leaves descendants running

**Impact factors:** Availability: descendants can consume CPU, memory, and disk beyond request completion and the proof timeout. Supply-chain vector; malicious bb required; low complexity; no additional interaction. Affects the user’s host.

**Evidence confidence:** High from source; Windows execution not tested.

**OWASP / CWE:** Insecure Design; CWE-770; underlying lifecycle weakness CWE-772, Missing Release of Resource after Effective Lifetime.

**Trace:** Child assignment at `packages/presto/core/src/bb.rs:906` → direct-child wait returns at `packages/presto/core/src/bb.rs:359` → `guard.finish()` at `packages/presto/core/src/bb.rs:362` → Windows guard merely disarms at `packages/presto/core/src/bb.rs:930`.

**Missing control:** Ordinary completion does not terminate remaining Job Object members or confirm an empty job.

**Exploit story:** After assignment, malicious bb launches a long-lived worker, writes acceptable output JSON, and exits zero. Presto completes the request while the worker continues. Repeated successful requests accumulate workers.

**Preconditions:** Windows; malicious release creates descendants that outlive its direct process.

**Why mitigations fail:** `KILL_ON_JOB_CLOSE` is configured at `packages/presto/core/src/bb.rs:787`, but the job handle lives for the entire application lifetime at `packages/presto/core/src/bb.rs:765`. Disarming prevents the drop-time termination at `packages/presto/core/src/bb.rs:940`. The proof timer ends when the direct child exits.

**Instances:** Shared ordinary-exit path at `packages/presto/core/src/bb.rs:362` and Windows finalizer at `packages/presto/core/src/bb.rs:929`, covering both schemes and both successful and unsuccessful exit statuses.

### F-4: Unix descendants can escape process-group termination

**Impact factors:** Availability: escaped workers can survive timeout, revocation of queued work, shutdown, and update quiescence, continuing host resource consumption. Supply-chain vector; malicious bb required; low complexity; no additional interaction.

**Evidence confidence:** High for the containment escape; no official-bb trigger established.

**OWASP / CWE:** Insecure Design; CWE-770.

**Trace:** bb command construction at `packages/presto/core/src/bb/ultra_honk.rs:251` → group configuration at `packages/presto/core/src/bb.rs:627` → original group registration at `packages/presto/core/src/bb.rs:659` → termination targets only that group at `packages/presto/core/src/bb.rs:723`.

**Missing control:** No enforced containment prevents descendants from changing session/process-group membership.

**Exploit story:** Malicious bb forks. Its child, which is not the original group leader, calls `setsid()` and starts a resource-consuming worker. Killing the original group leaves that worker alive. `terminate_and_confirm` can return success once the original group disappears.

**Preconditions:** Unix; malicious release; descendant successfully establishes a new session.

**Why mitigations fail:** `kill_on_drop` reaches the direct child only. Group signals follow current membership, not ancestry. The confirmation at `packages/presto/core/src/bb.rs:731` checks only the original group. The quiesce latch prevents new Presto spawns but does not constrain existing descendants.

**Instances:** Group-only termination on ordinary completion at `packages/presto/core/src/bb.rs:683`, cancellation/timeout at `packages/presto/core/src/bb.rs:697`, quit at `packages/presto/core/src/bb.rs:709`, and confirmed termination at `packages/presto/core/src/bb.rs:723`.

### F-5: Windows children can spawn before Job Object assignment

**Impact factors:** Availability: an escaped descendant can survive timeout, quit, and update confirmation. Supply-chain vector; malicious bb required; scheduling-dependent attack complexity; no additional interaction. Host-wide resource impact is possible.

**Evidence confidence:** Moderate; concrete scheduling window, not reproduced on Windows.

**OWASP / CWE:** Insecure Design; CWE-770; contributing CWE-362, Race Condition.

**Trace:** No suspended-start configuration at `packages/presto/core/src/bb.rs:830` → executable starts at `packages/presto/core/src/bb.rs:894` through `packages/presto/core/src/bb.rs:1065` → later Job Object assignment at `packages/presto/core/src/bb.rs:906` → job-only termination/confirmation at `packages/presto/core/src/bb.rs:982` and `packages/presto/core/src/bb.rs:987`.

**Missing control:** Job membership is not established before the child’s first instruction.

**Exploit story:** Windows schedules malicious bb immediately after process creation. Before Presto assigns it to the job, bb launches a worker. Assigning the parent afterward does not retroactively enroll that existing worker. The parent then proves normally or hangs; subsequent job termination misses the worker.

**Preconditions:** Windows; malicious release wins the scheduling window; no enclosing job independently contains both processes.

**Why mitigations fail:** `GATE` serializes Presto’s spawn and quiesce operations, not execution inside bb. `IsProcessInJob` checks only the direct child at `packages/presto/core/src/bb.rs:915`. Confirming the job empty therefore does not confirm that every descendant exited.

**Instances:** Shared Windows spawn/assignment gap at `packages/presto/core/src/bb.rs:894` and `packages/presto/core/src/bb.rs:906`; failure cleanup at `packages/presto/core/src/bb.rs:859` likewise cannot reach an already escaped descendant.

## Non-findings considered

- Command injection: fixed argv, enum-derived target, and generated workspace paths at `packages/presto/core/src/bb/ultra_honk.rs:252`; no shell interpolation.
- Version traversal/SSRF: restricted version construction at `packages/presto/core/src/versions/version_policy.rs:321` and fixed release host at `packages/presto/core/src/versions/release_metadata.rs:56`.
- Archive traversal, links, and inflation bombs: fixed extraction destination, regular-file requirement, and streamed cap at `packages/presto/core/src/versions/downloader.rs:433`, `packages/presto/core/src/versions/downloader.rs:446`, `packages/presto/core/src/versions/downloader.rs:461`.
- Cross-user workspace planting: owner-only creation and exclusive input-file creation at `packages/presto/core/src/bb.rs:233` and `packages/presto/core/src/bb.rs:277`; no default-configuration bypass established.
- Same-control-plane digest trust is already documented/tracked at `packages/presto/core/src/versions/release_metadata.rs:73`; not re-reported.
- stderr retention is bounded and excluded from HTTP errors at `packages/presto/core/src/bb.rs:535` and `packages/presto/core/src/bb.rs:477`.
- Windows binary key corruption is avoided by recomputation at `packages/presto/core/src/bb/ultra_honk.rs:218`; JSON output avoids binary text-mode corruption.
- Known timeout/client-abandonment admission-release issue at `packages/presto/core/src/bb.rs:359` excluded as instructed; F-2–F-5 describe separate paths.
- Headless permissive mode requires explicit configuration at `packages/presto/server/src/main.rs:232`; shared custom state directories remain documented unsupported configuration at `packages/presto/README.md:94`.

## Out of cluster

None confirmed within the bounded inspection.
## Cross-rebuttal (Codex, after reading the Claude report)

## Cross-rebuttal

### 1. What the other reviewer missed

- **Persistent cache-cap bypass (my F-1).** Request-driven verification at `packages/presto/core/src/server/prove.rs:82` refreshes activity at `packages/presto/core/src/versions/cache_layout.rs:249`. Cleanup exempts recently active entries at `packages/presto/core/src/versions/version_policy.rs:414`; its sole retry discards further deferral at `packages/presto/core/src/versions/version_policy.rs:477`. Invalid requests can refresh entries until all retries finish, then stop, leaving excess storage until another download or restart. This contradicts their characterization of overshoot as merely transient. **Confidence: high for the bypass.**

- **FIFO output deadlock (my F-2).** A malicious bb can create `proof.json` as a FIFO without a writer and exit. The output path is `packages/presto/core/src/server/ultra_honk.rs:365` → `packages/presto/core/src/bb/ultra_honk.rs:410` → `packages/presto/core/src/bb/ultra_honk.rs:315` → blocking open at `packages/presto/core/src/bb.rs:487`. The worker retains admission guards at `packages/presto/core/src/server/ultra_honk.rs:296`; its cancellation argument is ignored. Neither byte caps nor the completed child timeout unblock the open. **Confidence: high.**

- **Windows descendants surviving ordinary exit (my F-3).** Direct-child completion calls `guard.finish()` at `packages/presto/core/src/bb.rs:362`; Windows only disarms cleanup at `packages/presto/core/src/bb.rs:930`. Descendants already inside the job remain running. **Confidence: high for the lifecycle gap.**

- **Unix escape and Windows assignment race (my F-4/F-5).** Unix containment establishes a process group at `packages/presto/core/src/bb.rs:627`, but a malicious descendant can call `setsid()`; termination and confirmation inspect only the original group at `packages/presto/core/src/bb.rs:723` and `packages/presto/core/src/bb.rs:731`. Windows starts executable code at `packages/presto/core/src/bb.rs:894` before assignment at `packages/presto/core/src/bb.rs:906`; an already-created descendant is not retroactively enrolled. `GATE` serializes Presto operations, not child execution. Their blanket containment non-finding is therefore too strong. **Confidence: high for Unix escape; moderate for the untested Windows race.**

These child findings retain the explicit malicious-release precondition; they do not demonstrate an exploit through ordinary circuit bytes.

### 2. What looks overconfident in their claims

**Their F-1 — VERIFIED, with material corrections. Confidence: moderate for availability impact.**

The download-amplification path exists, but GitHub metadata throttling is **not a backstop on repeated tarball transfers**. The complete tarball is downloaded at `packages/presto/core/src/versions/downloader.rs:38` before metadata verification at `packages/presto/core/src/versions/downloader.rs:44`. A metadata rejection returns failure at `packages/presto/core/src/versions/release_metadata.rs:96`; installation is never reached. Consequently, the same uncached version can trigger another full download on every retry—no continued enumeration of historical versions is necessary during metadata failures.

Conversely, extraction, codesigning, and final-binary hashing do **not** occur on those failed attempts: installation follows successful verification at `packages/presto/core/src/versions/downloader.rs:56`.

Two further corrections:

- Downloads precede semaphore acquisition at `packages/presto/core/src/server/prove.rs:312` and `packages/presto/core/src/server/prove.rs:328`; direct occupation of the single prover permit is not their starvation mechanism.
- Desktop localhost is not auto-approved by default: `packages/presto/core/src/config.rs:139` sets false; headless explicitly sets true at `packages/presto/server/src/main.rs:94`.

Their transfer-size and external-rate estimates remain unverified here.

**Their F-2 — SPECULATIVE; should become a non-finding. Confidence: high in this disposition.**

Historical-version selection is real, but no vulnerable build, reachable defect, or exploit input is identified. `packages/presto/core/src/versions/version_policy.rs:240` explains why Aztec-version ordering is not a reliable safety ordering; `packages/presto/core/src/versions/version_policy.rs:311` implements explicit revocations. An empty denylist does not establish that a vulnerable release is selectable. Their conditional future exploit violates the audit’s concrete-trace requirement.

### 3. Revisions to my own findings

- **Retain F-1**, distinguishing persistent retention from their cumulative transfer churn. Disk-exhaustion feasibility remains moderate; no throughput or release-inventory measurements were performed.
- **Retain F-2–F-5** with their original conditional scope and confidence. Their report identifies no control that closes these paths. Windows scenarios remain untested.
- **Add the narrower failed-download amplification finding:** repeated metadata failures permit repeated full transfers of one uncached version. The ordering above strengthens their F-1 and removes its asserted dependence on many distinct releases or successful cache eviction.