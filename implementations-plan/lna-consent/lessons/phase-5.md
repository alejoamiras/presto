# Phase 5: playground consent flow

## What changed

- `PrestoStatusController` owns consent. `start()` reads the stored decision once; only `granted`
  connects without a click. `connect()` is the explained click (Continue, Try again, Retry) and
  proceeds on anything but `denied`. `permissionChanged()` takes watcher events. `beforeProving()`
  re-reads before each run and returns whether that run may go native. Every result lands through
  `#settle`, which classifies it (`permission-blocked` revokes; a definitive answer is shown and
  marks `reached`; an inconclusive one re-reads: `prompt` waits for the browser, `unsupported` adds
  the couldn't-connect hint).
- Two counters: `#epoch` owns display (bumped by refresh and revoke) and `#decisions` orders
  permission knowledge (bumped by every applied read or event). A read that raced a decision
  returns the decision's state and is not applied, so a watcher event always wins over a read in
  flight. `start()` also yields when any decision landed first, so a click during startup is not
  overwritten by the load-time read.
- `connectionView(phase)` wraps `prestoStatusView` and is the only source of labels, logs, the mode
  hint, the Connect link, the may-ask hint and the Try again panel. A unit test asserts no rendered
  string contains `loopback`, `127.0.0.1`, `localhost`, `local network` or `health check`.
- `ConfirmDialogController` generalises the HTTP confirmation; `httpSessionConsent()` builds the HTTP
  one, a second instance drives the connect dialog. Both are native `<dialog>` + `showModal()`; the
  hand-written Tab trap is gone. Escape (`cancel`), a backdrop click and a browser-forced `close` all
  cancel. Focus returns to the opener (connect) or to the Services panel (HTTP), and the render
  moves focus to the Services panel whenever the focused control was just hidden.
- `aztec.ts`: default mode `local`; `routeRun(native)` sets force-local for the run and returns the
  mode to report, which is Presto only while no mode change happened during the run. Run results no
  longer carry `mode`. `noir.ts` takes a mode getter and reads it after the lazy backend init.
- `e2e/connect.ts`: `connectPresto`, `mockPermission`, `setMockPermission`, `recordPresto`.

## Decisions made while implementing

- The dialog CSS needs `position: fixed` explicitly: `.panel` sets `position: relative`, which puts a
  top-layer dialog at the document origin (the same trap as the banner Sheet in phase 3), and
  preflight zeroes the auto margins that centre it.
- `refresh()` renders `checking` on every run, including the post-fallback refresh; the retry
  buttons show "Checking…" through `setPending` as before.
- Unauthorized always implies In-browser mode (revoke flips the mode, and the Presto button opens the
  dialog instead of switching), so `beforeProving()` never has to reconcile a Presto mode without
  consent.

## I2 (recorded)

Playwright's Chromium 151, on `http://localhost:*` and `http://127.0.0.1:*` pages: both
`loopback-network` and `local-network-access` queries return `prompt`, and the status objects support
change events. Local pages reaching 127.0.0.1 are not gated, so the local-network, smoke and
packaged specs connect through Connect → Continue, and Presto's answer (`reached`) lets proofs go
native despite the persistent `prompt`. `connectPresto` handles both that and a granted auto-connect.

## Gate

- `bun run test`: exit 0. Tarball check: presto-core, presto, presto-noir, presto-banners all
  `TARBALL_CHECK_OK`.
- `bun run --cwd packages/playground test:e2e`: 22 passed (17 demo, 5 Noir), including zero recorded
  requests on both Presto origins after a `prompt` load and after an in-browser Noir proof, with the
  validity check (the recorder sees the request after Continue).
- `bun run --cwd packages/playground build`: exit 0.
- `rg -n -i "loopback|127\.0\.0\.1" packages/playground/index.html`: no matches. String review: every
  literal passed to `appendLog`, `announce` or rendered by `connectionView` read by hand; none names
  an address or network jargon (the automated check covers the `connectionView` set).
- Screenshots (scratch, not committed): dialog in light/desktop and dark/phone ("may ask" variant),
  waiting-for-your-browser panel, blocked panel in dark.
