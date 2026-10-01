/**
 * Drives the desktop app's tray menu the way a desktop's tray host does: through the menu
 * libappindicator exports on the session bus (`com.canonical.dbusmenu`). A release binary is
 * clicked with no test hooks, and the click takes the same GTK → menu-event path as a real one.
 * Linux only; needs `busctl` and the app's `DBUS_SESSION_BUS_ADDRESS`. Exactly one exported menu
 * must exist, so a stray second app can never be the one clicked.
 *
 * Usage:
 *   bun tray-menu.ts list
 *   bun tray-menu.ts click <label>
 *   bun tray-menu.ts wait <label> <seconds>
 *   bun tray-menu.ts dump
 */

const ITEM_ROOT = "/org/ayatana/NotificationItem";

export interface MenuItem {
  id: number;
  label: string;
  enabled: boolean;
}

interface Variant {
  type: string;
  data: unknown;
}

/** The menu object paths an `Introspect` of {@link ITEM_ROOT} lists, one per indicator. */
export function menuPaths(introspectXml: string): string[] {
  return [...introspectXml.matchAll(/<node name="([^"]+)"\s*\/>/g)].map(
    (m) => `${ITEM_ROOT}/${m[1]}/Menu`,
  );
}

/** Every labelled item of a `GetLayout` reply, as busctl's JSON prints it. */
export function layoutItems(reply: Variant): MenuItem[] {
  if (reply.type !== "u(ia{sv}av)" || !Array.isArray(reply.data) || reply.data.length !== 2) {
    throw new Error(`unexpected GetLayout reply type ${reply.type}`);
  }
  const items: MenuItem[] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || node.length !== 3) throw new Error("malformed layout node");
    const [id, props, children] = node as [number, Record<string, Variant>, Variant[]];
    const label = props.label;
    if (label?.type === "s" && typeof label.data === "string") {
      const enabled = props.enabled;
      items.push({
        id,
        label: label.data,
        enabled: enabled?.type === "b" ? enabled.data === true : true,
      });
    }
    for (const child of children) walk(child.data);
  };
  walk(reply.data[1]);
  return items;
}

/** busctl's JSON output, `""` for a call with no reply body, or `undefined` if it failed. */
export type Busctl = (...args: string[]) => unknown;

const busctl: Busctl = (...args) => {
  // `--`: a negative argument such as GetLayout's depth -1 is otherwise read as an option.
  const r = Bun.spawnSync(["busctl", "--user", "--json=short", "--", ...args]);
  if (r.exitCode !== 0) return undefined;
  const out = r.stdout.toString().trim();
  return out ? JSON.parse(out) : "";
};

/** The one exported tray menu on the bus, as `[bus name, object path]`. */
export function findMenu(call: Busctl = busctl): [string, string] {
  const names = call("list") as { name: string }[] | undefined;
  if (!Array.isArray(names))
    throw new Error("busctl list failed: is DBUS_SESSION_BUS_ADDRESS set?");
  const found: [string, string][] = [];
  for (const { name } of names) {
    if (!name.startsWith(":")) continue;
    const xml = call("call", name, ITEM_ROOT, "org.freedesktop.DBus.Introspectable", "Introspect");
    const data = (xml as Variant | undefined)?.data;
    const text = Array.isArray(data) ? data[0] : undefined;
    if (typeof text === "string") for (const path of menuPaths(text)) found.push([name, path]);
  }
  if (found.length !== 1) {
    throw new Error(`expected exactly one tray menu on the bus, found ${found.length}`);
  }
  return found[0] as [string, string];
}

function layout([name, path]: [string, string]): Variant {
  const reply = busctl(
    "call",
    name,
    path,
    "com.canonical.dbusmenu",
    "GetLayout",
    "iias",
    "0",
    "-1",
    "0",
  );
  if (!reply) throw new Error(`GetLayout failed on ${name} ${path}`);
  return reply as Variant;
}

/** Clicks the one enabled item labelled `label`. */
export function click(menu: [string, string], label: string): void {
  const matches = layoutItems(layout(menu)).filter((i) => i.label === label);
  if (matches.length !== 1 || !matches[0]?.enabled) {
    throw new Error(`expected one enabled "${label}", found ${JSON.stringify(matches)}`);
  }
  const [name, path] = menu;
  const time = String(Math.floor(Date.now() / 1000));
  const sent = busctl(
    "call",
    name,
    path,
    "com.canonical.dbusmenu",
    "Event",
    "isvu",
    String(matches[0].id),
    "clicked",
    "i",
    "0",
    time,
  );
  if (sent === undefined) throw new Error(`Event failed on ${name} ${path}`);
}

async function main(argv: string[]): Promise<number> {
  const [command, label, seconds] = argv;
  const menu = findMenu();
  switch (command) {
    case "list":
      for (const i of layoutItems(layout(menu))) console.log(`${i.id}\t${i.enabled}\t${i.label}`);
      return 0;
    case "dump":
      console.log(JSON.stringify(layout(menu)));
      return 0;
    case "click":
      if (!label) break;
      click(menu, label);
      console.log(`clicked "${label}"`);
      return 0;
    case "wait": {
      if (!label || !seconds) break;
      const deadline = Date.now() + Number(seconds) * 1000;
      while (Date.now() < deadline) {
        if (layoutItems(layout(menu)).some((i) => i.label === label)) return 0;
        await Bun.sleep(200);
      }
      console.error(`no "${label}" in the tray menu within ${seconds}s`);
      return 1;
    }
  }
  console.error("usage: tray-menu.ts list | dump | click <label> | wait <label> <seconds>");
  return 2;
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
