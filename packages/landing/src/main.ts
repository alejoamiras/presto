import {
  chooseDownload,
  type DownloadChoice,
  downloadLinks,
  REPO,
  readArchitecture,
  readDeviceSignals,
  releasePage,
} from "./download";
import { FEED_URL, feedVersionToTag } from "./feed";
import {
  detectPresto,
  LandingDetectionController,
  type LandingPrestoStatus,
  watchLoopbackPermissionChanges,
} from "./presto-detection";
import { initRace } from "./race";

// ── Scroll reveals ──
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15 },
);

for (const el of document.querySelectorAll(".reveal")) {
  observer.observe(el);
}

// ── Mobile nav ──
function initNav(): void {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  if (!toggle || !links) return;
  const setOpen = (open: boolean) => {
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => {
    setOpen(!links.classList.contains("open"));
  });
  links.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && links.classList.contains("open")) {
      setOpen(false);
      toggle.focus();
    }
  });
}
initNav();

// ── The race ──
initRace();

// ── OS-aware download button ──

// Resolve the live stable tag from the SIGNED KV-backed feed (single source of truth — B6), NOT a GitHub releases
// list-scan (which had no prerelease filter). Best effort, non-blocking; the feed body is untrusted and
// validated in `feedVersionToTag`.
async function fetchLatestPrestoTag(): Promise<string | null> {
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return feedVersionToTag(await res.json());
  } catch {
    return null;
  }
}

/** The release's asset list from the GitHub API, untrusted, or `undefined` if the request fails. */
async function fetchReleaseAssets(tag: string): Promise<unknown> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return undefined;
    return ((await res.json()) as { assets?: unknown } | null)?.assets;
  } catch {
    return undefined;
  }
}

async function initDownload(): Promise<void> {
  const btn = document.getElementById("download-btn") as HTMLAnchorElement | null;
  if (!btn) return;
  const render = (choice: DownloadChoice) => {
    btn.textContent = choice.label;
    const note = document.querySelector(".hero-note");
    if (choice.note && note) note.textContent = choice.note;
  };

  // Label the button before anything is awaited; the architecture hint only refines the choice.
  const signals = readDeviceSignals();
  render(chooseDownload(signals));
  const [tag, architecture] = await Promise.all([fetchLatestPrestoTag(), readArchitecture()]);
  const choice = chooseDownload({ ...signals, architecture });
  render(choice);
  if (!tag) return;
  btn.href = releasePage(tag);
  if (!choice.asset) return;

  const links = downloadLinks(choice, tag, await fetchReleaseAssets(tag));
  btn.href = links.href;
  const alternate = document.getElementById("download-alt") as HTMLAnchorElement | null;
  if (alternate && links.alternate) {
    alternate.textContent = links.alternate.label;
    alternate.href = links.alternate.href;
    alternate.classList.remove("hidden");
  }
}

initDownload();

// ── Presto detection ──
const heroSub = document.querySelector(".hero-sub") as HTMLElement | null;
const heroLink = heroSub?.querySelector("a") as HTMLAnchorElement | null;
const originalHeroLink = heroLink ? Array.from(heroLink.childNodes, (n) => n.cloneNode(true)) : [];

function renderPrestoStatus(status: LandingPrestoStatus): void {
  const blocked = status === "permission-blocked";
  const secureUnavailable = typeof status === "object";
  document.getElementById("landing-permission-help")?.classList.toggle("hidden", !blocked);
  document.getElementById("landing-secure-help")?.classList.toggle("hidden", !secureUnavailable);
  document.getElementById("download-actions")?.classList.toggle("hidden", blocked);

  if (secureUnavailable) {
    const explanation = {
      "https-disabled": {
        title: "Encrypted Connection is disabled",
        message: "Presto is running, but its HTTPS listener is off.",
      },
      "tls-or-trust-failure": {
        title: "Secure connection is not trusted",
        message: "Presto advertises HTTPS, but this browser could not establish it.",
      },
      "presto-reachable": {
        title: "Presto is reachable",
        message: "Its public health response hides the exact HTTPS configuration.",
      },
      unconfirmed: {
        title: "Secure connection unavailable",
        message:
          "Presto may be stopped or not installed, or the browser may have blocked the local diagnostic.",
      },
    }[status.diagnosis];
    const title = document.getElementById("landing-secure-title");
    const message = document.getElementById("landing-secure-message");
    if (title) title.textContent = explanation.title;
    if (message) message.textContent = explanation.message;
  }

  if (!heroSub || !heroLink) return;
  if (status === "available") {
    heroSub.classList.add("detected");
    const dot = document.createElement("span");
    dot.className = "accel-dot";
    dot.setAttribute("aria-hidden", "true");
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    heroLink.replaceChildren(dot, "Presto is running on this machine. Open the playground ", arrow);
  } else {
    // Offline and generic error remain deliberately quiet: restore the unchanged landing CTA.
    heroSub.classList.remove("detected");
    heroLink.replaceChildren(...originalHeroLink.map((n) => n.cloneNode(true)));
  }
}

const detection = new LandingDetectionController(detectPresto, renderPrestoStatus, (pending) => {
  for (const id of ["landing-permission-retry", "landing-secure-retry"]) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (!button) continue;
    button.disabled = pending;
    button.textContent = pending
      ? "Checking…"
      : id === "landing-secure-retry"
        ? "Retry secure connection"
        : "Retry";
  }
});

for (const id of ["landing-permission-retry", "landing-secure-retry"]) {
  document.getElementById(id)?.addEventListener("click", () => {
    // The detector has no settled cache. The token guard ensures a late startup result cannot
    // overwrite this same-context recovery attempt.
    void detection.refresh().catch(() => {});
  });
}

void (async () => {
  // Subscribe before the first health request can open the browser prompt. A decision made after the
  // bounded probe expires must still replace the quiet offline/download state without a reload.
  await watchLoopbackPermissionChanges(() => {
    void detection.refreshAfterPermissionChange().catch(() => {});
  });
  await detection.refresh();
})().catch(() => {});
