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
