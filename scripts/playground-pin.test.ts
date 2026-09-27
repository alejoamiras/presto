import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  type PlaygroundPin,
  parsePlaygroundPin,
  raisePin,
  readPlaygroundPin,
} from "./playground-pin";

const SDK = "@alejoamiras/presto";
const NOIR = "@alejoamiras/presto-noir";
const pin = (sdk: string, noir: string): PlaygroundPin => ({ [SDK]: sdk, [NOIR]: noir });

describe("parsePlaygroundPin", () => {
  test("the committed pin parses", async () => {
    expect(await readPlaygroundPin(resolve(import.meta.dir, ".."))).toBeDefined();
  });

  test("rejects a malformed, padded or extra-keyed pin", () => {
    expect(() => parsePlaygroundPin({ [SDK]: "5.2.0" })).toThrow("exactly");
    expect(() => parsePlaygroundPin({ ...pin("5.2.0", "1.2.0"), extra: "1.0.0" })).toThrow(
      "exactly",
    );
    expect(() => parsePlaygroundPin(pin(" 5.2.0", "1.2.0"))).toThrow("Invalid @alejoamiras/presto");
    expect(() => parsePlaygroundPin(pin("5.2.0", "^1.2.0"))).toThrow(
      "Invalid @alejoamiras/presto-noir",
    );
    // Each package keeps its own version shape: a revision suffix is presto's alone.
    expect(() => parsePlaygroundPin(pin("5.2.0", "1.2.0-revision.1"))).toThrow("presto-noir");
    expect(() => parsePlaygroundPin(["5.2.0"])).toThrow("object");
  });
});

describe("raisePin", () => {
  test("presto moves forward in publish order, never back", () => {
    expect(raisePin(pin("5.3.0", "1.2.0"), { [SDK]: "5.3.0-revision.1" })[SDK]).toBe(
      "5.3.0-revision.1",
    );
    expect(raisePin(pin("5.2.0-revision.9", "1.2.0"), { [SDK]: "5.3.0" })[SDK]).toBe("5.3.0");
    expect(raisePin(pin("5.3.0-revision.1", "1.2.0"), { [SDK]: "5.3.0" })[SDK]).toBe(
      "5.3.0-revision.1",
    );
    expect(raisePin(pin("5.3.0", "1.2.0"), { [SDK]: "5.2.0-revision.9" })[SDK]).toBe("5.3.0");
  });

  test("noir moves by semver; an empty update or an equal version changes nothing", () => {
    expect(raisePin(pin("5.2.0", "1.2.0"), { [NOIR]: "1.10.0" })[NOIR]).toBe("1.10.0");
    expect(raisePin(pin("5.2.0", "1.2.0"), { [NOIR]: "1.1.0" })[NOIR]).toBe("1.2.0");
    const current = pin("5.2.0-revision.5", "1.2.0");
    expect(raisePin(current, { [SDK]: "", [NOIR]: "1.2.0" })).toEqual(current);
  });

  test("an invalid update fails before anything moves", () => {
    expect(() => raisePin(pin("5.2.0", "1.2.0"), { [SDK]: "5.3.0; rm -rf /" })).toThrow("Invalid");
  });
});
