import { createHash } from "node:crypto";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import legacy from "../audit/fixtures/legacy-identity.json";

const root = resolve(import.meta.dir, "..");
const directory = await mkdtemp(join(tmpdir(), "presto-legacy-sdk-"));
function run(args: string[]) {
  const result = Bun.spawnSync(args, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}
const packed = JSON.parse(run([
  "npm", "pack", "--ignore-scripts", "--json",
  `${legacy.sdkPackage}@${legacy.sdkVersion}`,
])) as Array<{ filename: string }>;
if (packed.length !== 1 || !/^[a-z0-9.-]+\.tgz$/.test(packed[0]!.filename)) {
  throw new Error("Unexpected npm pack result");
}
const tarball = join(directory, packed[0]!.filename);
const integrity = `sha512-${createHash("sha512").update(await readFile(tarball)).digest("base64")}`;
if (integrity !== legacy.sdkIntegrity) throw new Error("Historical SDK tarball integrity mismatch");
run(["tar", "-xzf", tarball]);
const packageDir = join(directory, "package");
const manifest = await Bun.file(join(packageDir, "package.json")).json();
const current = await Bun.file(join(root, "packages/sdk/package.json")).json();
if (manifest.name !== legacy.sdkPackage || manifest.version !== legacy.sdkVersion) {
  throw new Error("Historical SDK identity mismatch");
}
if (manifest.dependencies["@aztec/stdlib"] !== current.dependencies["@aztec/stdlib"]) {
  throw new Error("Legacy interoperability fixture must use the same Aztec protocol version");
}
await symlink(join(root, "packages/sdk/node_modules"), join(packageDir, "node_modules"), "dir");
const exports = manifest.exports?.["."] ?? manifest.exports;
const entry = typeof exports === "string" ? exports : exports?.import ?? exports?.default;
if (typeof entry !== "string" || !entry.startsWith("./dist/") || entry.includes("..", 2)) {
  throw new Error("Historical SDK must expose its published dist entry");
}
console.log(resolve(packageDir, entry));
