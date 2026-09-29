# Phase 6: token demo, legacy gate and local-network e2e

## Changes

- **Token flow.** The reference `Token` was already in place from phase 4, since typecheck forced it:
  - `TokenContract.deploy(wallet, alice, "Presto", "ACEL", 18)`;
  - `mint_to_private(alice, 1000n)`;
  - `transfer(bob, 500n)` sent from Alice.

  The log copy went back to "(minter=Alice)", because the plan keeps the copy unchanged. Two e2e
  comments that still named the standards token now say "token".
- **Legacy gate (A6).** `scripts/install-legacy-sdk.ts` exports a pure `legacyGate(legacy,
  current)`, and its side effects moved under `import.meta.main`.
  - Same version: runs.
  - Another Aztec major: dormant. Stdout stays empty and stderr carries
    `::notice title=Legacy SDK gate dormant::…`. The runner reads workflow commands from stderr too.
  - Same major, other version: throws, as a stale fixture.

  The pack-and-integrity check runs before the decision, so the fixture is verified even while the
  gate sleeps.
- **Two call sites, not one.** `_e2e.yml` and `_e2e-packaged.yml`'s "complete workspace checks" both
  ran `test -f "$LEGACY_SDK_ENTRY"`. The plan named only the first. Left alone, the second would fail
  every v6 release's packaged e2e. Both now accept empty output.

## Gate

- `bun run test` exit 0: sdk-core 195, sdk 31, sdk-noir 39, banners 33, playground 108 + scripts
  10, presto scripts 107, release-feed 4, root scripts 247. `lint:actions` exit 0.
- Port 5173 claimed, then 4173 and 5173:
  - `test:e2e` (mocked): 22 passed.
  - `test:e2e:production-smoke`: 4 passed. That includes the real-WASM Noir proof of the production
    bundle.
- The production build warns that Node builtins are externalized. The sources are v6
  `@aztec-labs/accounts/dest/utils/ssh_agent.js` and `@aztec-labs/foundation/dest/testing/port_allocator.js`,
  through `colorette`'s `tty`. The smoke asserts no JS errors on load, so these are warnings only.

### v6 local network

- Started from the scratch v6 install. Ports were claimed and released through the registry.
  `aztec start --local-network --port 59962 --admin-port 59963`, with `ANVIL_PORT=59961`, and
  `TMPDIR` on real disk.
- `aztec.sh`'s `--local-network` branch starts anvil itself on `$ANVIL_PORT` and exports
  `ETHEREUM_HOSTS`. Readiness took 40 s. `node_getNodeInfo` reported `nodeVersion` 6.0.0-rc.1 and
  `l1ChainId` 31337.
- **v6 local networks build blocks only on demand.** The AutomineSequencer builds when a tx is pending
  and never on a timer. `nodeDebug_mineBlock` builds an empty block; the local network registers the
  debug namespace. Anything that waits for "N more blocks" without sending a tx hangs forever there.
- Branch `presto-server`, run the way CI's `_e2e.yml` runs it (`BB_BINARY_PATH` pointing at the
  sidecar, `AZTEC_BB_VERSION=6.0.0-rc.1`):
  - The SDK e2e, with the legacy step first, exactly as the workflow runs it: 7 pass, 4 skip, 0 fail.
    The skips are the dormant legacy test and the three remote-network tests. The legacy step
    printed its notice. The native deploy used the bundled bb 6.0.0-rc.1 (a Chonk proof with 7
    circuits), and `transmit` was in the phases.
  - `test:e2e:local-network` without `PRESTO_URL`, the gate as written: 2 passed (Local deploy and
    Local token flow at 500/500), with 5 skipped because they need `PRESTO_URL`. With `PRESTO_URL`: 7
    of 7 passed, including the Accelerated token flow and the HTTP-consent spec.
- **The SDK e2e ignores `PRESTO_URL`'s port.** `proving.test.ts` builds `new PrestoProver()` on the
  default port 59833, and `PRESTO_URL` only decides whether the Accelerated tests are skipped. The
  runs claimed 59833 rather than change the test. This is a run-isolation gap and a follow-up
  candidate.

### The released artifact (presto-server 1.1.3)

- `presto-server-1.1.3-linux-x86_64.tar.gz` from `presto-v1.1.3`: `sha256sum -c` against the
  release's `.sha256` asset reported OK (`90b76733…0c07c41`). The archive holds only `presto-server`.
- Started with a clean environment. `/proc/<pid>/environ` held exactly:
  - `PATH=/usr/local/bin:/usr/bin:/bin`, where no directory has a `bb`;
  - `PRESTO_HOME`, set to an empty real-disk directory;
  - `HOME`, set to an empty directory, so there is no `.bb`.

  There was no `BB_BINARY_PATH` or `AZTEC_BB_VERSION`. `/health` answered `bb_available: false`.
- **The first attempt was refused.** The cold path fetches barretenberg's asset digest from
  `api.github.com` before it downloads anything. This host's anonymous quota (60 per hour per IP,
  shared by every agent on the machine) was at 0, so the server returned `403` and the SDK fell
  back. The log said so explicitly: "anonymous GitHub API call… set GITHUB_TOKEN". A token is a
  credential, so it would be a keyed run. I waited for the reset (22:52:54Z) and re-ran on a fresh
  `PRESTO_HOME`.
- Re-run results:
  - SDK e2e: 7 pass, 4 skip, 0 fail. The legacy notice printed, and the native Chonk deploy was
    accepted by the local network.
  - sdk-noir e2e: 6 pass, 1 skip, 0 fail. Native UltraHonk, byte-identical to the v6 fixtures and
    verified in WASM.
  - `versions/6.0.0-rc.1/bb`: the marker's archive digest `a03fae96…7b0e` equals barretenberg's
    `barretenberg-amd64-linux.tar.gz` digest from the GitHub release. The binary hashes to the
    marker's binary digest. Exactly one v6 download, of 9,320,781 bytes.
  - Coexistence: `square` as committed at `4cdc2f2` (bb.js 5.2.0), sent raw with
    `x-aztec-version: 5.2.0`, returned that commit's proof and public inputs byte for byte. Those
    differ from the v6 proof. `versions/` then held `5.2.0` (digest `17ab8476…7cfb`, equal to
    barretenberg's) and `6.0.0-rc.1`.
  - A repeat v6 request returned the v6 fixture's proof with no new download. There was exactly one
    5.2.0 download.
