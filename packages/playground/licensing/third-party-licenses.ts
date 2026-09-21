import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

export const THIRD_PARTY_LICENSES_FILE = "third-party-licenses.txt";

/** What to reproduce for a bundled package that ships no licence file of its own. */
export interface LicenseFallback {
  /** First matching rule wins, so order specific rules before scope-wide ones. */
  match: (name: string) => boolean;
  /** SPDX id of `texts`; shown only when the manifest declares no `license` itself. */
  license: string;
  /** Where each text was taken from, printed so a reader can check it. */
  source: string;
  texts: readonly string[];
  /** Printed above the texts; for discrepancies a reader should know about. */
  note?: string;
}

/** Terms a package's own licence file leaves out, e.g. the second half of an `A AND B` expression. */
export interface LicenseSupplement {
  match: (name: string) => boolean;
  source: string;
  texts: readonly string[];
}

/** A package inlined into a host's prebuilt output, so no module id ever names it. */
export interface EmbeddedComponent {
  name: string;
  version: string;
  license: string;
  source: string;
  texts: readonly string[];
}

/**
 * The reviewed inventory of what a host inlines. `sourceMaps` (relative to the host) are the
 * evidence: the `name@version` pairs their `sources` name must equal `components`, so a host upgrade
 * that embeds something new or different fails the build instead of shipping a stale notice.
 */
export interface EmbeddedComponents {
  host: string;
  sourceMaps: readonly string[];
  components: readonly EmbeddedComponent[];
}

export interface LicensePolicy {
  fallbacks?: readonly LicenseFallback[];
  supplements?: readonly LicenseSupplement[];
  embedded?: readonly EmbeddedComponents[];
}

export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  note?: string;
  /** Licence and NOTICE texts, in file-name order. */
  texts: { file: string; text: string }[];
}

const LICENSE_FILE = /^(licen[cs]e|copying)([-.].*)?$/i;
const NOTICE_FILE = /^notice([-.].*)?$/i;
// Shorter than any real licence: rejects an empty file or a bare SPDX id posing as the terms.
const MIN_LICENSE_TEXT = 100;
const NODE_MODULES = "/node_modules/";

/**
 * The installed package a bundled module belongs to, or `undefined` for first-party and virtual
 * modules. Takes the LAST `node_modules` segment: Bun's store nests the real package under
 * `node_modules/.bun/<name>@<version>/node_modules/<name>`.
 */
export function packageRootOf(moduleId: string): string | undefined {
  // Rollup-style ids carry a `\0` virtual prefix and `?query` suffixes; Windows ids use backslashes.
  const id = moduleId.replace(/^\0+/, "").split("?")[0].replaceAll("\\", "/");
  const at = id.lastIndexOf(NODE_MODULES);
  if (at === -1) return undefined;
  const [first, second] = id.slice(at + NODE_MODULES.length).split("/");
  if (!first || first.startsWith(".")) return undefined;
  const name = first.startsWith("@") ? `${first}/${second}` : first;
  if (first.startsWith("@") && !second) return undefined;
  return id.slice(0, at + NODE_MODULES.length) + name;
}

const UNDECLARED = "UNDECLARED (see the text below)";

class MissingLicenseText extends Error {}

function readNotice(root: string, policy: LicensePolicy): PackageNotice {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: unknown;
  };
  const read = (pattern: RegExp) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .map((file) => ({ file, text: readFileSync(join(root, file), "utf8").trim() }));
  // A NOTICE is attribution, not terms: it is always reproduced but never satisfies the requirement.
  const notices = read(NOTICE_FILE);
  const licenses = read(LICENSE_FILE).filter(({ text }) => text.length >= MIN_LICENSE_TEXT);
  const declared = typeof manifest.license === "string" ? manifest.license : undefined;
  const base = { name: manifest.name, version: manifest.version };
  const extra = (policy.supplements ?? [])
    .filter((rule) => rule.match(manifest.name))
    .flatMap((rule) =>
      rule.texts.map((text) => ({ file: `(from ${rule.source})`, text: text.trim() })),
    );
  if (licenses.length > 0) {
    // One licence file cannot be assumed to carry both halves of a conjunction (pako: MIT file,
    // zlib terms only in source comments), so an `AND` needs a reviewed supplement.
    if (declared && /\bAND\b/.test(declared) && extra.length === 0) {
      throw new MissingLicenseText(`${manifest.name}@${manifest.version} (${declared})`);
    }
    return { ...base, license: declared ?? UNDECLARED, texts: [...licenses, ...extra, ...notices] };
  }
  const fallback = (policy.fallbacks ?? []).find((rule) => rule.match(manifest.name));
  if (!fallback) throw new MissingLicenseText(`${manifest.name}@${manifest.version}`);
  const file = `(not shipped in the package; from ${fallback.source})`;
  return {
    ...base,
    license: declared ?? fallback.license,
    note: fallback.note,
    texts: [...fallback.texts.map((text) => ({ file, text: text.trim() })), ...extra, ...notices],
  };
}

