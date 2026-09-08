/**
 * The proving schemes a Presto advertises in `/health.schemes`. A client checks for the scheme its
 * route needs before proving natively; an app that predates the list serves `chonk` only.
 */
export const PRESTO_SCHEME_CHONK = "chonk";
export const PRESTO_SCHEME_ULTRA_HONK = "ultra_honk";

export type PrestoScheme = typeof PRESTO_SCHEME_CHONK | typeof PRESTO_SCHEME_ULTRA_HONK;
