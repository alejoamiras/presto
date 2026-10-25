import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditNpmBundle,
  evaluateFindings,
  npmBundle,
  parseAllowlist,
  parseBunAudit,
  parseCargoAudit,
} from "./dependency-audit.ts";
import { PINNED_NPM_DIR, pinnedNpmVersion } from "./workers-build.ts";

describe("dependency audit gate", () => {
  test("parses npm advisory ids from their canonical URL", () => {
    expect(
      parseBunAudit({
        undici: [
          {
            severity: "high",
            title: "WebSocket denial of service",
            url: "https://github.com/advisories/GHSA-example-1234-5678",
          },
        ],
      }),
    ).toEqual([
      {
        ecosystem: "npm",
        id: "GHSA-example-1234-5678",
        package: "undici",
        severity: "high",
        title: "WebSocket denial of service",
      },
    ]);
  });

  test("treats cargo-audit vulnerabilities as blocking even without CVSS", () => {
    expect(
      parseCargoAudit(
        {
          vulnerabilities: {
            list: [
              {
                advisory: { id: "RUSTSEC-2026-0001", title: "Memory safety issue" },
                package: { name: "example" },
              },
            ],
          },
        },
        "Cargo.lock",
      ),
    ).toEqual([
      {
        ecosystem: "rust",
        id: "RUSTSEC-2026-0001",
        package: "example",
        severity: "unknown",
        title: "Memory safety issue",
        source: "Cargo.lock",
      },
    ]);
  });

  test("accepts reviewed findings, reports lower severities, and blocks new or expired findings", () => {
    const findings = [
      {
        ecosystem: "npm" as const,
        id: "GHSA-accepted",
        package: "accepted",
        severity: "high" as const,
        title: "accepted",
      },
      {
        ecosystem: "npm" as const,
        id: "GHSA-expired",
        package: "expired",
        severity: "critical" as const,
        title: "expired",
      },
      {
        ecosystem: "npm" as const,
        id: "GHSA-low",
        package: "low",
        severity: "low" as const,
        title: "reported",
      },
    ];
    const base = {
      ecosystem: "npm" as const,
      reason: "reviewed",
      upgrade: "upgrade upstream",
    };
    const result = evaluateFindings(
      findings,
      [
        { ...base, id: "GHSA-accepted", package: "accepted", expires: "2026-12-01" },
        { ...base, id: "GHSA-expired", package: "expired", expires: "2026-08-01" },
      ],
      "2026-08-31",
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.reported).toHaveLength(1);
    expect(result.blocked.map((finding) => finding.id)).toEqual(["GHSA-expired"]);
  });

  test("validates the allowlist schema and real calendar dates", () => {
    expect(() =>
      parseAllowlist({
        reviewed: "2026-08-31",
        exceptions: [
          {
            ecosystem: "python",
            id: "CVE-example",
            package: "example",
            expires: "2026-02-29",
            reason: "reviewed",
            upgrade: "upgrade",
          },
        ],
      }),
    ).toThrow("invalid ecosystem");
    expect(() => parseAllowlist({ reviewed: "2026-02-29", exceptions: [] })).toThrow(
      "real YYYY-MM-DD date",
    );
  });
});

const PIN = "11.21.1";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Manifest = { name: string; version: string } | null;

/**
 * An installed npm reached through a symlink, as Bun links it, bundling each `path → version`
 * (or an explicit manifest, `null` for none) under its `node_modules`.
 */
