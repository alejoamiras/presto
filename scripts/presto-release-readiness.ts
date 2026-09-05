import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import legacy from "../audit/fixtures/legacy-identity.json";

export interface ReleaseIdentity {
  domain: string | null;
  recoveredUpdaterPublicKey: string | null;
  releaseReady: boolean;
}

export function assertReleaseIdentity(
  identity: ReleaseIdentity,
  config: {
    identifier: string;
    bundle: { homepage: string };
    plugins: { updater: { pubkey: string; endpoints: string[] } };
  },
): void {
  const domain = identity.domain;
  if (
    !domain ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) ||
    domain.endsWith(".workers.dev") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".test")
  ) {
    throw new Error("PRESTO_DOMAIN must be finalized before merging or releasing.");
  }
  if (config.identifier !== `${domain.split(".").reverse().join(".")}.presto`) {
    throw new Error("Native identifier must be derived from the permanent apex domain.");
  }
  if (
    config.bundle.homepage !== `https://${domain}` ||
    JSON.stringify(config.plugins.updater.endpoints) !==
      JSON.stringify([`https://${domain}/releases/latest.json`])
  ) {
    throw new Error("Production homepage and updater endpoint must use the permanent domain.");
  }
  const key = config.plugins.updater.pubkey;
  const document = Buffer.from(key, "base64").toString();
  const payloadLine = document.trim().split("\n")[1] ?? "";
  const payload = Buffer.from(payloadLine, "base64");
  const retired = Buffer.from(legacy.updaterPublicKeyPayload, "base64");
  if (
    !key ||
    !document.startsWith("untrusted comment: ") ||
    payload.length !== 42 ||
    payload.toString("base64") !== payloadLine ||
    payload.subarray(0, 2).toString() !== "Ed" ||
    payload.subarray(2, 10).equals(retired.subarray(2, 10)) ||
    payload.subarray(10).equals(retired.subarray(10)) ||
    identity.recoveredUpdaterPublicKey !== key
  ) {
    throw new Error("A fresh updater key and verified 1Password recovery backup are required.");
  }
  if (!identity.releaseReady) {
    throw new Error("Release readiness is not approved: finalize routes, credentials and required gates.");
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  assertReleaseIdentity(
    read("infra/presto-identity.json"),
    read("packages/presto/src-tauri/tauri.conf.json"),
  );
}
