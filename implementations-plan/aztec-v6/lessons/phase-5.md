# Phase 5: Noir fixtures and adapter gates

## Regeneration

- `AZTEC_NARGO=<scratch v6 install>/bin/aztec-nargo bun scripts/noir-fixture.ts --regenerate`
  (nargo `1.0.0-rc.3`, bb.js `6.0.0-rc.1`, `WasmWorker`). `--verify` then printed `ok` for all
  three fixtures and exited 0.
- Compared with `4cdc2f2` (nargo `1.0.0-beta.25`, bb.js `5.2.0`), for each of `square`, `nopub` and
  `hashchain`:
  - The ACIR bytecode, `vk`, `witness.gz` and `public_inputs` are byte-identical.
  - `circuit.json` changed only in its envelope: `artifact_version: 1`, `abi_version: 1`, the
    `noir_version` string and the `hash`.
  - The `proof` bytes differ at the same size (13,120 bytes, 410 fields). The prover changed, not the
    circuit.
- So a v5 proof and a v6 proof of the same circuit and witness are distinguishable byte for byte.
  That is what makes phase 6's coexistence check meaningful: `x-aztec-version: 5.2.0` must return the
  `4cdc2f2` proof, not the new one.

## Versioned raw requests

`native.test.ts`'s raw `POST /prove/ultra-honk` (the returned-key test) now sends
`x-aztec-version` set to the fixture manifest's `toolchain.bbJs`. Without the header the presto
proves with whichever unversioned `bb` it finds first. On a box with an older `~/.bb` that is a
different prover, and the byte-identity assertion fails for a reason unrelated to the adapter.
`loadFixture` now exposes `bbJs`.

## Gate

- `bun run --cwd packages/sdk-noir test:identity`: 4 pass.
- Live e2e against `presto-server` built from this branch (`cargo build --locked`, v1.1.4-rc.1):
  - private `PRESTO_HOME` on real disk under `~/.cache/presto/`, `--allow-all`;
  - port 59920, claimed in `~/.agents/ports.md` and released afterwards; the server was killed by
    its own pid;
  - the same environment as CI's live job: `BB_BINARY_PATH` at the prebuild sidecar and
    `AZTEC_BB_VERSION=6.0.0-rc.1`, so every versioned request resolved to `version="bundled"`. The
    log shows no download.
  - `PRESTO_URL=http://127.0.0.1:59920 bun run --cwd packages/sdk-noir test:e2e`: 6 pass, 1 skip,
    0 fail. The suite declares five tests. The fixture test is a `test.each` over the three
    fixtures, and the skip is the optional yacana W cross-check (`PRESTO_NOIR_W_FIXTURE_DIR`
    unset). Every adapter call runs with `fallback: "none"` and asserts that no `fallback` phase
    occurred.
- `bun run test` exit 0: lint, typecheck and unit (sdk-core 195, sdk 31, sdk-noir 39, banners 33,
  playground 108, presto scripts 107, release-feed 4, root scripts 246).

The released-artifact run, a cold cache that downloads bb itself, belongs to phase 6.
