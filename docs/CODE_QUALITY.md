# Code-quality guardrails

Readability is the objective. Complexity thresholds identify code that deserves review; they are not
targets to satisfy by compressing statements, abbreviating names, or hiding control flow.

## TypeScript and JavaScript

Biome checks handwritten TypeScript and JavaScript throughout the repository, including root scripts
and configuration code. Generated output is excluded. The enforced limits are:

- cognitive complexity: 15;
- function length: 80 nonblank lines, including IIFEs;
- excessive nested test suites: rejected.

Test and suite callback bodies may carry a narrow function-length suppression because declarative test
registration is not production control flow. Test helpers remain subject to the limit. Any other
exception must name the rule and explain why extraction would make the code harder to understand.

## Rust

The desktop, core, and headless-server crates remain independent Cargo projects. Each manifest enables
`clippy::cognitive_complexity` and `clippy::too_many_lines`, while the shared `clippy.toml` sets their
thresholds to 15 and 80. `bun run lint:clippy` checks every target of all three crates against its
committed lockfile; `bun run lint:rust` checks formatting separately.

The tools count different things. Biome skips blank lines by explicit configuration. Clippy describes
its line rule only as the number of lines in a function or method, and its cognitive rule as an
imperfect heuristic rather than a measurement of human comprehension. Clippy analyzes expanded Rust,
so tracing and other macros can raise its reported score without adding visible branches.

Pinned Clippy 1.98 also reports both rules in ordinary `#[test]` functions when `--all-targets` is used;
the assumed cognitive-complexity exemption for tests does not apply to this configuration. Long or
branch-heavy test bodies therefore need the same refactoring or a narrow, reasoned exception.

Rust exceptions use `#[expect(..., reason = "...")]` on one function. Unlike a blanket `allow`, an
expectation warns when the function stops violating the rule, making obsolete exceptions visible.
The compilation-based Clippy gate currently runs on Linux; prepared macOS and Windows jobs compile
and exercise their platform-specific branches without claiming cross-platform Clippy coverage.
