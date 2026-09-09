# Noir fixture circuits

Reference inputs for Presto's UltraHonk route. Each directory holds a tiny Noir program, its
compiled artifact, an executed witness, and the **bb.js WASM** reference outputs that native `bb`
must reproduce byte for byte:

| Fixture | Circuit | Public inputs |
|---|---|---|
| `square` | `assert(x * x == y); pedersen_hash([x, y])` | 2 (`y` and the returned hash) |
| `nopub` | `assert(x * y == 42)` | 0 (bb writes an empty `public_inputs`) |
| `hashchain` | 1,024 dependent `pedersen_hash([h, y])` rounds (~176k gates): the playground's demo, heavy enough that native bb visibly beats WASM (~2 s vs ~10 s) | 2 (`y` and the final digest) |

`manifest.json` records sha256 and size for every file, the field counts of `proof` and
`public_inputs`, the verifier target (`noir-recursive-no-zk`, the deterministic family; ZK targets
are randomized and never byte-comparable), and the toolchain that produced the artifacts.

- Verify (CI): `bun scripts/noir-fixture.ts --verify` — also fails when the installed `@aztec/bb.js`
  no longer matches the manifest, so an Aztec bump forces a regeneration.
- Regenerate (dev box, needs `aztec-nargo` on PATH or `AZTEC_NARGO`):
  `bun scripts/noir-fixture.ts --regenerate [square nopub hashchain]`.
