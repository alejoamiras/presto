import { invoke, showErrorHint } from "./bridge.js";

// The custom bb: a banner at the top of Settings while one is set, and a card under Developer that
// reviews, tests, saves and stops it. Rust re-checks every step; these controls only reflect what it
// last said.

const $ = (id) => document.getElementById(id);

const banner = $("custom-bb-banner");
const bannerTitle = $("custom-bb-banner-title");
const bannerBody = $("custom-bb-banner-body");
const bannerReview = $("custom-bb-banner-review");
const bannerStop = $("custom-bb-banner-stop");
const card = $("custom-bb");
const chip = $("custom-bb-chip");
const summary = $("custom-bb-summary");
const facts = $("custom-bb-facts");
const fixBox = $("custom-bb-fix");
const fixCommand = $("custom-bb-fix-command");
const trust = $("custom-bb-trust");
const choose = $("custom-bb-choose");
const stop = $("custom-bb-stop");
const stoppedLine = $("custom-bb-stopped");
const reviewPanel = $("custom-bb-review");
const reviewFacts = $("custom-bb-review-facts");
const warnings = $("custom-bb-warnings");
const tick = $("custom-bb-tick");
const labelInput = $("custom-bb-label");
const testButton = $("custom-bb-test");
const testResult = $("custom-bb-test-result");
const useButton = $("custom-bb-use");
const cancelButton = $("custom-bb-cancel");
const refusedPanel = $("custom-bb-refused");
const refusedMessage = $("custom-bb-refused-message");
const refusedFix = $("custom-bb-refused-fix");
const refusedCommand = $("custom-bb-refused-command");
const chooseAgain = $("custom-bb-choose-again");

/** Per state: the chip, the card's line, and the banner's title and body (none while off). */
const STATES = {
  off: {
    chip: "",
    line: () => "Off. Every proof uses the official bb that Presto downloads and checks.",
  },
  in_use: {
    chip: "In use",
    line: (s) =>
      `Sites that ask for ${s.label} get this build. Every other request uses the official bb.`,
    banner: (s) => [
      "Custom bb is on",
      `Sites that ask for ${s.label} get your build (${short(s.sha256)}). Every other request uses the official bb.`,
    ],
  },
  changed: {
    chip: "Not used: file changed",
    line: (s) =>
      `This file changed after you chose it. Presto refuses proofs for ${s.label} until you trust the new build or stop using it.`,
    banner: (s) => [
      "Your custom bb changed",
      `Presto refuses proofs for ${s.label} until you review the new file or stop using it. Sites use their own prover meanwhile.`,
    ],
  },
  missing: {
    chip: "Not used: file missing",
    line: (s) =>
      `Presto can't read the file. It refuses proofs for ${s.label} until you choose it again or stop using it.`,
    banner: (s) => [
      "Your custom bb is missing",
      `Presto refuses proofs for ${s.label} until you choose the file again or stop using it.`,
    ],
  },
  unsafe: {
    chip: "Not used: others can change it",
    line: (s) => s.refusal?.message ?? "Another account could change this file.",
    banner: (s) => [
      "Your custom bb is not in use",
      `Another account could now change it, so Presto refuses proofs for ${s.label}.`,
    ],
  },
  overridden: {
    chip: "Not used: overridden",
    line: () => "BB_BINARY_PATH overrides every bb choice.",
    banner: () => [
      "Custom bb is not in use",
      "Presto was started with BB_BINARY_PATH, which overrides every bb choice. Quit Presto and start it without that variable to use your custom bb.",
    ],
  },
  revoked: {
    chip: "Not used: version refused",
    line: (s) =>
      `This version of Presto refuses ${s.label} as a known-vulnerable version, so no site can ask for it.`,
    banner: (s) => [
      "Your custom bb is not in use",
      `This version of Presto refuses ${s.label}, so no site can ask for it. Choose another version.`,
    ],
  },
};

// `null` until the first status read succeeds: every control stays disabled until then.
let status = null;
// What custom_bb_review last returned, while its review is open, and whether its test run passed.
let candidate = null;
let tested = false;
let busy = false;
let loads = 0;
let stoppedTimer = null;

function short(sha256) {
  return sha256 ? sha256.slice(0, 8) : "";
}

