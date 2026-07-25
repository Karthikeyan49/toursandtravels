/**
 * Shared visual system for every PDF document built by this module — colors,
 * page geometry, text/rule/heading primitives, table pagination helpers and
 * the letterhead/footer used on every page, so an itinerary, an invoice and
 * a voucher all read as one consistent, branded system rather than four
 * independently-styled documents.
 */
import { jsPDF } from "jspdf";
import autoTable, { type UserOptions } from "jspdf-autotable";
import type { PdfCompanyProfile } from "./companyProfile";

export type { UserOptions } from "jspdf-autotable";

export type RgbTuple = [number, number, number];

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** Used only when a company has not configured `primaryColorHex`. */
export const DEFAULT_PRIMARY_HEX = "#1d4ed8";

export const INK_RGB: RgbTuple = [15, 23, 42]; // slate-900 — body text
export const MUTED_RGB: RgbTuple = [100, 116, 139]; // slate-500 — secondary text
export const LINE_RGB: RgbTuple = [203, 213, 225]; // slate-300 — hairlines
export const SOFT_FILL_RGB: RgbTuple = [241, 245, 249]; // slate-100 — panel backgrounds
export const WHITE_RGB: RgbTuple = [255, 255, 255];
export const POSITIVE_RGB: RgbTuple = [22, 163, 74]; // green-600 — checkmarks
export const NEGATIVE_RGB: RgbTuple = [220, 38, 38]; // red-600 — cross marks

/**
 * Parses "#rrggbb" or shorthand "#rgb" into the 0-255 int triples jsPDF's
 * `setTextColor`/`setFillColor`/`setDrawColor` expect. Falls back to
 * `DEFAULT_PRIMARY_HEX` on anything malformed so a bad or missing company
 * setting never breaks PDF generation.
 */
export function hexToRgb(hex: string | null | undefined): RgbTuple {
  return parseHex(hex ?? "") ?? parseHex(DEFAULT_PRIMARY_HEX) ?? [0, 0, 0];
}