function installedNpm(
  packages: Record<string, string | Manifest>,
  root: Manifest = { name: "npm", version: PIN },
) {
  const base = mkdtempSync(join(tmpdir(), "npm-bundle-"));
  roots.push(base);
  const real = join(base, "store", "npm");
  mkdirSync(join(real, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(real, "package.json"), JSON.stringify(root));
  for (const [path, spec] of Object.entries(packages)) {
    const dir = join(real, "node_modules", path);
    mkdirSync(dir, { recursive: true });
    const name = path.split("/node_modules/").at(-1);
    const manifest = typeof spec === "string" ? { name, version: spec } : spec;
    if (manifest) writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  }
  const link = join(base, "npm");
  symlinkSync(real, link);
  return { link, real };
}

describe("npm bundle walk", () => {
  test("walks the bundle through Bun's link, scoped and nested packages included", () => {
    const { link } = installedNpm({
      "ip-address": "10.7.2",
      "@npmcli/arborist": "9.9.3",
      minipass: "7.1.3",
      "minipass-pipeline": "1.2.4",
      "minipass-pipeline/node_modules/minipass": "3.3.6",
    });
    expect(npmBundle(link, PIN)).toEqual({
      "@npmcli/arborist": ["9.9.3"],
      "ip-address": ["10.7.2"],
      minipass: ["3.3.6", "7.1.3"],
      "minipass-pipeline": ["1.2.4"],
    });
  });

  test("fails closed on anything the walk cannot account for", () => {
    const bundled = (packages: Record<string, string | Manifest>, root?: Manifest) =>
      npmBundle(installedNpm(packages, root).link, PIN);
    expect(() => bundled({ a: "1.0.0" }, { name: "npm", version: "11.20.0" })).toThrow(
      "not npm@11.21.1",
    );
    expect(() => bundled({ a: "1.0.0" }, { name: "pnpm", version: PIN })).toThrow(
      "not npm@11.21.1",
    );
    expect(() => bundled({})).toThrow("bundles no packages");
    expect(() => bundled({ a: null })).toThrow("has no readable package.json");
    const literalNull = installedNpm({ a: "1.0.0" });
    writeFileSync(join(literalNull.real, "node_modules", "a", "package.json"), "null");
    expect(() => npmBundle(literalNull.link, PIN)).toThrow("a/package.json is not an object");
    expect(() => bundled({ a: { name: "b", version: "1.0.0" } })).toThrow("declares the name b");
    expect(() => bundled({ a: { name: "a", version: "latest" } })).toThrow(
      "declares the version latest",
    );
    const { link, real } = installedNpm({ a: "1.0.0" });
    symlinkSync(join(real, "node_modules", "a"), join(real, "node_modules", "b"));
    expect(() => npmBundle(link, PIN)).toThrow("symlink inside npm's bundle");
  });
});

describe("bulk advisory audit", () => {
  test("sends the bundle to the bulk endpoint and refuses a malformed answer", async () => {
    const bundle = { undici: ["6.29.0"] };
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const answer = (status: number, body: unknown) => (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    const high = {
      id: 1,
      url: "https://github.com/advisories/GHSA-xjj6-f33q-929c",
      title: "undici denial of service",
      severity: "high",
    };

    const findings = await auditNpmBundle(
      bundle,
      "npm 11.21.1 bundle",
      answer(200, { undici: [high] }),
    );
    expect(calls[0]?.url).toBe("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(bundle);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(findings).toEqual([
      {
        ecosystem: "npm",
        id: "GHSA-xjj6-f33q-929c",
        package: "undici",
        severity: "high",
        title: "undici denial of service",
        source: "npm 11.21.1 bundle",
      },
    ]);
    expect(evaluateFindings(findings, [], "2026-10-25").blocked).toHaveLength(1);
    expect(await auditNpmBundle(bundle, "npm 11.21.1 bundle", answer(200, {}))).toEqual([]);

    await expect(auditNpmBundle(bundle, "s", answer(503, {}))).rejects.toThrow("HTTP 503");
    const html = () => Promise.resolve(new Response("<html>", { status: 200 }));
    await expect(auditNpmBundle(bundle, "s", html)).rejects.toThrow(
      "bulk advisory answer is not JSON",
    );
    for (const body of [
      [],
      { error: "x" },
      { undici: [{ ...high, severity: "HIGH" }] },
      { undici: [{ severity: "high" }] },
    ]) {
      await expect(auditNpmBundle(bundle, "s", answer(200, body))).rejects.toThrow(
        "bulk advisory answer",
      );
    }
  });
});

describe.skipIf(!process.env.PRESTO_LIVE_AUDIT)("live npm bundle audit", () => {
  test("the installed pin's bundle gets a well-formed answer from the registry", async () => {
    const root = join(import.meta.dir, "..");
    const pin = pinnedNpmVersion(
      JSON.parse(readFileSync(join(root, "packages/playground/package.json"), "utf8")),
    );
    const bundle = npmBundle(join(root, PINNED_NPM_DIR), pin);
    expect(Object.keys(bundle).length).toBeGreaterThanOrEqual(100);
    expect(Array.isArray(await auditNpmBundle(bundle, `npm ${pin} bundle`))).toBe(true);
  });
});
