import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import legacy from "../audit/fixtures/legacy-identity.json";
import { assertReleaseIdentity, type ReleaseIdentity } from "./presto-release-readiness";

const key = readFileSync(
  new URL("../packages/presto/core/tests/fixtures/updater/pubkey.b64", import.meta.url),
  "utf8",
).trim();
const identity: ReleaseIdentity = {
  domain: "example.com",
  recoveredUpdaterPublicKey: key,
  releaseReady: true,
};
const config = {
  identifier: "com.example.presto",
  bundle: { homepage: "https://example.com" },
  plugins: { updater: { pubkey: key, endpoints: ["https://example.com/releases/latest.json"] } },
};

test("key recovery cannot approve comment-only, malformed, or recommented historical keys", () => {
  for (const document of [
    "untrusted comment: minisign public key: TEST-ONLY",
    "untrusted comment: test\ninvalid",
    `untrusted comment: a completely new-looking comment\n${legacy.updaterPublicKeyPayload}`,
  ]) {
    const invalidKey = Buffer.from(document).toString("base64");
    expect(() =>
      assertReleaseIdentity(
        { ...identity, recoveredUpdaterPublicKey: invalidKey },
        { ...config, plugins: { updater: { ...config.plugins.updater, pubkey: invalidKey } } },
      ),
    ).toThrow("fresh updater key");
  }
});

test("release identity binds the domain, native identifier, endpoint and recovery key", () => {
  expect(() => assertReleaseIdentity(identity, config)).not.toThrow();
  for (const domain of [null, "preview.workers.dev", "https://example.com", "example.test"]) {
    expect(() => assertReleaseIdentity({ ...identity, domain }, config)).toThrow("PRESTO_DOMAIN");
  }
  expect(() =>
    assertReleaseIdentity(identity, { ...config, identifier: "invalid.pending-domain.presto" }),
  ).toThrow("identifier");
  expect(() =>
    assertReleaseIdentity({ ...identity, recoveredUpdaterPublicKey: null }, config),
  ).toThrow("recovery");
  expect(() => assertReleaseIdentity({ ...identity, releaseReady: false }, config)).toThrow(
    "readiness",
  );
});

test("native and npm release entry points enforce readiness before downstream jobs", async () => {
  for (const file of ["release-presto.yml", "release-sdk.yml"]) {
    const workflow = await Bun.file(
      new URL(`../.github/workflows/${file}`, import.meta.url),
    ).text();
    expect(workflow).toContain("run: bun scripts/presto-release-readiness.ts");
  }
});

test("feed promotion uses only the fresh namespace from Wrangler configuration", async () => {
  const workflow = await Bun.file(
    new URL("../.github/workflows/release-presto.yml", import.meta.url),
  ).text();
  const wrangler = await Bun.file(
    new URL("../packages/release-feed/wrangler.jsonc", import.meta.url),
  ).text();
  const namespace = /"id":\s*"([a-f0-9]{32})"/.exec(wrangler)?.[1];
  expect(namespace).toBeDefined();
  const references = [...workflow.matchAll(/--namespace-id ([a-f0-9]{32})/g)].map(
    (match) => match[1],
  );
  expect(references).toEqual([namespace, namespace]);
});
