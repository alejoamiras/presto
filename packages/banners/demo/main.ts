import { BANNER_EVENTS, type BannerState } from "../src/register.js";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const banners = () => Array.from(document.querySelectorAll("presto-banner"));
const log = $("#events");

for (const type of Object.values(BANNER_EVENTS)) {
  document.addEventListener(type, (event) => {
    const { detail } = event as CustomEvent;
    log.textContent = `${type} ${JSON.stringify(detail)}\n${log.textContent ?? ""}`;
  });
}

// Stands in for the host's first status check: Connecting… for a moment, then Presto is found.
document.addEventListener(BANNER_EVENTS.connect, (event) => {
  const banner = event.target as HTMLElement;
  setTimeout(() => banner.setAttribute("state", "available"), 1200);
});

$("#state").addEventListener("change", (event) => {
  const value = (event.target as HTMLSelectElement).value as BannerState | "";
  for (const el of banners()) el.setAttribute("state", value);
});
$("#theme").addEventListener("change", (event) => {
  for (const el of banners()) el.setAttribute("theme", (event.target as HTMLSelectElement).value);
});
$("#host").addEventListener("change", (event) => {
  document.body.dataset.host = (event.target as HTMLSelectElement).value;
});
$("#reset").addEventListener("click", () => {
  for (const key of Object.keys(localStorage))
    if (key.includes("banner")) localStorage.removeItem(key);
  location.reload();
});
$("#sheet").addEventListener("click", () => {
  $('presto-banner[variant="sheet"]').setAttribute("state", "offline");
});
$("#dock").addEventListener("click", () => {
  $('presto-banner[variant="dock"]').setAttribute("state", "offline");
});
