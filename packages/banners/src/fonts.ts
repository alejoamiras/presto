export const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400..800&display=swap";

const LINK_ID = "presto-banner-fonts";

/**
 * Link the brand faces into the document once (font faces defined in the document apply inside
 * shadow trees). `mode: "none"` leaves typography to the host's page; the layout is designed to hold
 * on the system stack.
 */
export function ensureFonts(mode: string | null, doc: Document | undefined = globalThis.document) {
  if (mode === "none" || !doc?.head || doc.getElementById(LINK_ID)) return;
  const link = doc.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = FONTS_HREF;
  doc.head.appendChild(link);
}
