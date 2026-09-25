# @alejoamiras/presto-banners

Install banners for dApps that integrate Presto: a zero-dependency `<presto-banner>` web component
rendered in Shadow DOM with Presto's own tokens, type and motion, so the "get Presto" moment looks
the same on every site. Six surfaces, one state model, keyed to the SDK's `PrestoStatus`, plus a
`connect` state that asks before the first request to Presto.

| Variant     | Shape                                  | Shows for                              |
|-------------|----------------------------------------|----------------------------------------|
| `ribbon`    | 44px full-width strip                  | every state (connect, install, fix-it, connected) |
| `billboard` | inline solid-indigo bar                | `connect`, `offline`                   |
| `dock`      | floating bottom-right, fixed           | `connect`, `offline` (fire it when a proof starts in-browser) |
| `card`      | 300px sidebar card with illustration   | `connect`, `offline`                   |
| `tile`      | 300×300 poster                         | static; `connect` swaps in the connect copy |
| `sheet`     | centred modal over a backdrop, fixed   | `connect`, `offline`, once before the first proof |

## Usage

```html
<script type="module">
  import { loopbackPermission, PrestoProver } from "@alejoamiras/presto";
  import "@alejoamiras/presto-banners/register"; // defines <presto-banner>

  const prover = new PrestoProver();
  prover.setForceLocal(true); // nothing reaches Presto until the visitor connects
  const banner = document.querySelector("presto-banner");

  async function connect() {
    prover.setForceLocal(false);
    banner.status = await prover.checkPrestoStatus({ forceRefresh: true }); // after the user connects
  }

  const permission = await loopbackPermission(); // never prompts, never contacts Presto
  if (permission === "granted") await connect();
  else banner.state = permission === "denied" ? "permission-blocked" : "connect";
  banner.addEventListener("presto-banner:connect", connect);
  banner.addEventListener("presto-banner:retry", connect);
</script>

<presto-banner variant="ribbon"></presto-banner>
```

**Do not check status on page load.** In Chrome 142+ and Firefox 153+ the first request to Presto
makes the browser ask the visitor to let this site reach apps on their device. The `connect` state
explains that question before the browser asks, and its button emits `presto-banner:connect`; only
a visitor who already allowed it connects without a click. The
[`@alejoamiras/presto` README](../sdk/README.md#ask-before-you-probe) adds the watcher that handles a
late answer or a reset.

The banner renders **nothing until `state` is set** (the static Tile is the one exception), so an
installed user never sees a flash of the install pitch.

### Attributes

| Attribute      | Values                                                    | Default             |
|----------------|-----------------------------------------------------------|---------------------|
| `variant`      | `ribbon` `billboard` `dock` `card` `tile` `sheet`         | `ribbon`            |
| `state`        | `connect` `offline` `permission-blocked` `secure-connection-unavailable` `version-mismatch` `error` `downloading` `available` | unset (hidden) |
| `theme`        | `auto` `light` `dark`                                     | `auto`              |
| `href`         | install link                                              | `https://presto.build` |
| `persist-key`  | `localStorage` prefix for dismissals                      | `presto:banner`     |
| `dismiss-days` | how long a dismissal lasts                                | `7`                 |
| `fonts`        | `google` (links Bricolage Grotesque + Figtree once) or `none` | `google`        |
| `os`           | `macOS` `Windows` `Linux`, forces the Sheet's install label | detected from the user agent |

Set attributes with `setAttribute()`. Two properties exist on top: `banner.state` (read/write,
reflects the attribute) and `banner.status = prestoStatus` (write-only, runs `stateFromStatus`).
`variant`, `href`, `platform`, `dismissDays` and `persistKey` are read-only getters. Changing `href`
or `os` patches the install links in place; the Sheet's checkbox and focus survive.

### States

`connect` is the one state `stateFromStatus` never returns: set it yourself when
`loopbackPermission()` reads `prompt` or `unsupported`, before anything has contacted Presto. Every
surface then says the browser may ask to let this site reach apps on this device, and offers a
**Connect** button (a `<button>`, never a link) plus, except on the Ribbon and Dock, a secondary
"Get Presto" install link. A click emits `presto-banner:connect` and the button reads "Connecting…"
until you set `state` or `status` again; setting the same state (`banner.state = "connect"`) also
ends the wait, so a check you abandon never strands it.

`available` never paints. If the banner was showing, it plays the **detected morph** (400ms
crossfade to "Presto connected ✦", 1600ms hold, 350ms collapse) and hides; otherwise it stays
hidden. `permission-blocked`, `secure-connection-unavailable`, `version-mismatch` and `error` render
a gold "fix it" strip with a Retry button (Ribbon only); `downloading` shows a breathing dot.

Adding `connect` to `BannerState` and `BANNER_STATES` is additive, but code that switches
exhaustively over `BannerState` or iterates `BANNER_STATES` sees one more value from 1.2.0.

`stateFromStatus` knows one SDK subtlety: under the browser's HTTPS-only default an *uninstalled*
Presto reports `secure-connection-unavailable` with diagnosis `unconfirmed`, not `offline`. That pair
maps to `offline` (the install pitch); the other diagnoses mean Presto is there and HTTPS needs fixing.

### Events

All bubble and are `composed`; `detail` carries `{ variant, state, href }`.

- `presto-banner:connect`: Connect pressed. Run your first `checkPrestoStatus()` now (the browser
  may ask) and set `status`, or set `state` if you stop.
- `presto-banner:cta`: install link activated. `preventDefault()` to stop navigation.
- `presto-banner:retry`: re-run `checkPrestoStatus()` and set `status` again.
- `presto-banner:dismiss`: `detail.forever` is `true` from the Sheet's "Don't ask again".
- `presto-banner:collapsed`: the detected morph finished.

### Placement rules

- One status-driven surface per page: Ribbon *or* Billboard *or* Card.
- Dock only after a proof actually starts in the browser. Sheet once before the first proof.
- Dismissals persist per variant **and state**, so dismissing the pitch never silences a later
  "browser blocked this site", and dismissing `connect` never silences the install pitch.
- Every status-driven surface has a dismiss; the Sheet is a native modal `<dialog>` whose decline
  is "Continue in browser" and whose Escape dismisses. The static Tile has no dismiss. Nothing blocks.

### Theming

Override the `--pb-*` custom properties on the element from the host page:

```css
presto-banner { --pb-accent: #3b4fe0; --pb-surface: #fff; }
```

`theme="auto"` follows `prefers-color-scheme`. Solid surfaces (Billboard, Tile) keep the indigo in
both themes by design.

## Development

```bash
bun test                       # bun:test + happy-dom
bun run test:lint
bun run dev                    # demo page for manual review
bun run build                  # tsc → dist (publish artifact)
```

`exports` point at TypeScript source for workspace consumers, like the SDK; the published package
(`npm install @alejoamiras/presto-banners`) maps `.` and `./register` to `dist/` with `types` +
`default` conditions and carries no dependencies. Releases go through `release-sdk.yml`
(`packages=presto-banners`) with npm provenance; see `docs/RELEASE_RUNBOOK.md`.

## License

[MIT](LICENSE). All four `@alejoamiras/presto*` npm packages are MIT. The Presto desktop app and the rest of the repository are AGPL-3.0-only; the [repository README](https://github.com/alejoamiras/presto#license) explains the split.
