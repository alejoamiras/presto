/**
 * Static guards on the desktop update wiring that no Rust test can reach: the Wry-typed command,
 * the `Builder` chain, and which thread may create the prompt window. They read source only.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

const SRC = path.resolve(import.meta.dir, "..", "src-tauri", "src");

async function source(file: string): Promise<string> {
  return stripComments(await Bun.file(path.join(SRC, file)).text());
}

function stripComments(rust: string): string {
  return rust.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The text of `fn name` from its signature to its closing brace at the same indentation. */
function fnBody(rust: string, name: string): string {
  const start = rust.search(new RegExp(`^(\\s*)(pub(\\([a-z]+\\))? )?(async )?fn ${name}\\b`, "m"));
  expect(start, `fn ${name} not found`).toBeGreaterThanOrEqual(0);
  const indent = /^\s*/.exec(rust.slice(start))?.[0].replace(/\n/g, "") ?? "";
  const end = rust.indexOf(`\n${indent}}`, start);
  expect(end, `end of fn ${name} not found`).toBeGreaterThan(start);
  return rust.slice(start, end);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("update wiring", () => {
  // H7: an unmanaged `State` parameter fails the whole command, so the prompt's command reads the
  // schedule store and install gate through `try_state`, and both are managed in the `Builder`
  // chain beside the pending slot rather than in `setup`.
  test("H7: the update state is managed in the Builder chain, never as command State", async () => {
    const main = await source("main.rs");
    const chainStart = main.indexOf(".manage::<PendingUpdate>(");
    const chainEnd = main.indexOf(".invoke_handler(", chainStart);
    expect(chainStart).toBeGreaterThan(0);
    const chain = main.slice(chainStart, chainEnd);
    for (const managed of [
      ".manage::<Arc<ScheduleStore>>(",
      ".manage::<Arc<InstallGate>>(",
      ".manage::<ManualCheckSender>(",
    ]) {
      expect(chain, managed).toContain(managed);
      expect(count(main, managed), `${managed} is managed exactly once`).toBe(1);
    }

    const commands = await source("commands.rs");
    const command = fnBody(commands, "respond_update_prompt");
    const signature = command.slice(0, command.indexOf("-> Result<(), String>"));
    const params = [...signature.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(params).toEqual([
      "window",
      "app",
      "config",
      "pending",
      "action",
      "auto_update",
      "displayed_version",
    ]);
    expect(count(signature, "State<")).toBe(2);
    expect(command).toContain("try_state::<Arc<ScheduleStore>>()");
    expect(command).toContain("try_state::<Arc<InstallGate>>()");
  });

  // G7: creating a window on the main thread deadlocks on Windows. Lexical only: the guard must be
  // the presenter's first check, and the presenter has one caller, the update task's `present`.
  test("G7: the prompt presenter refuses the main thread and has a single caller", async () => {
    const windows = await source("windows.rs");
    const presenter = fnBody(windows, "show_update_prompt_window");
    const guard = presenter.indexOf("may_create_windows_here()");
    expect(guard).toBeGreaterThan(0);
    for (const windowCall of ["get_webview_window", "open_or_focus_window", ".navigate("]) {
      expect(presenter.indexOf(windowCall), windowCall).toBeGreaterThan(guard);
    }

    const main = await source("main.rs");
    expect(count(main, "show_update_prompt_window(")).toBe(1);
    expect(fnBody(main, "present")).toContain("show_update_prompt_window(");
    expect(main).not.toMatch(/run_on_main_thread[\s\S]{0,400}show_update_prompt_window/);
  });

  // Every install holds the install gate: `perform_update` is private and reached only through
  // `spawn_install`, which takes a claim.
  test("installs are reachable only through spawn_install", async () => {
    const updater = await source("updater.rs");
    expect(updater).toMatch(/^async fn perform_update\(/m);
    expect(count(updater, "perform_update(")).toBe(2);
    expect(fnBody(updater, "spawn_install")).toContain("perform_update(");
    const commands = await source("commands.rs");
    expect(commands).not.toContain("perform_update(");
  });

  // D1's Rust test proves `with_feed_timeout` fires; this pins that the plugin's fetch is the future
  // it wraps, so awaiting `check()` first cannot slip past it.
  test("D1: the only feed fetch runs inside the feed timeout", async () => {
    const updater = await source("updater.rs");
    expect(count(updater, ".check()")).toBe(1);
    expect(fnBody(updater, "fetch_feed")).toContain("with_feed_timeout(updater.check()).await");
  });

  // The menu callback runs with no Tokio context, where a Tokio spawn panics and `panic = "abort"`
  // ends the app. A lexical tripwire only: the WebDriver tray spec's real click is the safety net.
  test("I12: the tray click path never reaches for Tokio's runtime", async () => {
    const menu = await source("update_menu.rs");
    const handler = fnBody(await source("main.rs"), "on_tray_menu");
    for (const [name, code] of [
      ["update_menu.rs", menu],
      ["on_tray_menu", handler],
    ]) {
      for (const call of ["tokio::spawn(", "tokio::task::spawn(", "Handle::current()"]) {
        expect(code, `${call} in ${name}`).not.toContain(call);
      }
    }
    expect(menu).toContain("tauri::async_runtime::spawn(");
  });
});
