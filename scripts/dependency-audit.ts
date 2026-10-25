import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isExactSemver } from "./npm-packages.ts";
import { PINNED_NPM_DIR, pinnedNpmVersion } from "./workers-build.ts";

type Ecosystem = "npm" | "rust";
type Severity = "critical" | "high" | "moderate" | "low" | "unknown";

export interface AuditFinding {
  ecosystem: Ecosystem;
  id: string;
  package: string;
  severity: Severity;
  title: string;
  source?: string;
}

export interface AuditException {
  ecosystem: Ecosystem;
  id: string;
  package: string;
  expires: string;
  reason: string;
  upgrade: string;
}

interface Allowlist {
  reviewed: string;
  exceptions: AuditException[];
}

interface BunAdvisory {
  severity?: string;
  title?: string;
  url?: string;
  id?: number | string;
}

interface CargoAuditReport {
  vulnerabilities?: {
    list?: Array<{
      advisory?: { id?: string; title?: string };
      package?: { name?: string };
    }>;
  };
  warnings?: Record<string, unknown[]>;
}

const BLOCKING_SEVERITIES = new Set<Severity>(["critical", "high"]);
const BULK_ADVISORIES = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
// A registry can accept the connection and never answer; the audit job's own limit is 15 minutes.
const BULK_ADVISORIES_TIMEOUT_MS = 180_000;
const ADVISORY_SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function parseAllowlist(value: unknown): Allowlist {
  if (!value || typeof value !== "object")
    throw new Error("dependency audit allowlist must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.reviewed !== "string" || !isIsoDate(input.reviewed)) {
    throw new Error("dependency audit allowlist reviewed must be a real YYYY-MM-DD date");
  }
  if (!Array.isArray(input.exceptions)) {
    throw new Error("dependency audit allowlist exceptions must be an array");
  }
  const exceptions = input.exceptions.map((value, index) => {
    if (!value || typeof value !== "object")
      throw new Error(`exception ${index} must be an object`);
    const item = value as Record<string, unknown>;
    if (item.ecosystem !== "npm" && item.ecosystem !== "rust") {
      throw new Error(`exception ${index} has invalid ecosystem`);
    }
    for (const field of ["id", "package", "reason", "upgrade"] as const) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        throw new Error(`exception ${index} must include ${field}`);
      }
    }
    if (typeof item.expires !== "string" || !isIsoDate(item.expires)) {
      throw new Error(`exception ${index} has invalid expiry`);
    }
    return item as unknown as AuditException;
  });
  return { reviewed: input.reviewed, exceptions };
}

function exceptionKey(item: Pick<AuditFinding | AuditException, "ecosystem" | "id" | "package">) {
  return `${item.ecosystem}:${item.id}:${item.package}`;
}

function normalizeSeverity(value: string | undefined): Severity {
  return value === "critical" || value === "high" || value === "moderate" || value === "low"
    ? value
    : "unknown";
}

export function parseBunAudit(report: Record<string, BunAdvisory[]>): AuditFinding[] {
  return Object.entries(report).flatMap(([packageName, advisories]) =>
    advisories.map((advisory) => ({
      ecosystem: "npm" as const,
      id: advisory.url?.split("/").at(-1) ?? String(advisory.id ?? "unknown"),
      package: packageName,
      severity: normalizeSeverity(advisory.severity),
      title: advisory.title ?? "Untitled npm advisory",
    })),
  );
}

export function parseCargoAudit(report: CargoAuditReport, source: string): AuditFinding[] {
  return (report.vulnerabilities?.list ?? []).map((item) => ({
    ecosystem: "rust" as const,
    id: item.advisory?.id ?? "unknown",
    package: item.package?.name ?? "unknown",
    // RustSec does not require a CVSS score. cargo-audit's vulnerability set is fail-closed.
    severity: "unknown" as const,
    title: item.advisory?.title ?? "Untitled RustSec advisory",
    source,
  }));
}

export function evaluateFindings(
  findings: AuditFinding[],
  exceptions: AuditException[],
  today: string,
) {
  const { exceptionMap, invalidExceptions } = validateExceptions(exceptions);
  const accepted: Array<{ finding: AuditFinding; exception: AuditException }> = [];
  const blocked: AuditFinding[] = [];
  const reported: AuditFinding[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    classifyFinding(finding, exceptionMap, today, { accepted, blocked, reported, seen });
  }

  const stale = exceptions.filter((exception) => !seen.has(exceptionKey(exception)));
  return { accepted, blocked, reported, stale, invalidExceptions };
}

