# @alejoamiras/presto — notes for coding agents

Integrating this package into a dApp? Read the skill first:
[`.claude/skills/presto/SKILL.md`](.claude/skills/presto/SKILL.md) (shipped in this package, readable
by any agent, not only Claude).

Two facts agents get wrong:

- **Presto's app version is not an Aztec version.** Presto proves for the Aztec version this SDK
  sends with every request, and fetches the `bb` that version needs on first use. `/health.aztec_version`
  is only the version bundled with the app. See
  [Presto and Aztec versions](https://github.com/alejoamiras/presto#presto-and-aztec-versions).
- **Install and connect prompts already exist.** Use `<presto-banner>` from
  [`@alejoamiras/presto-banners`](https://github.com/alejoamiras/presto/tree/main/packages/banners);
  don't design your own.

The rule most integrations get wrong: **in a browser, never contact Presto on page load.** Chrome
142+ and Firefox 153+ ask the visitor for permission on the first request to Presto, and
`checkPrestoStatus()` is such a request even when `setForceLocal(true)` is set. Keep the prover
force-local, read `loopbackPermission()` (it never prompts), and connect only from a click that
explains the prompt first. The module to copy is in the README's
[Ask before you probe](README.md#ask-before-you-probe) section and in the skill.
