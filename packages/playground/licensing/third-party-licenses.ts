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
  source: (version: string) => string;
  texts: readonly string[];
  /** Printed above the texts; for discrepancies a reader should know about. */
  note?: string;
}

export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  note?: string;
  /** Licence and NOTICE texts, in file-name order. */
  texts: { file: string; text: string }[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-.].*)?$/i;
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

function readNotice(root: string, fallbacks: readonly LicenseFallback[]): PackageNotice {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: unknown;
  };
  const texts = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((file) => ({ file, text: readFileSync(join(root, file), "utf8").trim() }));
  const declared = typeof manifest.license === "string" ? manifest.license : undefined;
  if (texts.length > 0) {
    return {
      name: manifest.name,
      version: manifest.version,
      license: declared ?? UNDECLARED,
      texts,
    };
  }
  const fallback = fallbacks.find((rule) => rule.match(manifest.name));
  if (!fallback) throw new MissingLicenseText(`${manifest.name}@${manifest.version}`);
  const file = `(not shipped in the package; from ${fallback.source(manifest.version)})`;
  return {
    name: manifest.name,
    version: manifest.version,
    license: declared ?? fallback.license,
    note: fallback.note,
    texts: fallback.texts.map((text) => ({ file, text: text.trim() })),
  };
}

/** One notice per distinct `name@version` among the bundled modules, sorted for a stable diff. */
export function collectNotices(
  moduleIds: Iterable<string>,
  fallbacks: readonly LicenseFallback[] = [],
): PackageNotice[] {
  const roots = new Set<string>();
  for (const id of moduleIds) {
    const root = packageRootOf(id);
    if (root && existsSync(join(root, "package.json"))) roots.add(root);
  }
  const byKey = new Map<string, PackageNotice>();
  const missing: string[] = [];
  for (const root of roots) {
    try {
      const notice = readNotice(root, fallbacks);
      byKey.set(`${notice.name}@${notice.version}`, notice);
    } catch (error) {
      if (!(error instanceof MissingLicenseText)) throw error;
      missing.push(error.message);
    }
  }
  // Fail closed: shipping a package whose terms we cannot reproduce is the defect this file exists
  // to prevent, so a new one must be resolved by a human, not skipped.
  if (missing.length > 0) {
    throw new Error(
      `bundled packages ship no licence file; add a reviewed rule to licensing/license-fallbacks.ts for each: ${missing.sort().join(", ")}`,
    );
  }
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, notice]) => notice);
}

const RULE = "=".repeat(78);

export function renderNotices(notices: readonly PackageNotice[]): string {
  const header = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "This site's JavaScript and WebAssembly bundle contains the third-party packages listed below.",
    "Each is reproduced with the licence text and notices it ships with. The list is generated from",
    "the modules the bundler actually included, so it describes this build exactly.",
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
export function thirdPartyLicenses(fallbacks: readonly LicenseFallback[] = []): {
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
          source: renderNotices(collectNotices(moduleIds, fallbacks)),
        });
      },
    }),
  };
}
