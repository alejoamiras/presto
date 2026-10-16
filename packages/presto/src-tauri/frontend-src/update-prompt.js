import { invoke, wireButton } from "./bridge.js";

const params = new URLSearchParams(window.location.search);
const currentVersion = params.get("current") || "unknown";
const newVersion = params.get("version") || "unknown";
document.getElementById("version").textContent = `v${currentVersion}  →  v${newVersion}`;
// Only a client on the candidate channel is offered a prerelease.
if (newVersion.split("+")[0].includes("-")) {
  document.getElementById("title").textContent = "A release candidate is ready";
  document.getElementById("note").textContent =
    "A test build of the next version. It can have bugs.";
}

wireButton("update", {
  disableAlso: "later",
  loadingText: "Updating…",
  onClick: () => {
    const autoUpdate = document.getElementById("auto-update").checked;
    // B2 (F8): echo the version this prompt is DISPLAYING so the backend installs only that exact
    // version — a background re-check that swapped the pending update is refused, not silently installed.
    return invoke("respond_update_prompt", {
      action: "update",
      autoUpdate,
      displayedVersion: newVersion,
    });
  },
});

wireButton("later", {
  disableAlso: "update",
  onClick: () =>
    invoke("respond_update_prompt", {
      action: "later",
      autoUpdate: false,
      displayedVersion: newVersion,
    }),
});