// pnpm/Bun store segment: `<name>@<version><suffix>/node_modules/`, where the suffix is a patch
// hash (`_…`), a Bun build hash (`+…`) or a peer set (`(…)`), none of them part of the version.
const STORE_ENTRY = /\/((?:@[^/@]+\+)?[^/@]+)@(\d[^/_+(]*)[^/]*\/node_modules\//g;

function embeddedNotices(hostRoot: string, inventory: EmbeddedComponents): PackageNotice[] {
  const found = new Set<string>();
  for (const map of inventory.sourceMaps) {
    const { sources } = JSON.parse(readFileSync(join(hostRoot, map), "utf8")) as {
      sources: string[];
    };
    for (const source of sources) {
      const entries = [...source.matchAll(STORE_ENTRY)];
      // A dependency path this cannot identify would slip past the comparison below.
      if (entries.length === 0 && source.includes("node_modules")) {
        throw new Error(`${inventory.host} inlines ${source}, which names no package@version`);
      }
      for (const [, name, version] of entries) found.add(`${name.replace("+", "/")}@${version}`);
    }
  }
  const declared = new Set(inventory.components.map(({ name, version }) => `${name}@${version}`));
  const drift = [...found.symmetricDifference(declared)].sort();
  if (drift.length > 0) {
    throw new Error(
      `${inventory.host} no longer embeds what licensing/license-fallbacks.ts reviewed; re-check: ${drift.join(", ")}`,
    );
  }
  return inventory.components.map(({ name, version, license, source, texts }) => ({
    name,
    version,
    license,
    note: `inlined into ${inventory.host}'s prebuilt output.`,
    texts: texts.map((text) => ({ file: `(from ${source})`, text: text.trim() })),
  }));
}

function bundledRoots(moduleIds: Iterable<string>): Set<string> {
  const roots = new Set<string>();
  for (const id of moduleIds) {
    const root = packageRootOf(id);
    if (root && existsSync(join(root, "package.json"))) roots.add(root);
  }
  return roots;
}

/** Reads every root, collecting the unreproducible ones instead of stopping at the first. */
function readAll(roots: Iterable<string>, policy: LicensePolicy) {
  const read: { root: string; notice: PackageNotice }[] = [];
  const missing: string[] = [];
  for (const root of roots) {
    try {
      read.push({ root, notice: readNotice(root, policy) });
    } catch (error) {
      if (!(error instanceof MissingLicenseText)) throw error;
      missing.push(error.message);
    }
  }
  // Fail closed: shipping a package whose terms we cannot reproduce is the defect this file exists
  // to prevent, so a new one must be resolved by a human, not skipped.
  if (missing.length > 0) {
    throw new Error(
      `bundled packages whose terms are not fully reproduced; add a reviewed rule to licensing/license-fallbacks.ts for each: ${missing.sort().join(", ")}`,
    );
  }
  return read;
}

/** One notice per distinct `name@version` among the bundled modules, sorted for a stable diff. */
export function collectNotices(
  moduleIds: Iterable<string>,
  policy: LicensePolicy = {},
): PackageNotice[] {
  const read = readAll(bundledRoots(moduleIds), policy);
  const byKey = new Map(read.map(({ notice }) => [`${notice.name}@${notice.version}`, notice]));
  // After every real package, and only where absent: a package's own files (NOTICE, supplements)
  // outrank the vendored text of the same name@version, whatever order the roots arrived in.
  for (const { root, notice } of read) {
    const inlined = (policy.embedded ?? [])
      .filter(({ host }) => host === notice.name)
      .flatMap((inventory) => embeddedNotices(root, inventory));
    for (const item of inlined) {
      const key = `${item.name}@${item.version}`;
      if (!byKey.has(key)) byKey.set(key, item);
    }
  }
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, notice]) => notice);
}

const RULE = "=".repeat(78);

export function renderNotices(notices: readonly PackageNotice[]): string {
  const header = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "This site's JavaScript and WebAssembly bundle contains the third-party packages listed below.",
    "Each is reproduced with the licence text and notices it ships with, or with its upstream text",
    "where the package publishes none. The list is generated from the modules the bundler included,",
    "plus the components known to be embedded inside them.",
    "",
    `Packages: ${notices.length}`,
    "",
  ];
  const sections = notices.map((notice) =>
    [
      RULE,
      `${notice.name} ${notice.version}`,
      `License: ${notice.license}`,
      RULE,
      "",
      ...(notice.note ? [`Note: ${notice.note}`, ""] : []),
      ...notice.texts.flatMap(({ file, text }) => [`--- ${file} ---`, "", text, ""]),
    ].join("\n"),
  );
  return `${[...header, ...sections].join("\n").trimEnd()}\n`;
}

/**
 * Emits {@link THIRD_PARTY_LICENSES_FILE}. Web workers are separate bundles with their own plugin
 * pipeline, so `collect()` goes in `worker.plugins` and feeds the same set that `emit()` writes
 * from the main bundle — Vite finishes every worker bundle before the main `generateBundle`.
 */
export function thirdPartyLicenses(policy: LicensePolicy = {}): {
  collect: () => Plugin;
  emit: () => Plugin;
} {
  const moduleIds = new Set<string>();
  const gather = (ids: Iterable<string>) => {
    for (const id of ids) moduleIds.add(id);
  };
  return {
    collect: () => ({
      name: "third-party-licenses:collect",
      apply: "build",
      generateBundle() {
        gather(this.getModuleIds());
      },
    }),
    emit: () => ({
      name: "third-party-licenses:emit",
      apply: "build",
      generateBundle() {
        gather(this.getModuleIds());
        this.emitFile({
          type: "asset",
          fileName: THIRD_PARTY_LICENSES_FILE,
          source: renderNotices(collectNotices(moduleIds, policy)),
        });
      },
    }),
  };
}
