/**
 * After a bootstrap-mode install, prove the candidate resolves a `--with` dependency to the supplied
 * tarball and nothing else: npm keeps a root `file:` copy AND fetches a registry copy beneath the
 * candidate when the pin and the tarball disagree, and the runtime checks would then pass against
 * the wrong artifact. The hidden lockfile (`node_modules/.package-lock.json`) records every
 * installed copy with the SHA-512 of the archive it came from, so the check is on content: exactly
 * one installation, whose integrity is the supplied tarball's.
 *
 *   bun scripts/tarball-consumer/assert-local-dependency.ts <host-dir> <name> <tarball>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface HiddenLockfile {
  packages?: Record<string, { version?: string; integrity?: string }>;
}

/** Standard subresource-integrity string for a tarball's bytes. */
export function tarballIntegrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

export function assertLocalDependency(
  lock: HiddenLockfile,
  name: string,
  integrity: string,
): string {
  const installed = Object.entries(lock.packages ?? {}).filter(([path]) =>
    path.endsWith(`node_modules/${name}`),
  );
  if (installed.length !== 1) {
    throw new Error(
      `${name} is installed ${installed.length} times; the candidate must resolve the supplied tarball alone`,
    );
  }
  const [path, entry] = installed[0] as [string, { version?: string; integrity?: string }];
  if (entry.integrity !== integrity) {
    throw new Error(
      `${path} was installed from an archive with integrity ${entry.integrity ?? "(none)"}, not the supplied tarball's ${integrity}`,
    );
  }
  return entry.version ?? "";
}

if (import.meta.main) {
  const [hostDir, name, tarball] = process.argv.slice(2);
  if (!hostDir || !name || !tarball) {
    console.error("usage: assert-local-dependency.ts <host-dir> <name> <tarball>");
    process.exit(2);
  }
  try {
    const lock = JSON.parse(readFileSync(join(hostDir, "node_modules/.package-lock.json"), "utf8"));
    const version = assertLocalDependency(lock, name, tarballIntegrity(readFileSync(tarball)));
    console.log(`${name}@${version} resolved from the supplied tarball`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
