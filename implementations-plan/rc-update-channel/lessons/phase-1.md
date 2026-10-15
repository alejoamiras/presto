# Phase 1: developer-mode contract

- `LoadedConfig::effective_channel` joins `ConfigStore::effective_channel` now, not in Phase 4:
  the install-time disk re-read needs it, and both share one private rule (read-only ⇒ Stable).
- Mutations, each red on exactly its test: off keeps the channel
  (`developer_off_resets_block_in_same_save`), a strict block (`malformed_developer_block_keeps_other_settings`),
  read-only follows the file (`effective_channel_table`).
- `lint:clippy` in a fresh worktree needs `bun run --cwd packages/presto frontend:build` and
  `bun packages/presto/scripts/copy-bb.ts` first (the build script reads the bundle manifest and the
  bb sidecar).
- Gate: core 401 + server 14 tests, `bun run lint:clippy` 0, `bun run lint` 0.
