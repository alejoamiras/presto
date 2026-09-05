/** Validate the single immutable package returned by npm pack --json. */
export function parseNpmPackResult(
  value: unknown,
  expectedName: string,
  expectedVersion: string,
): { filename: string; integrity: string } {
  let entries: unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else if (value && typeof value === "object" && Object.keys(value).length === 1 && Object.hasOwn(value, expectedName)) {
    // npm 12 reports a record keyed by package name; npm 11 reports an array.
    entries = Object.values(value);
  } else {
    throw new Error("Unexpected npm pack result: expected one package");
  }
  if (entries.length !== 1) throw new Error("Unexpected npm pack result: expected one package");
  const entry = entries[0];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("Unexpected npm pack entry");
  }
  const { name, version, filename, integrity } = entry as Record<string, unknown>;
  if (name !== expectedName || version !== expectedVersion) {
    throw new Error("npm pack identity does not match the requested package");
  }
  if (typeof filename !== "string" || !/^[a-z0-9][a-z0-9.-]*\.tgz$/.test(filename)) {
    throw new Error("Unexpected npm pack tarball filename");
  }
  if (typeof integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
    throw new Error("npm pack must report SHA-512 integrity");
  }
  return { filename, integrity };
}
