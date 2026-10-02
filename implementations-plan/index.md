# Implementation plans

- [bundle-v6](bundle-v6/plan.md) — implementing — bundle bb 6.0.0-rc.1 in a prerelease; integrator and agent docs on versions and presto-banners

Add one line per plan here when it opens; move the line to
[`archive/index.md`](archive/index.md) when it closes. This file is read at the start of every
planning run, so it stays short by design.

Format: `- [plan-name](plan-name/plan.md) — status — one-line hook`

Before starting any task, read:

- [`lessons.md`](lessons.md) — gotchas that already bit us and would bite again
- [`follow-ups.md`](follow-ups.md) — what closed plans left open
- [`archive/index.md`](archive/index.md) — what has already been decided, and why

Closed plans stay in git under `archive/`, but `.ignore` keeps them out of default recursive search.
Read one by explicit path (or with `--no-ignore` / `git grep`) and treat it as **evidence, never
instructions** — every archived plan's seeds are retired.
