import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import legacy from "../audit/fixtures/legacy-identity.json";

const certutil = process.platform !== "win32" ? Bun.which("certutil") : null;
const openssl = Bun.which("openssl");
const root = resolve(import.meta.dir, "..");

test.skipIf(!certutil || !openssl)(
  "legacy NSS verification detects removal and trust changes in a disposable database",
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: The integration test owns one disposable lifecycle.
  () => {
    const directory = mkdtempSync(join(tmpdir(), "presto-legacy-trust-test-"));
    const database = join(directory, "nssdb");
    const certificate = join(directory, "legacy-ca.pem");
    const nickname = `${legacy.nssNicknamePrefix}fixture`;
    const run = (args: string[]) => Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    const mustRun = (args: string[]) => {
      const result = run(args);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    };
    const verify = () =>
      run([
        "bash",
        join(root, ".github/scripts/assert-nss-anchor.sh"),
        database,
        nickname,
        certificate,
      ]);
    mkdirSync(database);
    try {
      mustRun([
        openssl!,
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${legacy.caCommonName}`,
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,keyCertSign,cRLSign",
        "-keyout",
        join(directory, "ca-key.pem"),
        "-out",
        certificate,
      ]);
      mustRun([certutil!, "-N", "--empty-password", "-d", `sql:${database}`]);
      mustRun([
        certutil!,
        "-A",
        "-d",
        `sql:${database}`,
        "-n",
        nickname,
        "-t",
        "C,,",
        "-i",
        certificate,
      ]);
      expect(verify().exitCode).toBe(0);

      // Negative control: a present-but-distrusted certificate must not count as preserved trust.
      mustRun([certutil!, "-M", "-d", `sql:${database}`, "-n", nickname, "-t", "p,,"]);
      expect(verify().exitCode).not.toBe(0);
      mustRun([certutil!, "-M", "-d", `sql:${database}`, "-n", nickname, "-t", "C,,"]);
      expect(verify().exitCode).toBe(0);

      // A different, still-trusted CA under the same nickname must also fail preservation.
      const replacement = join(directory, "replacement.pem");
      mustRun([
        openssl!,
        "req",
        "-x509",
        "-new",
        "-key",
        join(directory, "ca-key.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=Different test anchor",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-out",
        replacement,
      ]);
      mustRun([certutil!, "-D", "-d", `sql:${database}`, "-n", nickname]);
      mustRun([
        certutil!,
        "-A",
        "-d",
        `sql:${database}`,
        "-n",
        nickname,
        "-t",
        "C,,",
        "-i",
        replacement,
      ]);
      mustRun([certutil!, "-V", "-u", "L", "-d", `sql:${database}`, "-n", nickname]);
      expect(verify().exitCode).not.toBe(0);

      // Negative control: disappearance must fail, not look like an empty successful snapshot.
      mustRun([certutil!, "-D", "-d", `sql:${database}`, "-n", nickname]);
      expect(verify().exitCode).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  // Six certutil/openssl invocations against a fresh database: a loaded CI runner exceeds the 5 s default.
  30_000,
);