function ago(seconds) {
  const delta = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} h ago`;
  return new Date(seconds * 1000).toLocaleString();
}

function size(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Fills a <dl> with term and definition pairs, skipping null definitions. */
function fill(list, rows) {
  list.replaceChildren();
  for (const [term, value] of rows) {
    if (value == null) continue;
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  }
}

function factRows(s) {
  const failure = s.activity?.last_failure;
  const changed = s.state === "changed";
  return [
    ["Version", s.label],
    ["File", s.path],
    [changed ? "Pinned" : "SHA-256", s.sha256],
    ["Now", changed ? (s.current_sha256 ?? "unreadable") : null],
    ["Last proof", s.activity?.last_proof_at ? ago(s.activity.last_proof_at) : null],
    ["Last failure", failure ? `${ago(failure.at)}: ${failure.detail}` : null],
  ];
}

function renderStatus(s) {
  const view = STATES[s.state] ?? STATES.off;
  const set = s.state !== "off";
  const refused = set && s.state !== "in_use";

  const bannerText = view.banner?.(s);
  banner.hidden = !bannerText;
  banner.classList.toggle("refused", refused);
  if (bannerText) [bannerTitle.textContent, bannerBody.textContent] = bannerText;
  bannerReview.hidden = s.state !== "changed";

  card.classList.toggle("refused", refused);
  chip.hidden = !set;
  chip.textContent = view.chip;
  chip.classList.toggle("refused", refused);
  summary.textContent = view.line(s);
  facts.hidden = !set;
  fill(facts, set ? factRows(s) : []);
  fixBox.hidden = !s.refusal?.fix;
  fixCommand.textContent = s.refusal?.fix ?? "";

  choose.textContent = set ? "Change file…" : "Choose file…";
  trust.hidden = s.state !== "changed";
  stop.hidden = !set;
}

function render() {
  renderStatus(status ?? { state: "off" });
  const locked = busy || status === null;
  for (const button of [choose, trust, stop, bannerStop, bannerReview, chooseAgain]) {
    button.disabled = locked;
  }

  reviewPanel.hidden = candidate === null;
  if (candidate) {
    tick.disabled = busy;
    labelInput.disabled = busy;
    cancelButton.disabled = busy;
    testButton.disabled = busy || !tick.checked;
    useButton.disabled = busy || !tested || !tick.checked || labelInput.value.trim() === "";
  }
}

/** Reads the state back from Rust. Only the newest read paints. */
export async function loadCustomBb() {
  const mine = ++loads;
  let next = null;
  try {
    next = await invoke("custom_bb_status");
  } catch (err) {
    console.error("Failed to read the custom bb:", err);
  }
  if (mine !== loads) return;
  status = next;
  render();
}

/** Developer mode went off: Rust dropped the candidate, so the open panels go too. */
export function closeCustomBbPanels() {
  closeReview();
  refusedPanel.hidden = true;
  render();
}

function closeReview() {
  candidate = null;
  tested = false;
  tick.checked = false;
  labelInput.value = "";
  setTestResult("", "");
}

function setTestResult(text, tone) {
  testResult.textContent = text;
  testResult.classList.toggle("passed", tone === "passed");
  testResult.classList.toggle("failed", tone === "failed");
}

function showReview(review) {
  refusedPanel.hidden = true;
  closeReview();
  if (review.outcome === "inspected") {
    candidate = review;
    fill(reviewFacts, [
      ["File", review.path],
      ["SHA-256", review.sha256],
      ["Size", size(review.size)],
    ]);
    warnings.replaceChildren(
      ...review.warnings.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }),
    );
    warnings.hidden = review.warnings.length === 0;
    // A new build of the file already in use keeps its label unless the user changes it.
    labelInput.value = status && status.state !== "off" ? (status.label ?? "") : "";
    render();
    reviewPanel.scrollIntoView({ block: "nearest" });
  } else if (review.outcome === "refused") {
    refusedMessage.textContent = review.message;
    refusedFix.hidden = !review.fix;
    refusedCommand.textContent = review.fix ?? "";
    refusedPanel.hidden = false;
    render();
    refusedPanel.scrollIntoView({ block: "nearest" });
  }
}

/** Runs one action with every control disabled; an error shows next to `anchor`. */
async function act(anchor, work) {
  if (busy) return;
  busy = true;
  render();
  try {
    await work();
  } catch (err) {
    console.error("Custom bb action failed:", err);
    showErrorHint(anchor, typeof err === "string" ? err : "Failed. Try again");
  } finally {
    busy = false;
    render();
  }
}

function reviewFrom(source, anchor) {
  act(anchor, async () => {
    const review = await invoke("custom_bb_review", { source });
    if (review.outcome !== "cancelled") showReview(review);
  });
}

function stopUsing(anchor) {
  act(anchor, async () => {
    await invoke("custom_bb_save", { choice: null });
    closeReview();
    refusedPanel.hidden = true;
    stoppedLine.hidden = false;
    clearTimeout(stoppedTimer);
    stoppedTimer = setTimeout(() => {
      stoppedLine.hidden = true;
    }, 5000);
    await loadCustomBb();
  });
}

choose.addEventListener("click", () => reviewFrom("pick", choose));
chooseAgain.addEventListener("click", () => reviewFrom("pick", chooseAgain));
trust.addEventListener("click", () => reviewFrom("pinned", trust));
bannerReview.addEventListener("click", () => reviewFrom("pinned", bannerReview));
stop.addEventListener("click", () => stopUsing(stop));
bannerStop.addEventListener("click", () => stopUsing(bannerStop));

tick.addEventListener("change", render);
labelInput.addEventListener("input", render);

testButton.addEventListener("click", () =>
  act(testButton, async () => {
    tested = false;
    setTestResult("Running…", "");
    try {
      const run = await invoke("custom_bb_test_run", {
        sha256: candidate.sha256,
        acknowledged: tick.checked,
      });
      tested = true;
      const printed = run.excerpt.split("\n")[0].trim();
      setTestResult(
        printed ? `✓ Test run passed. bb printed ${printed}.` : "✓ Test run passed.",
        "passed",
      );
      if (run.version_suggestion && labelInput.value.trim() === "") {
        labelInput.value = run.version_suggestion;
      }
    } catch (err) {
      setTestResult(typeof err === "string" ? err : "The test run failed.", "failed");
    }
  }),
);

useButton.addEventListener("click", () =>
  act(useButton, async () => {
    try {
      await invoke("custom_bb_save", {
        choice: { sha256: candidate.sha256, label: labelInput.value.trim() },
      });
    } catch (err) {
      setTestResult(typeof err === "string" ? err : "Presto could not save it.", "failed");
      return;
    }
    closeReview();
    await loadCustomBb();
  }),
);

cancelButton.addEventListener("click", () => {
  closeReview();
  render();
});

for (const [button, source] of [
  [$("custom-bb-copy"), fixCommand],
  [$("custom-bb-refused-copy"), refusedCommand],
]) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.textContent);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1500);
    } catch {
      // No clipboard access: select the command so the user can copy it by hand.
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  });
}

// The file can change while Settings stays open; coming back to the window reads it again.
window.addEventListener("focus", () => {
  if (!busy) loadCustomBb();
});
