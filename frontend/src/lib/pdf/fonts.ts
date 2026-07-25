/**
 * Font strategy for the PDF engine.
 *
 * jsPDF ships the 14 standard PDF fonts (Helvetica, Times, Courier, plus
 * bold/italic variants) with zero embedding cost, zero licensing risk, and
 * guaranteed rendering on every PDF viewer. Helvetica is metric-compatible
 * with Arial, which is what most business stationery in this market is
 * already set in, so business documents built on it read as normal, clean
 * print — without reaching for a proprietary font (e.g. Calibri, which is
 * not redistributable) or paying the size/latency cost of embedding a custom
 * TTF just for a look that's already achievable with a built-in font.
 *
 * If a genuinely open-license typeface is added later (e.g. Google's
 * open-sourced "Inter" or "Noto Sans"), it can be embedded here with
 * `doc.addFileToVFS` / `doc.addFont`, loaded once and cached. Every call site
 * already does `await ensurePdfReady()` before touching a document, so that
 * swap needs no changes anywhere else in the app.
 */
export const PDF_FONT_FAMILY = "helvetica" as const;

/**
 * Stable async hook for call sites. It is a no-op today because there is no
 * custom font to fetch or register — but keeping every `downloadXPdf` call
 * behind `await ensurePdfReady()` means adding real font loading later is a
 * change confined to this one file.
 */
export async function ensurePdfReady(): Promise<void> {
  // Intentionally empty — see module comment above.
}
