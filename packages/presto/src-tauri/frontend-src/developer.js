import { invoke, showErrorHint } from "./bridge.js";

// Developer mode and the update channel. Either save can make the candidate channel effective, which
// runs one update check, so both report through `save` and its result line.

const switchEl = document.getElementById("developer");
const advanced = document.getElementById("advanced");
const section = document.getElementById("developer-section");
const channelGroup = document.getElementById("channel");
const statusEl = document.getElementById("channel-status");
const resultEl = document.getElementById("channel-result");
const offCheck = document.getElementById("developer-off-check");
const leaveCheck = document.getElementById("leave-check");

/** The join check's result, as the tray words it; a prompt that opened needs no line. */
const RESULT_TEXT = {
  "up-to-date": "Up to date",
  failed: "Couldn't check — try again",
  installing: "Installing an update…",
  presented: "",
};

// What the last load or save established. `stored` is the saved choice, which outlives developer
// mode only in a hand-edited config; `effective` is the channel updates come from.
let state = { enabled: false, stored: "stable", effective: "stable", version: "" };

// A load that overlaps a save may hold the pre-save value (reloads overlap: two quick Removes), so it
// leaves these controls to the save and to newer loads. `revision` moves as each save starts and ends.
let revision = 0;
let saving = 0;
// Numbers each change: only the newest may write the result line, so a superseded join's is dropped.
let change = 0;

function isPrerelease(version) {
  return version.split("+")[0].includes("-");
}

function statusText({ effective, version }) {
  const running = version ? ` You run ${version}.` : "";
  if (effective === "rc") {
    return isPrerelease(version)
      ? running.trim()
      : `The newer of the next release candidate and the next stable release.${running}`;
  }
  return isPrerelease(version)
    ? `Stable releases only. You stay on ${version} until a newer stable release is out.`
    : "Stable releases only.";
}

function render() {
  switchEl.checked = state.enabled;
  section.hidden = !state.enabled;
  for (const input of channelGroup.querySelectorAll("input")) {
    input.checked = input.value === state.effective;
  }
  statusEl.textContent = statusText(state);
  for (const stays of document.querySelectorAll(".confirm .stays")) {
    stays.textContent = `Presto stays on ${state.version} until a newer stable release exists. It does not go back to an older version.`;
  }
}

function hideChecks() {
  offCheck.hidden = true;
  leaveCheck.hidden = true;
}

/** Starts a load: returns the token `hydrateDeveloper` needs. */
export function beginDeveloperLoad() {
  if (saving === 0) {
    switchEl.disabled = true;
    channelGroup.disabled = true;
  }
  return revision;
}

/** Paints what a load read, unless a save overlapped it. */
export function hydrateDeveloper(token, config, sysInfo) {
  if (saving > 0 || token !== revision) return;
  state = {
    enabled: config.developer?.enabled === true,
    stored: config.developer?.update_channel === "rc" ? "rc" : "stable",
    // A read-only config keeps the client on stable whatever it stores.
    effective: sysInfo.effective_channel === "rc" ? "rc" : "stable",
    version: sysInfo.app_version ?? "",
  };
  render();
  // Unfolded while on, so the switch that explains the Developer section sits right above it.
  if (state.enabled) advanced.open = true;
  switchEl.disabled = false;
  channelGroup.disabled = false;
}

/**
 * Saves one change, shown at once. An error means nothing was saved, so the view goes back; a check
 * that ran and failed still saved, and only its result line says so.
 */
async function save(command, args, next, anchor) {
  const mine = ++change;
  const before = state;
  state = next;
  render();
  hideChecks();
  const joins = next.effective === "rc" && before.effective !== "rc";
  resultEl.textContent = joins ? "Checking…" : "";
  revision++;
  saving++;
  try {
    const result = await invoke(command, args);
    if (mine === change) resultEl.textContent = RESULT_TEXT[result] ?? "";
  } catch (err) {
    console.error(`Failed to invoke ${command}:`, err);
    if (mine === change) {
      state = before;
      render();
      resultEl.textContent = "";
      showErrorHint(anchor, typeof err === "string" ? err : "Failed to save");
    }
  } finally {
    saving--;
    revision++;
  }
}

// Leaving the candidate channel keeps an installed release candidate until a newer stable exists,
// so it asks first.
function leavesCandidate() {
  return state.effective === "rc" && isPrerelease(state.version);
}

function setDeveloperMode(enabled) {
  const next = enabled
    ? { ...state, enabled: true, effective: state.stored }
    : { ...state, enabled: false, stored: "stable", effective: "stable" };
  save("set_developer_mode", { enabled }, next, switchEl);
}

function setChannel(channel) {
  save(
    "set_update_channel",
    { channel },
    { ...state, stored: channel, effective: channel },
    channelGroup,
  );
}

switchEl.addEventListener("change", () => {
  if (!switchEl.checked && leavesCandidate()) {
    switchEl.checked = true;
    offCheck.hidden = false;
    return;
  }
  setDeveloperMode(switchEl.checked);
});

channelGroup.addEventListener("change", (e) => {
  const channel = e.target.value;
  if (channel === "stable" && leavesCandidate()) {
    render();
    leaveCheck.hidden = false;
    return;
  }
  setChannel(channel);
});

document.getElementById("developer-off-cancel").addEventListener("click", hideChecks);
document
  .getElementById("developer-off-confirm")
  .addEventListener("click", () => setDeveloperMode(false));
document.getElementById("leave-cancel").addEventListener("click", hideChecks);
document.getElementById("leave-confirm").addEventListener("click", () => setChannel("stable"));