function parseHex(hex: string): RgbTuple | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => `${c}${c}`)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const value = parseInt(full, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

export const PAGE_MARGIN_MM = 14;

/** Reserved top space on continuation pages for `renderContinuationHeader`. */
export const CONTINUATION_HEADER_RESERVE_MM = 24;

/** Reserved bottom space kept clear of table rows for the final footer pass. */
export const FOOTER_RESERVE_MM = 14;

export interface PageGeometry {
  width: number;
  height: number;
  margin: number;
  left: number;
  right: number;
  contentWidth: number;
  /** Y coordinate of the page's bottom margin line — where footer text sits. */
  bottom: number;
}

export function pageGeometry(doc: jsPDF, margin: number = PAGE_MARGIN_MM): PageGeometry {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  return {
    width,
    height,
    margin,
    left: margin,
    right: width - margin,
    contentWidth: width - margin * 2,
    bottom: height - margin,
  };
}

// ---------------------------------------------------------------------------
// Text / rule / heading primitives
// ---------------------------------------------------------------------------

export interface TextOptions {
  size?: number;
  color?: RgbTuple;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  maxWidth?: number;
}

/** Sets font/size/color then draws text — the one text primitive every builder uses. */
export function text(doc: jsPDF, value: string, x: number, y: number, opts: TextOptions = {}): void {
  const { size = 10, color = INK_RGB, bold = false, italic = false, align = "left", maxWidth } = opts;
  const style = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal";
  doc.setFont(PDF_FONT_FAMILY_LOCAL, style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
  doc.text(value, x, y, { align, ...(maxWidth !== undefined ? { maxWidth } : {}) });
}

// Kept file-local (rather than importing fonts.ts) to avoid a circular
// dependency between theme.ts and fonts.ts; both agree on "helvetica".
const PDF_FONT_FAMILY_LOCAL = "helvetica";

/** A single horizontal rule between two x coordinates at a given y. */
export function hr(doc: jsPDF, x1: number, x2: number, y: number, color: RgbTuple = LINE_RGB, weight = 0.2): void {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(weight);
  doc.line(x1, y, x2, y);
}

export interface HeadingOptions {
  x?: number;
  color?: RgbTuple;
  size?: number;
}

/** A small colored tick + bold caption — the section-title look shared by every document. */
export function heading(doc: jsPDF, label: string, y: number, opts: HeadingOptions = {}): number {
  const geometry = pageGeometry(doc);
  const { x = geometry.left, color = INK_RGB, size = 10.5 } = opts;
  doc.setFillColor(color[0], color[1], color[2]);
  doc.rect(x, y - 3.4, 1.3, 4.4, "F");
  text(doc, label.toUpperCase(), x + 3.6, y, { size, bold: true, color });
  return y;
}

// ---------------------------------------------------------------------------
// Vector check/cross marks
// ---------------------------------------------------------------------------
//
// jsPDF's built-in Helvetica/Times/Courier fonts use the PDF standard fonts'
// WinAnsi-style encoding (roughly Windows-1252), which does not contain the
// ✓ (U+2713) or ✗ (U+2717) glyphs — printing them as text would silently
// render blank boxes. Drawing the check/cross as two short vector strokes
// sidesteps the font entirely and renders identically on every viewer.

export function drawCheck(doc: jsPDF, x: number, y: number, size = 3.2, color: RgbTuple = POSITIVE_RGB): void {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(size * 0.22);
  doc.line(x, y, x + size * 0.35, y + size * 0.4);
  doc.line(x + size * 0.35, y + size * 0.4, x + size, y - size * 0.5);
}

export function drawCross(doc: jsPDF, x: number, y: number, size = 3.2, color: RgbTuple = NEGATIVE_RGB): void {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(size * 0.22);
  doc.line(x, y - size * 0.5, x + size, y + size * 0.5);
  doc.line(x, y + size * 0.5, x + size, y - size * 0.5);
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------

const pdfAmountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * `formatMoney` in `@/lib/format` prints the ₹ (U+20B9) glyph via
 * `Intl.NumberFormat`'s currency style — a glyph jsPDF's built-in fonts
 * cannot render (see the check/cross note above; same encoding limitation).
 * Rather than embed a custom font for one symbol, printed amounts use the
 * "Rs." prefix — the common fallback already used on printed Indian
 * stationery — while keeping the identical en-IN lakh/crore grouping, so the
 * on-screen figure and the printed figure always agree numerically.
 */
export function formatPdfMoney(value: number | string | null | undefined, placeholder = "-"): string {
  const amount = toFiniteNumber(value);
  if (amount === null) return placeholder;
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rs. ${pdfAmountFormatter.format(Math.abs(amount))}`;
}

/** Bare grouped number (no "Rs." prefix) — for table cells under a shared money column header. */
export function formatPdfAmount(value: number | string | null | undefined, placeholder = "-"): string {
  const amount = toFiniteNumber(value);
  if (amount === null) return placeholder;
  return pdfAmountFormatter.format(amount);
}

// ---------------------------------------------------------------------------
// autoTable helper
// ---------------------------------------------------------------------------

/**
 * jspdf-autotable stamps `lastAutoTable` onto the jsPDF instance at runtime
 * so callers can find where the table ended — but its own bundled types
 * declare the `doc` parameter as `any` throughout, so that property is
 * invisible to TypeScript. This local interface is the standard, narrow
 * workaround: it describes only the one runtime property this module reads.
 */
interface DocWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}

/** Runs one autoTable call and returns the Y just below the table it drew. */
export function runAutoTable(doc: jsPDF, options: UserOptions): number {
  autoTable(doc, options);
  const withTable = doc as DocWithAutoTable;
  const fallback = typeof options.startY === "number" ? options.startY : pageGeometry(doc).margin;
  return withTable.lastAutoTable?.finalY ?? fallback;
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

type SupportedImageFormat = "PNG" | "JPEG" | "WEBP";

function inferImageFormat(dataUrl: string): SupportedImageFormat | null {
  const match = /^data:image\/(png|jpe?g|webp)/i.exec(dataUrl);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  if (ext === "png") return "PNG";
  if (ext === "webp") return "WEBP";
  return "JPEG";
}

/**
 * Draws a logo scaled to fit inside a `maxW`×`maxH` box, preserving aspect
 * ratio. Returns whether anything was drawn. `logoDataUrl` comes from a
 * settings page and may be missing, corrupt, or an unsupported format — none
 * of which should ever break PDF generation, hence the try/catch.
 */
function tryDrawImage(doc: jsPDF, dataUrl: string, x: number, y: number, maxW: number, maxH: number): boolean {
  try {
    const format = inferImageFormat(dataUrl);
    if (!format) return false;
    const props = doc.getImageProperties(dataUrl);
    if (!props.width || !props.height) return false;
    const ratio = Math.min(maxW / props.width, maxH / props.height);
    const w = props.width * ratio;
    const h = props.height * ratio;
    doc.addImage(dataUrl, format, x, y, w, h);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Letterhead / continuation header / footer
// ---------------------------------------------------------------------------

export interface LetterheadOptions {
  /** e.g. "TRIP ITINERARY", "TAX INVOICE", "CASH BILL", "HOTEL VOUCHER". */
  docLabel: string;
  docLabelColor?: RgbTuple;
  /** e.g. "Booking No.", "Invoice No.", "Voucher No." — defaults to "No.". */
  docNoLabel?: string;
  docNo: string;
  /** Extra right-aligned lines below the doc number (dates, subtype, status). */
  metaLines?: string[];
  accent?: RgbTuple;
}

/**
 * Rich, once-per-document header for page 1 only: logo/name/address block on
 * the left, document identity on the right, a brand-colored rule underneath.
 * Continuation pages use the much slimmer `renderContinuationHeader` — see
 * its comment for why the two are deliberately different.
 */
export function renderLetterhead(doc: jsPDF, company: PdfCompanyProfile, opts: LetterheadOptions): number {
  const g = pageGeometry(doc);
  const accent = opts.accent ?? hexToRgb(company.primaryColorHex);

  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, g.width, 2.4, "F");

  let leftX = g.left;
  const topY = g.margin + 9;
  if (company.logoDataUrl) {
    const box = 16;
    const drawn = tryDrawImage(doc, company.logoDataUrl, leftX, g.margin + 4, box, box);
    if (drawn) leftX += box + 4;
  }

  text(doc, company.name, leftX, topY, { size: 14, bold: true, color: INK_RGB });
  let leftY = topY + 5;
  const addressBits = [company.address, company.city, company.state, company.pincode].filter(Boolean).join(", ");
  if (addressBits) {
    text(doc, addressBits, leftX, leftY, { size: 8.3, color: MUTED_RGB, maxWidth: g.contentWidth * 0.55 });
    leftY += 4.2;
  }
  const contactBits = [company.phone ? `Ph: ${company.phone}` : null, company.email, company.website]
    .filter(Boolean)
    .join("   |   ");
  if (contactBits) {
    text(doc, contactBits, leftX, leftY, { size: 8.3, color: MUTED_RGB });
    leftY += 4.2;
  }
  const regBits = [company.gstin ? `GSTIN: ${company.gstin}` : null, company.pan ? `PAN: ${company.pan}` : null]
    .filter(Boolean)
    .join("   |   ");
  if (regBits) {
    text(doc, regBits, leftX, leftY, { size: 8.3, color: MUTED_RGB });
    leftY += 4.2;
  }

  text(doc, opts.docLabel, g.right, topY, {
    size: 15,
    bold: true,
    color: opts.docLabelColor ?? accent,
    align: "right",
  });
  let rightY = topY + 5.4;
  text(doc, `${opts.docNoLabel ?? "No."}: ${opts.docNo}`, g.right, rightY, { size: 9, bold: true, align: "right" });
  rightY += 4.2;
  for (const line of opts.metaLines ?? []) {
    text(doc, line, g.right, rightY, { size: 8.3, color: MUTED_RGB, align: "right" });
    rightY += 4;
  }

  const cursorY = Math.max(leftY, rightY) + 2;
  hr(doc, g.left, g.right, cursorY, accent, 0.5);
  return cursorY + 6;
}

export interface ContinuationHeaderOptions {
  docLabel: string;
  docNo: string;
  accent?: RgbTuple;
}

/**
 * Slim, repeated header for page 2+, drawn from an autoTable `didDrawPage`
 * hook (or manually before a hand-drawn block via `ensureSpace`). Page 1
 * carries the full letterhead already — repeating logo/address/company
 * details on every page of a multi-page itinerary would waste space and
 * look cluttered, but a reader who flips straight to page 4 has lost which
 * booking/invoice this even is, so continuation pages re-state just that.
 */
export function renderContinuationHeader(doc: jsPDF, company: PdfCompanyProfile, opts: ContinuationHeaderOptions): void {
  const g = pageGeometry(doc);
  const accent = opts.accent ?? hexToRgb(company.primaryColorHex);
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(0, 0, g.width, 1.6, "F");
  text(doc, company.name, g.left, g.margin + 4, { size: 9.5, bold: true });
  text(doc, `${opts.docLabel} - ${opts.docNo}`, g.right, g.margin + 4, { size: 9, color: MUTED_RGB, align: "right" });
  hr(doc, g.left, g.right, g.margin + 6.5, LINE_RGB, 0.2);
}

export interface EnsureSpaceOptions {
  company: PdfCompanyProfile;
  docLabel: string;
  docNo: string;
  accent?: RgbTuple;
  /** Extra bottom margin to keep clear beyond the block itself. Default 12mm. */
  footerReserve?: number;
}

/**
 * For hand-drawn (non-autoTable) blocks: if `neededHeight` would run past the
 * bottom margin, starts a new page and redraws the continuation header, so a
 * cover panel, checklist or callout box never gets silently cut off or drawn
 * into the footer's territory. Returns the Y to resume drawing at.
 */
export function ensureSpace(doc: jsPDF, cursorY: number, neededHeight: number, opts: EnsureSpaceOptions): number {
  const g = pageGeometry(doc);
  const reserve = opts.footerReserve ?? 12;
  if (cursorY + neededHeight <= g.bottom - reserve) return cursorY;
  doc.addPage();
  renderContinuationHeader(doc, opts.company, { docLabel: opts.docLabel, docNo: opts.docNo, accent: opts.accent });
  return g.margin + CONTINUATION_HEADER_RESERVE_MM - 10;
}

/**
 * Stamps a hairline + company name (left) and "Page X of Y" (right) on every
 * page. Deliberately a single final pass over `doc.getNumberOfPages()` rather
 * than something drawn incrementally inside `didDrawPage`: the true total
 * page count of the document isn't known until every section — tables,
 * hand-drawn panels, page breaks from `ensureSpace` — has finished drawing,
 * so this is the only point at which "of Y" can be correct.
 */
export function finalizeFooters(doc: jsPDF, company: PdfCompanyProfile, note?: string): void {
  const total = doc.getNumberOfPages();
  const g = pageGeometry(doc);
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    hr(doc, g.left, g.right, g.bottom - 4, LINE_RGB, 0.2);
    text(doc, note ?? company.name, g.left, g.bottom, { size: 7.6, color: MUTED_RGB });
    text(doc, `Page ${page} of ${total}`, g.right, g.bottom, { size: 7.6, color: MUTED_RGB, align: "right" });
  }
}
