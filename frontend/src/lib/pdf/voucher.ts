/**
 * A single-page confirmation voucher (hotel, transport, activity, flight,
 * tour, visa, insurance) — the document a supplier or the customer is
 * handed to prove a service is booked and paid for.
 *
 * `details` is intentionally a free-form `Record<string, string>`: what a
 * hotel voucher needs (room type, nights, meal plan) is not what a visa
 * voucher needs (application no., appointment date), and the calling page
 * already knows which one it is building — this module just lays out
 * whatever label/value pairs it is given.
 */
import { jsPDF } from "jspdf";
import { formatDateRange } from "@/lib/format";
import type { PdfCompanyProfile } from "./companyProfile";
import { ensurePdfReady } from "./fonts";
import { saveFilenameSafe } from "./saveFilename";
import {
  finalizeFooters,
  heading,
  hexToRgb,
  INK_RGB,
  MUTED_RGB,
  pageGeometry,
  renderLetterhead,
  runAutoTable,
  SOFT_FILL_RGB,
  text,
} from "./theme";

export type PdfVoucherType = "hotel" | "transport" | "activity" | "flight" | "tour" | "visa" | "insurance";

export interface PdfVoucherInput {
  voucherNo: string;
  voucherType: PdfVoucherType;
  bookingNo: string;
  issuedTo: string;
  supplierName?: string;
  validFrom?: string;
  validTo?: string;
  paxSummary: string;
  /** Label -> value rows, in display order (`Object.entries` order is preserved). */
  details: Record<string, string>;
  company: PdfCompanyProfile;
}

const VOUCHER_TITLES: Record<PdfVoucherType, string> = {
  hotel: "HOTEL VOUCHER",
  transport: "TRANSPORT VOUCHER",
  activity: "ACTIVITY VOUCHER",
  flight: "FLIGHT VOUCHER",
  tour: "TOUR VOUCHER",
  visa: "VISA VOUCHER",
  insurance: "INSURANCE VOUCHER",
};

/** Builds the voucher PDF in memory. Synchronous — no network, no fonts to await. */
export function buildVoucherPdf(input: PdfVoucherInput): jsPDF {
  const { company } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const g = pageGeometry(doc);
  const accent = hexToRgb(company.primaryColorHex);
  const docLabel = VOUCHER_TITLES[input.voucherType];

  const metaLines = [
    `Booking: ${input.bookingNo}`,
    ...(input.validFrom || input.validTo ? [`Valid: ${formatDateRange(input.validFrom, input.validTo)}`] : []),
  ];

  const headerY = renderLetterhead(doc, company, {
    docLabel,
    docNoLabel: "Voucher No.",
    docNo: input.voucherNo,
    accent,
    metaLines,
  });

  // ---- Confirmation summary panel --------------------------------------------
  const panelTop = headerY;
  const panelHeight = 22;
  doc.setFillColor(SOFT_FILL_RGB[0], SOFT_FILL_RGB[1], SOFT_FILL_RGB[2]);
  doc.rect(g.left, panelTop, g.contentWidth, panelHeight, "F");

  const colGap = g.contentWidth / 2;
  const cellPad = 5;

  const summaryRows: Array<[string, string, string, string]> = [
    ["Issued To", input.issuedTo, "Supplier", input.supplierName ?? "-"],
    ["Pax", input.paxSummary, "Voucher Status", "CONFIRMED"],
  ];

  summaryRows.forEach(([labelA, valueA, labelB, valueB], index) => {
    const y = panelTop + cellPad + 2 + index * 8.5;
    text(doc, labelA.toUpperCase(), g.left + cellPad, y, { size: 7.2, color: MUTED_RGB, bold: true });
    text(doc, valueA, g.left + cellPad, y + 4, { size: 9.5, color: INK_RGB, maxWidth: colGap - cellPad * 2 });
    text(doc, labelB.toUpperCase(), g.left + colGap + cellPad, y, { size: 7.2, color: MUTED_RGB, bold: true });
    text(doc, valueB, g.left + colGap + cellPad, y + 4, { size: 9.5, color: INK_RGB, maxWidth: colGap - cellPad * 2 });
  });

  let cursorY = panelTop + panelHeight + 10;

  // ---- Service details -----------------------------------------------------------
  const detailEntries = Object.entries(input.details);
  heading(doc, "Service Details", cursorY, { color: accent });
  cursorY += 5;

  if (detailEntries.length > 0) {
    cursorY =
      runAutoTable(doc, {
        startY: cursorY,
        margin: { left: g.left, right: g.margin },
        theme: "grid",
        body: detailEntries.map(([label, value]) => [label, value]),
        styles: { fontSize: 9.5, textColor: INK_RGB, cellPadding: 2.5 },
        columnStyles: {
          0: { cellWidth: g.contentWidth * 0.35, fontStyle: "bold", fillColor: SOFT_FILL_RGB },
          1: { cellWidth: g.contentWidth * 0.65 },
        },
      }) + 8;
  } else {
    text(doc, "No further service details were recorded for this voucher.", g.left, cursorY, {
      size: 9,
      color: MUTED_RGB,
      italic: true,
    });
    cursorY += 9;
  }

  text(doc, "Please present this voucher (printed or on-screen) to avail the service above.", g.left, cursorY, {
    size: 8.5,
    color: MUTED_RGB,
    italic: true,
    maxWidth: g.contentWidth,
  });

  finalizeFooters(doc, company, `${company.name} - ${docLabel} - ${input.voucherNo}`);
  return doc;
}

/** Builds the voucher PDF and triggers a browser download. */
export async function downloadVoucherPdf(input: PdfVoucherInput, filename?: string): Promise<void> {
  await ensurePdfReady();
  const doc = buildVoucherPdf(input);
  saveFilenameSafe(doc, filename ?? `Voucher_${input.voucherNo}`);
}
