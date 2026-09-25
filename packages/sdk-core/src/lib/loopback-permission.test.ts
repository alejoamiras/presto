import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loopbackPermission, watchLoopbackPermission } from "./loopback-permission.js";

type Listener = () => void;

/** A PermissionStatus stand-in whose state the test flips, firing `change` like the browser. */
function fakeStatus(initial: string, observable = true) {
  const listeners = new Set<Listener>();
  const status = {
    state: initial,
    ...(observable && {
      addEventListener: (_: "change", l: Listener) => listeners.add(l),
      removeEventListener: (_: "change", l: Listener) => listeners.delete(l),
    }),
  };
  const set = (state: string) => {
    status.state = state;
    for (const l of listeners) l();
  };
  return { status, set, listeners };
}

let permissionsDescriptor: PropertyDescriptor | undefined;
const setQuery = (query: ((descriptor: { name: string }) => Promise<unknown>) | undefined) =>
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: query && { query },
  });

beforeEach(() => {
  permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, "permissions");
});
afterEach(() => {
  if (permissionsDescriptor) Object.defineProperty(navigator, "permissions", permissionsDescriptor);
  else delete (navigator as { permissions?: unknown }).permissions;
});

describe("loopbackPermission", () => {
  test("reports the stored decision and maps anything unreadable to unsupported", async () => {
    for (const state of ["granted", "prompt", "denied"]) {
      setQuery(async () => ({ state }));
      expect(await loopbackPermission()).toBe(state);
    }
    setQuery(async () => ({ state: "something-new" }));
    expect(await loopbackPermission()).toBe("unsupported");
    setQuery(undefined);
    expect(await loopbackPermission()).toBe("unsupported");
    setQuery(async () => {
      throw new TypeError("unknown permission");
    });
    expect(await loopbackPermission()).toBe("unsupported");
  });

  test("falls back to the umbrella name only when loopback-network is rejected", async () => {
    const asked: string[] = [];
    setQuery(async ({ name }) => {
      asked.push(name);
      if (name === "loopback-network") throw new TypeError("unknown permission");
      return { state: "denied" };
    });
    expect(await loopbackPermission()).toBe("denied");
    expect(asked).toEqual(["loopback-network", "local-network-access"]);
  });
});

describe("watchLoopbackPermission", () => {
  test("forwards real changes once each, and stops after unsubscribe", async () => {
    const fake = fakeStatus("prompt");
    setQuery(async () => fake.status);
    const seen: string[] = [];
    const stop = await watchLoopbackPermission((state) => seen.push(state));
    fake.set("prompt");
    fake.set("granted");
    fake.set("granted");
    fake.set("something-new");
    fake.set("prompt");
    stop();
    fake.set("denied");
    expect(seen).toEqual(["granted", "prompt"]);
    expect(fake.listeners.size).toBe(0);
  });

  test("is a no-op where changes cannot be observed", async () => {
    setQuery(async () => fakeStatus("prompt", false).status);
    const stop = await watchLoopbackPermission(() => {
      throw new Error("must not fire");
    });
    expect(() => stop()).not.toThrow();
    setQuery(undefined);
    expect(typeof (await watchLoopbackPermission(() => {}))).toBe("function");
  });
});
