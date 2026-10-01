# Updater testing

The release pipeline exercises the real N-1 → N updater path before publishing an presto release. All release-time updater smokes consume artifacts and feed fragments signed by the isolated `sign-updater-artifacts` job; no smoke job can read the production updater private key.

## Signing boundary

Desktop build jobs generate a throwaway updater key because Tauri requires one while producing updater bundles. Those signatures are excluded from the uploaded build artifacts.

After all four desktop builds finish, the `release-signing` environment exposes the production key to one short job. Before the key is available, that job checks out the intended commit, installs pinned tooling, builds the locked Rust verifier, and downloads the exact build outputs. The current key-scoped step performs only:

- sign the four updater payloads;
- verify every payload signature against the public key embedded in `tauri.conf.json`;
- assemble and verify `latest.json`;
- assemble and verify one-platform `smoke-latest.json` feeds.

It never builds, installs, launches, or smoke-tests an application. Downstream jobs receive only signed artifacts and feeds.

This is secret scoping, not an independent security sandbox: repository code in the signing job is still trusted. In the solo-maintainer setup, protect `main`, restrict the environment to `main`, and inspect signing-workflow changes before release. Add an independent environment reviewer or external signing service only if protection against a compromised maintainer or malicious code already merged to `main` becomes part of the threat model.

The throwaway build keys therefore test whether a new binary can be produced. The production key is tested by signature verification and by the N-1 clients accepting the signed N payloads in the updater smokes.

## Release-blocking automated coverage

`release-presto.yml` blocks draft creation unless all of these pass:

- **macOS Apple Silicon and Intel, positive:** install the current stable N-1 DMG, serve the production-signed N payload from a local TLS endpoint impersonating the configured production host, then require the app to update, relaunch, and report N from `/health`.
- **macOS Apple Silicon, negative:** append a byte to the genuine payload while retaining its signature and require N-1 to reject it and still answer `/health`.
- **Linux x86_64, positive:** run the N-1 AppImage natively under FUSE/Xvfb, update the file in place, require its checksum to change, then require the relaunched app to report N.
- **Windows x86_64, positive and negative:** install the pinned real N-1 NSIS fixture, require a production-signed N update to apply, and separately require a tampered payload to be rejected with N-1 still running.

Every positive run then requires N's own update check on disk: `assert-update-schedule.ts` accepts `~/.presto/update-schedule.json` only if N wrote it after `/health` first reported N. N-1 writes the same file before it installs, so the version and the time are both checked.
- **Bundle/notarization checks:** enforce the macOS bundle shape and verify both DMGs' code signatures and stapled notarization tickets.

## Ephemeral smokes (manual dispatch)

`smoke-updater-unix.yml` (macOS and Linux) and `smoke-updater-windows.yml` build both ends from the dispatched ref: a synthetic N-1 at 0.0.1 and N at `n-version`, signed with a run-local throwaway key. They are the only lanes where unreleased updater code runs as the old side of an update, so dispatch them before merging a change to the updater, its schedule, or these scripts:

```bash
gh workflow run smoke-updater-unix.yml --ref <branch> -f mode=<positive|negative|prompt|stall>
gh workflow run smoke-updater-windows.yml --ref <branch> -f mode=<positive|negative|prompt|barrier|copy-initiator>
```

- `positive`, `negative`: as in the release lanes.
- `prompt`: auto-update off. N-1 must log `Update prompt presented version=N`. After a restart with a schedule file snoozing N, it must log `Update snoozed; prompt suppressed` and show nothing for 30 s. On Linux, the smoke then clicks the tray's **Check for Updates…** through the menu libappindicator exports on the session bus (`scripts/tray-menu.ts`, via `busctl`). The same menu event a desktop tray host sends, in the hook-free release binary. N must then be presented despite the snooze, and the item must return to its idle label. macOS and Windows expose no scriptable tray menu, so they skip that step. With the snooze moved to another version, it must present again. Each launch is judged only on its own lines: its stdout on macOS and Linux, the Windows log read from an offset recorded before the launch. A daily log rotation during a launch fails the run.
- `stall` (macOS and Linux): `updater-feed-server.ts --stall-after 65536` sends a genuine prefix of N and holds the connection open. N-1 must log `Update download stalled; aborting` 60–120 s after the last byte, keep serving `/health` from the same PID, and record no pending install in `updater-state.json`.
- `barrier`, `copy-initiator` (Windows): the update-window marker lifecycle; the workflow's header describes both.

The macOS and Linux scripts share `updater-smoke-modes.sh`, which launches the app as its own process group so a relaunch stops exactly that app. Every script refuses a mode its workflow does not allow, and `release-contract.test.ts` pins each list to its workflow's. Both workflows fail a build of N-1 or N that contains `PRESTO_E2E_TRAY_REPORT` (`assert-no-test-hooks.sh`), so the WebDriver-only tray hooks never reach a binary built like a release.

The local feed is never public and never writes the production KV feed. A prerelease publish is also safe for installed users: it is a GitHub prerelease without `latest.json`, and publishing never flips the live feed.

## What remains manual

For a release that changes Windows trust, certificate installation, onboarding, or the HTTPS listener, complete the real-Windows composed-proof procedure in the [presto README](README.md#windows-composed-proof--manual-pre-ga-check). GitHub-hosted Windows runners cannot approve the interactive root-CA consent dialog.

For a high-risk macOS updater change, a manual installed-app check is still useful as a final sanity check:

1. Install the current stable N-1 DMG in `/Applications` and confirm `/health` reports N-1.
2. Publish N without promoting it.
3. Serve or temporarily select N through a controlled local updater test setup; do not hand-edit the production feed.
4. Trigger the update and confirm the app relaunches, the tray returns, and `/health` reports N.
5. If it hangs or fails to relaunch, do not promote the release.

The automated gates are authoritative for ordinary releases; this manual check is not a substitute for a failed CI gate.
