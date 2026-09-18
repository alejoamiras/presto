# Support

## Where to ask

Use [GitHub Issues](https://github.com/alejoamiras/presto/issues) for reproducible bugs,
installation problems, documentation gaps, and feature requests. Search existing issues first and
keep one problem per issue.

For a bug, include:

- which component: `@alejoamiras/presto`, `presto-core`, `presto-noir`, `presto-banners`, the desktop
  app, the headless server, the landing site, or the playground;
- the exact version and how you installed it;
- operating system, architecture, browser, and the Aztec or `bb` version where relevant;
- expected and actual behavior;
- minimal reproduction steps; and
- the smallest useful log excerpt or screenshot.

If the SDK fell back to WASM when you expected native proving, the `reason` and `phase` on the
fallback result are the two most useful things you can paste — they name which check declined.

**Review logs before posting them.** They can contain approved origin names, local filesystem paths,
and `bb` diagnostics. Never post a private witness, wallet material, credentials, access tokens,
signing material, or unrelated personal data. See [PRIVACY.md](PRIVACY.md) for what is written where.

Suspected security vulnerabilities must be reported privately under [SECURITY.md](SECURITY.md), not
through an issue. Conduct concerns use the private contact in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Support policy

Support is best effort and has no response-time SLA — this is a solo-maintained project. The
maintained targets are the current desktop release and the npm `latest` dist-tag of each package;
upgrade before requesting a fix for an older version where you can. The headless server is supported
only as an ephemeral, single-tenant CI accelerator, not as a shared or long-running service.

## Read first

- [Desktop installation and troubleshooting](packages/presto/README.md)
- [Aztec SDK](packages/sdk/README.md) · [Noir SDK](packages/sdk-noir/README.md) ·
  [shared core](packages/sdk-core/README.md) · [banners](packages/banners/README.md)
- [Platform support](docs/PLATFORM_SUPPORT.md)
- [Security model](docs/SECURITY_MODEL.md) — the accepted trust boundaries, worth checking before
  reporting behavior that looks like a weakness
- [Migrating from the project's former name](packages/sdk/MIGRATION.md)

General Aztec protocol, node, wallet, or `bb` questions belong with the corresponding Aztec project
unless Presto is what introduced the problem.
