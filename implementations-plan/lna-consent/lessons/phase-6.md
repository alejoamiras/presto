# Phase 6: real browser, sandbox, release-gate specs, repo docs

## What changed

- `lna.real.spec.ts` now covers the playground's consent flow against Chromium's real Local Network
  Access gate (public-address page, loopback health responder): nothing sent 8 s after a `prompt`
  load, with a recorder validity check; Continue then Allow through the separate HTTP confirmation;
  a blocked site recovering on a same-context grant; a grant after the check gave up; a reset to ask
  while a check is queued. The landing tests stay. The health responder gained `POST /__delay` so a
  check can be held in flight at the server.
- The sandbox (`demo.local-network`, `http-consent.local-network`), smoke (`demo.smoke`,
  `noir.smoke`) and packaged (`presto.packaged-e2e`) specs select Presto through `connectPresto`.
  `demo.production-smoke` asserts the In-browser default and no request to either Presto port.
- `packages/playground/README.md` gains a "Connecting to Presto" section; CLAUDE.md's current state
  records the core permission helpers, the banner `connect` state, the landing's no-detection rule,
  the playground's ask-first flow and the new test counts.

## Attempts

1. **Sandbox lane red at a686caf** (App run 36166215074, `local-network-e2e`): "Accelerated › deploys
   account" finished its deploy but `#time-accelerated` stayed `—`. Cause: `connectPresto` returned
   as soon as the mode flipped, while the first status check was still in flight. The spec clicked
   Deploy at once; `beforeProving()` read `prompt` with Presto not yet reached, so the run went
   in-browser and reported `local`. The product behaviour is the designed one (a run never waits on
   an unanswered check); the helper was wrong. Fix: `connectPresto` waits until the label leaves
   `not connected` / `checking…`. The in-flight Build Test Bundle run 36166218312 used the same
   helper, so it was cancelled and both lanes re-dispatched at the fix.
   Lesson: a helper that stands in for a visitor must wait for what the visitor waits for (the
   check's answer), not just the first DOM change the click causes. The mocked suite could not catch
   it: its mocked `/health` answers before Playwright's next action.

## Parallel work (reconciled 2026-09-25, `main` unmoved since the stack base)

- PR #54 (`landing-downloads`) merges cleanly as text but adds `<a id="download-alt" class="hero-alt
  hidden">`, and phase 4 had dropped the landing's `.hidden` rule as unused. Merged, that link would
  render as an empty full-width row in the hero. The rule is restored here so either merge order is
  safe.
- PR #55 (`coep-require-corp`) conflicts in `demo.production-smoke.spec.ts`: both edit the first
  test's name and its `page.goto("/")` line. The resolution keeps both (#55's header assertions on
  the `goto` response, this stack's In-browser and no-request assertions). Its `SKILL.md` COEP edit
  touches a different section and merges cleanly.

## Gate

- `bun run --cwd packages/playground test:e2e:lna`: 8 passed.
- `bun run --cwd packages/playground test:e2e:production-smoke`: 4 passed.
- `bun run --cwd packages/playground test:e2e`: 22 passed after the helper fix.
- `bun run test`: exit 0. Tarball check: presto-core, presto, presto-noir, presto-banners all
  `TARBALL_CHECK_OK`. `bun run lint:actions`: exit 0.
- Sandbox lane: no `aztec` CLI here, so the plan's CI fallback applies: `app.yml` dispatched on
  `lna-consent-sites` at b54f3f3, run 36167134658 green; its `Local Network E2E / App E2E
  (test:e2e:local-network)` job reports `7 passed (2.5m)`, and `Chromium LNA E2E` is green too.
- `test:e2e:smoke`: no HTTPS Presto is reachable from this machine, so the lane is unexercised
  (Fact 14) and is named as such in the PR body.
