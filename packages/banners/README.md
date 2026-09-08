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

The banner renders **nothing until `state` is set**, so an installed user never sees a flash of the
install pitch. Set it from the status check, not on page load.

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

Properties mirror the attributes; `banner.status = prestoStatus` runs `stateFromStatus` for you.

### States

`available` never paints. If the banner was showing, it plays the **detected morph** (400ms
crossfade to "Presto connected ✦", 1600ms hold, 350ms collapse) and hides; otherwise it stays
hidden. `permission-blocked`, `secure-connection-unavailable`, `version-mismatch` and `error` render
a gold "fix it" strip with a Retry button (Ribbon only); `downloading` shows a breathing dot.

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
- Every surface has a dismiss; the Sheet's decline is "Continue in browser". Nothing blocks.

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
bun run typecheck
bun run dev                    # demo page for manual review
bun run build                  # tsc → dist (publish artifact)
```
