import { describe, expect, test } from "bun:test";
import path from "node:path";
import { type Busctl, findMenu, layoutItems, menuPaths } from "./tray-menu";

/** A real `GetLayout` reply from the release app's tray, as `busctl --json=short` printed it. */
const LAYOUT = {
  type: "u(ia{sv}av)",
  data: [
    2,
    [
      0,
      { "children-display": { type: "s", data: "submenu" } },
      [
        { type: "(ia{sv}av)", data: [2, { label: { type: "s", data: "Show Logs" } }, []] },
        { type: "(ia{sv}av)", data: [3, { label: { type: "s", data: "Settings" } }, []] },
        {
          type: "(ia{sv}av)",
          data: [
            4,
            { enabled: { type: "b", data: true }, type: { type: "s", data: "separator" } },
            [],
          ],
        },
        {
          type: "(ia{sv}av)",
          data: [
            5,
            {
              enabled: { type: "b", data: false },
              label: { type: "s", data: "v1.1.4-rc.1 · Aztec 6.0.0-rc.1" },
            },
            [],
          ],
        },
        { type: "(ia{sv}av)", data: [6, { label: { type: "s", data: "Check for Updates…" } }, []] },
        { type: "(ia{sv}av)", data: [7, { label: { type: "s", data: "GitHub" } }, []] },
        { type: "(ia{sv}av)", data: [8, { label: { type: "s", data: "Quit" } }, []] },
      ],
    ],
  ],
};

const INTROSPECT = `<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
                      "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<!-- GDBus 2.80.0 -->
<node>
  <node name="tray_icon_tray_app_1736273_1"/>
</node>
`;

describe("tray-menu", () => {
  test("reads a real layout: labelled items only, enabled unless the menu says otherwise", () => {
    expect(layoutItems(LAYOUT)).toEqual([
      { id: 2, label: "Show Logs", enabled: true },
      { id: 3, label: "Settings", enabled: true },
      { id: 5, label: "v1.1.4-rc.1 · Aztec 6.0.0-rc.1", enabled: false },
      { id: 6, label: "Check for Updates…", enabled: true },
      { id: 7, label: "GitHub", enabled: true },
      { id: 8, label: "Quit", enabled: true },
    ]);
  });

  test("walks submenus and refuses a reply it does not recognise", () => {
    const nested = {
      type: "u(ia{sv}av)",
      data: [
        1,
        [
          0,
          {},
          [
            {
              type: "(ia{sv}av)",
              data: [
                9,
                { label: { type: "s", data: "Versions" } },
                [{ type: "(ia{sv}av)", data: [10, { label: { type: "s", data: "5.2.0" } }, []] }],
              ],
            },
          ],
        ],
      ],
    };
    expect(layoutItems(nested).map((i) => i.label)).toEqual(["Versions", "5.2.0"]);
    expect(() => layoutItems({ type: "s", data: "" })).toThrow("unexpected GetLayout reply");
    expect(() => layoutItems({ type: "u(ia{sv}av)", data: [1, [0, {}]] })).toThrow("malformed");
  });

  test("clicks only the one tray menu a Presto process exports", () => {
    // A connection is [owner pid, introspection]; pids 1 and 2 run Presto, 3 runs another app.
    type Conn = [number | undefined, string];
    const exe: Record<number, string> = { 1: "Presto", 2: "Presto", 3: "nm-applet" };
    const reply = (type: string, value: unknown) =>
      value === undefined ? undefined : { type, data: [value] };
    const bus =
      (conns: Record<string, Conn>): Busctl =>
      (...args) => {
        if (args[0] === "list") return Object.keys(conns).map((name) => ({ name }));
        const owner = args.includes("GetConnectionUnixProcessID");
        const conn = conns[(owner ? args.at(-1) : args[1]) ?? ""];
        return owner ? reply("u", conn?.[0]) : reply("s", conn?.[1]);
      };
    const find = (conns: Record<string, Conn>) => findMenu(bus(conns), (pid) => exe[pid]);
    const empty = "<node>\n</node>\n";
    const menuPath = "/org/ayatana/NotificationItem/tray_icon_tray_app_1736273_1/Menu";
    expect(menuPaths(INTROSPECT)).toEqual([menuPath]);

    expect(
      find({
        ":1.0": [1, INTROSPECT],
        ":1.1": [1, empty],
        ":1.5": [3, INTROSPECT],
        "org.x": [1, INTROSPECT],
      }),
    ).toEqual([":1.0", menuPath]);
    expect(() => find({ ":1.5": [3, INTROSPECT] })).toThrow("found 0");
    expect(() => find({ ":1.6": [undefined, INTROSPECT] })).toThrow("found 0");
    expect(() => find({ ":1.0": [1, INTROSPECT], ":1.7": [2, INTROSPECT] })).toThrow("found 2");
  });

  test("the Linux smoke clicks the item by the label the app gives it", async () => {
    const scripts = import.meta.dir;
    const menu = await Bun.file(path.join(scripts, "../src-tauri/src/update_menu.rs")).text();
    const idle = /Self::Idle => "([^"]+)"/.exec(menu)?.[1];
    expect(idle).toBe("Check for Updates…");
    const modes = await Bun.file(path.join(scripts, "updater-smoke-modes.sh")).text();
    expect(modes).toContain(`tray_menu click "${idle}"`);
    const linux = await Bun.file(path.join(scripts, "updater-smoke-linux.sh")).text();
    expect(linux).toMatch(/^TRAY_CLICK=1$/m);
  });
});
