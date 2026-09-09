# @alejoamiras/presto-banners

Install banners for dApps that integrate Presto: a zero-dependency `<presto-banner>` web component
rendered in Shadow DOM with Presto's own tokens, type and motion, so the "get Presto" moment looks
the same on every site. Six surfaces, one state model, keyed to the SDK's `PrestoStatus`.

| Variant     | Shape                                  | Shows for                              |
|-------------|----------------------------------------|----------------------------------------|
| `ribbon`    | 44px full-width strip                  | every state (install, fix-it, connected) |
| `billboard` | inline solid-indigo bar                | `offline`                              |
| `dock`      | floating bottom-right, fixed           | `offline` (fire it when a proof starts in-browser) |
| `card`      | 300px sidebar card with illustration   | `offline`                              |
| `tile`      | 300×300 poster                         | static; ignores state                  |
| `sheet`     | centred modal over a backdrop, fixed   | `offline`, once before the first proof |

## Usage

```html
<script type="module">
  import { PrestoProver } from "@alejoamiras/presto";
  import "@alejoamiras/presto-banners/register"; // defines <presto-banner>

  const prover = new PrestoProver();
  const banner = document.querySelector("presto-banner");
  banner.status = await prover.checkPrestoStatus(); // maps to a banner state
  banner.addEventListener("presto-banner:retry", async () => {
    banner.status = await prover.checkPrestoStatus({ forceRefresh: true });
  });
</script>

<presto-banner variant="ribbon"></presto-banner>
```

The banner renders **nothing until `state` is set** (the static Tile is the one exception), so an
installed user never sees a flash of the install pitch. Set it from the status check, not on page load.

### Attributes

| Attribute      | Values                                                    | Default             |
|----------------|-----------------------------------------------------------|---------------------|
| `variant`      | `ribbon` `billboard` `dock` `card` `tile` `sheet`         | `ribbon`            |
| `state`        | `offline` `permission-blocked` `secure-connection-unavailable` `version-mismatch` `error` `downloading` `available` | unset (hidden) |
| `theme`        | `auto` `light` `dark`                                     | `auto`              |
| `href`         | install link                                              | `https://presto.build` |
| `persist-key`  | `localStorage` prefix for dismissals                      | `presto:banner`     |
| `dismiss-days` | how long a dismissal lasts                                | `7`                 |
| `fonts`        | `google` (links Bricolage Grotesque + Figtree once) or `none` | `google`        |
| `os`           | `macOS` `Windows` `Linux`, forces the Sheet's CTA label   | detected from the user agent |

Set attributes with `setAttribute()`. Two properties exist on top: `banner.state` (read/write,
reflects the attribute) and `banner.status = prestoStatus` (write-only, runs `stateFromStatus`).
`variant`, `href`, `platform`, `dismissDays` and `persistKey` are read-only getters. Changing `href`
or `os` patches the CTA in place; the Sheet's checkbox and focus survive.

### States

`available` never paints. If the banner was showing, it plays the **detected morph** (400ms
crossfade to "Presto connected ✦", 1600ms hold, 350ms collapse) and hides; otherwise it stays
hidden. `permission-blocked`, `secure-connection-unavailable`, `version-mismatch` and `error` render
a gold "fix it" strip with a Retry button (Ribbon only); `downloading` shows a breathing dot.

`stateFromStatus` knows one SDK subtlety: under the browser's HTTPS-only default an *uninstalled*
Presto reports `secure-connection-unavailable` with diagnosis `unconfirmed`, not `offline`. That pair
maps to `offline` (the install pitch); the other diagnoses mean Presto is there and HTTPS needs fixing.

### Events

All bubble and are `composed`; `detail` carries `{ variant, state, href }`.

- `presto-banner:cta`: install link activated. `preventDefault()` to stop navigation.
- `presto-banner:retry`: re-run `checkPrestoStatus()` and set `status` again.
- `presto-banner:dismiss`: `detail.forever` is `true` from the Sheet's "Don't ask again".
- `presto-banner:collapsed`: the detected morph finished.

### Placement rules

- One status-driven surface per page: Ribbon *or* Billboard *or* Card.
- Dock only after a proof actually starts in the browser. Sheet once before the first proof.
- Dismissals persist per variant **and state**, so dismissing the pitch never silences a later
  "browser blocked local access".
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
