# Presto Landing Page

Static landing page for the Presto project.

The page never contacts Presto: it has no detection, so the browser has no reason to ask whether the
site may reach apps on this device. Visitors who already run Presto follow the playground link, which
asks before it connects. Keep it that way: an unprompted status check from here would put the
browser's permission prompt on a marketing page, with nothing on screen explaining it.

## Live Site

[presto.build](https://presto.build)

## Development

```bash
cd packages/landing
bun run dev       # Start dev server
bun run build     # Build for production (output: dist/)
bun run preview   # Preview production build locally
```

## Deployment

Cloudflare Workers Builds deploys every push to `main` and posts a Worker Preview URL on every other branch's PR ([setup](../../docs/CLOUDFLARE_DEPLOYMENT.md#workers-builds-landing-and-playground)). Hosted with Cloudflare Workers Static Assets.

## License

[AGPL-3.0](../../LICENSE)