function validateExceptions(exceptions: AuditException[]) {
  const exceptionMap = new Map<string, AuditException>();
  const invalidExceptions: string[] = [];

  for (const exception of exceptions) {
    const key = exceptionKey(exception);
    if (exceptionMap.has(key)) invalidExceptions.push(`${key} is duplicated`);
    if (!isIsoDate(exception.expires)) {
      invalidExceptions.push(`${key} has invalid expiry ${exception.expires}`);
    }
    if (!exception.reason.trim() || !exception.upgrade.trim()) {
      invalidExceptions.push(`${key} must include reason and upgrade guidance`);
    }
    exceptionMap.set(key, exception);
  }
  return { exceptionMap, invalidExceptions };
}

interface FindingBuckets {
  accepted: Array<{ finding: AuditFinding; exception: AuditException }>;
  blocked: AuditFinding[];
  reported: AuditFinding[];
  seen: Set<string>;
}

function classifyFinding(
  finding: AuditFinding,
  exceptionMap: Map<string, AuditException>,
  today: string,
  buckets: FindingBuckets,
): void {
  const key = exceptionKey(finding);
  const exception = exceptionMap.get(key);
  const blocks = finding.ecosystem === "rust" || BLOCKING_SEVERITIES.has(finding.severity);
  if (!blocks) {
    buckets.reported.push(finding);
    return;
  }
  if (!exception || exception.expires < today) {
    buckets.blocked.push(finding);
    return;
  }
  buckets.accepted.push({ finding, exception });
  buckets.seen.add(key);
}

function readManifest(dir: string): { name: unknown; version: unknown } {
  let text: string;
  try {
    text = readFileSync(join(dir, "package.json"), "utf8");
  } catch {
    throw new Error(`${dir} has no readable package.json`);
  }
  const { name, version } = JSON.parse(text);
  return { name, version };
}

function refuseSymlink(path: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${path} is a symlink inside npm's bundle`);
}

/**
 * name → versions of every package npm bundles under `npmDir/node_modules`: its
 * `bundleDependencies`, which `bun.lock` does not record and which Node resolves before anything
 * Bun installed beside npm. Throws unless `npmDir` is npm at exactly `pin`, and on any entry the
 * walk cannot account for, so a layout change fails the audit instead of shrinking it.
 */
export function npmBundle(npmDir: string, pin: string): Record<string, string[]> {
  const root = readManifest(npmDir);
  if (root.name !== "npm" || root.version !== pin) {
    throw new Error(
      `${npmDir} is ${String(root.name)}@${String(root.version)}, not npm@${pin}; run bun install`,
    );
  }
  const bundle = new Map<string, Set<string>>();
  const visit = (dir: string, id: string) => {
    refuseSymlink(dir);
    const { name, version } = readManifest(dir);
    if (name !== id) throw new Error(`${dir} declares the name ${String(name)}`);
    if (typeof version !== "string" || !isExactSemver(version)) {
      throw new Error(`${dir} declares the version ${String(version)}`);
    }
    bundle.set(id, (bundle.get(id) ?? new Set()).add(version));
    const nested = join(dir, "node_modules");
    if (lstatSync(nested, { throwIfNoEntry: false })) walk(nested);
  };
  const walk = (nodeModules: string) => {
    refuseSymlink(nodeModules);
    for (const entry of readdirSync(nodeModules)) {
      if (entry.startsWith(".")) continue;
      const path = join(nodeModules, entry);
      if (!entry.startsWith("@")) {
        visit(path, entry);
        continue;
      }
      refuseSymlink(path);
      for (const scoped of readdirSync(path)) visit(join(path, scoped), `${entry}/${scoped}`);
    }
  };
  walk(join(npmDir, "node_modules"));
  if (!bundle.size) throw new Error(`${npmDir} bundles no packages`);
  return Object.fromEntries([...bundle].map(([name, versions]) => [name, [...versions].sort()]));
}

