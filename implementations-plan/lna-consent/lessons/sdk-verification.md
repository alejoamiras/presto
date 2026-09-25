# SDK delivery verification (owner request, 2026-09-25)

The owner asked for high confidence that the SDK delivery is not broken before Aztec Labs adopts it.
Evidence, with what each one proves:

1. **Published artifact diff.** `npm pack` of the published `presto-core@1.1.0`,
   `presto@5.2.0-revision.3`, `presto-noir@1.1.0` and `presto-banners@1.1.0`, diffed against freshly
   packed candidates. Runtime changes in the SDK are exactly: the new `loopback-permission` module,
   three `index.js` re-exports, and the transport's private denied check becoming a one-line call to
   it. `presto-prover.js`, `presto-client.js` and every other runtime file are byte-identical. Types
   are additive only. `presto` newly ships `AGENTS.md` (intended) and `src/lib/docs-examples.test.ts`
   (test files already shipped before; tracked as a follow-up).
2. **Old-versus-new differential.** The published 1.1.0 denied check and the candidate's
   `loopbackPermission() === "denied"` run against 105 navigator shapes: missing or throwing
   `navigator` / `permissions` / `query`, every state per descriptor, rejections, sync throws,
   `undefined` / `null` / non-object statuses and throwing `state` getters. It found two regressions
   (a throwing getter made `loopbackPermission()` throw into the transport; a status-less
   `loopback-network` answer no longer fell back to `local-network-access`), fixed in b89d869 with
   unit tests that fail against e772d86. After the fix: 105 of 105 agree.
3. **Old tests on new code.** No pre-existing SDK or banner test lost an assertion: the only removed
   lines are two reformatted imports and two expected arrays extended by one element (the three
   `public-contract` tests now also pin the new exports); `element.test.ts` only gained cases. All
   pass.
4. **Real browser.** `lna.real.spec.ts` drives the workspace SDK core directly in Chromium's real
   Local Network Access gate: under a block, `loopbackPermission()` is `denied` and
   `PrestoClient.checkStatus()` returns `permission-blocked` after exactly one HTTPS attempt that the
   browser stops (no retry, no plaintext diagnosis, zero server hits, the same order as 1.1.0);
   `watchLoopbackPermission` reports the grant and the next read is `granted`. This restores SDK
   coverage the playground rewrite had removed (main's suite reached the transport through the old
   load-time probe).
5. **SDK CI lanes** (`sdk.yml` dispatched per package on `worktree-lna-consent`): at e772d86 runs
   36170213882 (presto: SDK E2E against the Aztec sandbox), 36170217051 (presto-core),
   36170220200 (presto-noir: WASM identity and Live Presto), 36170223520 (presto-banners); at
   b89d869 runs 36170738248, 36170741841, 36170744862, 36170748547. All green, every lane.

Known limit carried, not fixed: A5 (permission reads racing a change) in the consent example and
the playground controller. The browser still gates every request.
