import { describe, expect, test } from "bun:test";
import { run } from "./npm-command.ts";

describe("bounded commands", () => {
  // A registry or proxy that accepts the connection and never answers holds npm with no deadline.
  test("a command that never answers fails, naming itself, once its time is up", () => {
    const started = performance.now();
    expect(() => run(["sleep", "30"], import.meta.dir, 200)).toThrow(
      "sleep 30 gave no answer within 0.2 s",
    );
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