/** The bulk answer, checked first: `parseBunAudit` would read an unknown severity as non-blocking. */
function bulkAdvisories(body: unknown): Record<string, BunAdvisory[]> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("bulk advisory answer is not an object");
  }
  for (const [name, advisories] of Object.entries(body)) {
    const valid =
      Array.isArray(advisories) &&
      advisories.every(
        (advisory) =>
          advisory &&
          typeof advisory === "object" &&
          typeof advisory.url === "string" &&
          ADVISORY_SEVERITIES.has(advisory.severity),
      );
    if (!valid) throw new Error(`bulk advisory answer for ${name} is malformed`);
  }
  return body as Record<string, BunAdvisory[]>;
}

/** Audits `bundle` (name → versions) against the registry; each finding carries `source`. */
export async function auditNpmBundle(
  bundle: Record<string, string[]>,
  source: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<AuditFinding[]> {
  const response = await fetchImpl(BULK_ADVISORIES, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bundle),
    signal: AbortSignal.timeout(BULK_ADVISORIES_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`bulk advisory request failed: HTTP ${response.status}`);
  return parseBunAudit(bulkAdvisories(await response.json())).map((finding) => ({
    ...finding,
    source,
  }));
}

function runJson(command: string[], acceptedExitCodes: number[]): unknown {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (!acceptedExitCodes.includes(result.exitCode)) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`${command.join(" ")} failed (${result.exitCode}): ${stderr}`);
  }
  const stdout = result.stdout.toString().trim();
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${command.join(" ")} did not return valid JSON: ${String(error)}`);
  }
}

function printFinding(prefix: string, finding: AuditFinding) {
  const source = finding.source ? ` (${finding.source})` : "";
  console.log(
    `${prefix} ${finding.ecosystem}/${finding.severity} ${finding.id} ${finding.package}${source}`,
  );
  console.log(`  ${finding.title}`);
}

async function main() {
  const allowlistPath = new URL("./dependency-audit-allowlist.json", import.meta.url);
  const allowlist = parseAllowlist(await Bun.file(allowlistPath).json());
  const findings = parseBunAudit(
    runJson(["bun", "audit", "--json"], [0, 1]) as Record<string, BunAdvisory[]>,
  );

  const root = resolve(import.meta.dir, "..");
  const npmPin = pinnedNpmVersion(
    await Bun.file(join(root, "packages/playground/package.json")).json(),
  );
  const bundle = npmBundle(join(root, PINNED_NPM_DIR), npmPin);
  const bundleFindings = await auditNpmBundle(bundle, `npm ${npmPin} bundle`);
  findings.push(...bundleFindings);
  console.log(
    `npm ${npmPin} bundle: ${Object.keys(bundle).length} packages, ${Object.values(bundle).flat().length} versions sent, ${bundleFindings.length} advisories`,
  );

  const cargoLocks = [
    "packages/presto/core/Cargo.lock",
    "packages/presto/server/Cargo.lock",
    "packages/presto/src-tauri/Cargo.lock",
  ];
  let rustWarningCount = 0;
  for (const lock of cargoLocks) {
    const report = runJson(
      ["cargo", "audit", "--json", "--file", lock],
      [0, 1],
    ) as CargoAuditReport;
    findings.push(...parseCargoAudit(report, lock));
    rustWarningCount += Object.values(report.warnings ?? {}).reduce(
      (count, warnings) => count + warnings.length,
      0,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = evaluateFindings(findings, allowlist.exceptions, today);

  for (const { finding, exception } of result.accepted) {
    printFinding(`ACCEPTED until ${exception.expires}:`, finding);
  }
  for (const finding of result.reported) printFinding("REPORT:", finding);
  for (const finding of result.blocked) printFinding("BLOCKED:", finding);
  for (const exception of result.stale) {
    console.log(`STALE EXCEPTION: ${exceptionKey(exception)} (remove it if the finding is gone)`);
  }
  for (const error of result.invalidExceptions) console.error(`INVALID EXCEPTION: ${error}`);

  console.log(
    `Dependency audit: ${result.blocked.length} blocked, ${result.accepted.length} accepted, ${result.reported.length} moderate/low reported, ${rustWarningCount} RustSec informational warnings.`,
  );

  if (result.blocked.length || result.invalidExceptions.length) process.exit(1);
}

if (import.meta.main) {
  await main();
}
