import { describe, expect, test } from "bun:test";
import { fromBase64, toBase64 } from "./base64.js";

describe("base64", () => {
  test("round-trips bytes with standard padding", () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array())).toBe("");
    expect(fromBase64("")).toEqual(new Uint8Array());
  });

  test("rejects the lenient inputs Buffer would silently accept", () => {
    for (const bad of ["AAA", "AA==AA==", "A A=", "AA=A", "-_8=", "AAA=="]) {
      expect(() => fromBase64(bad)).toThrow(SyntaxError);
    }
  });
});
