/**
 * The bb.js releases this adapter is tested against: the wire contract, the byte identity of native
 * and WASM proofs, and the CLI flags are all verified per version, and an Aztec release ships its
 * `@aztec/bb.js` under the same version string.
 */
export const TESTED_BB_VERSIONS: readonly string[] = ["5.2.0"];
export const TESTED_BB_VERSION = TESTED_BB_VERSIONS[0] as string;

/**
 * The bb version the presto is asked to prove with. A version outside the tested list means native
 * proofs from one bb release and WASM proofs (and WASM-recomputed keys) from another, so it is
 * refused unless the caller opts into that pairing explicitly.
 */
export function resolveBbVersion(option: string | undefined, allowUntested = false): string {
  const version = option ?? TESTED_BB_VERSION;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) {
    throw new Error(`Invalid bbVersion ${JSON.stringify(version)}: expected a semver version.`);
  }
  if (!allowUntested && !TESTED_BB_VERSIONS.includes(version)) {
    throw new Error(
      `bbVersion ${version} is not a tested pairing (${TESTED_BB_VERSIONS.join(", ")}); ` +
        "pass allowUntestedBbVersion: true to prove natively with it anyway.",
    );
  }
  return version;
}
