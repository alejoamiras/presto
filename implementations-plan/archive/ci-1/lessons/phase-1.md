# ci-1 phase 1: apply #169 and re-pin the tripwire

- 2026-10-25 step 2 first attempt: `git apply` got an empty patch. A `git fetch origin main` run
  between step 1 and step 2 rewrote `FETCH_HEAD` to `main`. Fix: the step now names 49110f1.
- 2026-10-25 tripwire control: after #169's diff alone, the secrets test failed with exactly the two
  app-token strings (12 pass, 1 fail); after the re-pin, 17 pass.
- 2026-10-25 commit: SSH signing hung on the agent (`ssh-keygen -Y sign`); killed only this
  session's signer and reran with `env -u SSH_AUTH_SOCK git commit`; signature `G`.
- 2026-10-25 gate: PASS. Tree check 0, test delta 2 / empty, 9 files, no stale SHA (grep exit 1),
  `bun run test` 0 (test:scripts 362 pass, 3 env-gated skips that skip on `main` too, 0 fail),
  `bun run lint:actions` 0.
