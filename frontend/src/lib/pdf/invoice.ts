/**
 * GST-inclusive tax invoices and Non-GST (cash/general) bills, plus the
 * proforma/credit-note/debit-note variants of the same document family — the
 * second half of the client's explicit ask: "the ability to generate both
 * GST-inclusive invoices and Non-GST (general/cash) invoices"
 * (Tours_Travels_Software_Requirements.md §5).
 *
 * `isGstApplicable` is the legal switch: when false, every GST/CGST/SGST/
 * IGST column and total row is omitted entirely (never shown as zero), and
 * the header reads "CASH BILL" / "Non-GST" instead of "TAX INVOICE" — this
 * is a real statutory distinction, not a cosmetic one, so it is never
 * fudged by just hiding a zero.
 */
import { jsPDF } from "jspdf";
import { formatDate } from "@/lib/format";
import type { PdfCompanyProfile } from "./companyProfile";
import { ensurePdfReady } from "./fonts";
import { saveFilenameSafe } from "./saveFilename";
import {
  finalizeFooters,
  formatPdfAmount,
  formatPdfMoney,
  heading,
  hexToRgb,
  hr,
  INK_RGB,
  LINE_RGB,
  MUTED_RGB,
  pageGeometry,
  renderContinuationHeader,
  renderLetterhead,
  runAutoTable,
  SOFT_FILL_RGB,
  text,
  CONTINUATION_HEADER_RESERVE_MM,
  FOOTER_RESERVE_MM,
} from "./theme";

export type PdfInvoiceType = "tax_invoice" | "cash_bill" | "proforma" | "credit_note" | "debit_note";

export interface PdfInvoiceCustomer {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  phone?: string;
}

export interface PdfInvoiceItem {
  description: string;
  sacCode?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxableValue: number;
  gstPct: number;
  gstAmount: number;
  lineTotal: number;
}

export interface PdfInvoiceInput {
  invoiceNo: string;
  invoiceType: PdfInvoiceType;
  isGstApplicable: boolean;
  invoiceDate: string;
  dueDate?: string;
  customer: PdfInvoiceCustomer;
  placeOfSupply?: string;
  items: PdfInvoiceItem[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  tcsAmount: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
  notes?: string;
  terms?: string;
  company: PdfCompanyProfile;
}

const INVOICE_TITLES: Record<PdfInvoiceType, string> = {
  tax_invoice: "TAX INVOICE",
  cash_bill: "CASH BILL",
  proforma: "PROFORMA INVOICE",
  credit_note: "CREDIT NOTE",
  debit_note: "DEBIT NOTE",
};

/** Builds the invoice/cash-bill PDF in memory. Synchronous — no network, no fonts to await. */
export function buildInvoicePdf(input: PdfInvoiceInput): jsPDF {
  const { customer, items, company } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const g = pageGeometry(doc);
  const accent = hexToRgb(company.primaryColorHex);

  const gstApplicable = input.isGstApplicable;
  const docLabel = gstApplicable ? INVOICE_TITLES[input.invoiceType] : "CASH BILL";
  const subtitle = gstApplicable ? undefined : "Non-GST";

  const metaLines = [
    `Date: ${formatDate(input.invoiceDate)}`,
    ...(input.dueDate ? [`Due: ${formatDate(input.dueDate)}`] : []),
    ...(subtitle ? [subtitle] : []),
  ];

  const headerY = renderLetterhead(doc, company, {
    docLabel,
    docLabelColor: gstApplicable ? accent : [180, 83, 9], // amber — visually flags the non-GST case
    docNoLabel: "Invoice No.",
    docNo: input.invoiceNo,
    accent,
    metaLines,
  });

  // ---- Bill To / Place of supply --------------------------------------------
  const panelTop = headerY;
  const halfWidth = g.contentWidth / 2 - 4;

  text(doc, "BILL TO", g.left, panelTop, { size: 7.5, bold: true, color: MUTED_RGB });
  let custY = panelTop + 4.5;
  text(doc, customer.name, g.left, custY, { size: 10, bold: true });
  custY += 4.5;
  const custAddress = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(", ");
  if (custAddress) {
    text(doc, custAddress, g.left, custY, { size: 8.5, color: MUTED_RGB, maxWidth: halfWidth });
    custY += 4.2;
  }
  if (customer.phone) {
    text(doc, `Ph: ${customer.phone}`, g.left, custY, { size: 8.5, color: MUTED_RGB });
    custY += 4.2;
  }
  if (customer.gstin) {
    text(doc, `GSTIN: ${customer.gstin}`, g.left, custY, { size: 8.5, color: MUTED_RGB });
    custY += 4.2;
  }

  const rightX = g.left + halfWidth + 8;
  let metaY = panelTop + 4.5;
  if (input.placeOfSupply) {
    text(doc, "PLACE OF SUPPLY", rightX, panelTop, { size: 7.5, bold: true, color: MUTED_RGB });
    text(doc, input.placeOfSupply, rightX, metaY, { size: 9.5 });
    metaY += 4.5;
  }

  let cursorY = Math.max(custY, metaY) + 6;
  hr(doc, g.left, g.right, cursorY - 4, LINE_RGB, 0.2);

  // ---- Line items --------------------------------------------------------------
  const tableMargin = { top: CONTINUATION_HEADER_RESERVE_MM, left: g.left, right: g.margin, bottom: FOOTER_RESERVE_MM };
  const continuation = () => renderContinuationHeader(doc, company, { docLabel, docNo: input.invoiceNo, accent });

  const head = gstApplicable
    ? [["#", "Description", "SAC", "Qty", "Unit", "Rate", "Taxable Value", "GST%", "GST Amt", "Line Total"]]
    : [["#", "Description", "Qty", "Unit", "Rate", "Amount"]];

  const body = items.map((item, index) =>
    gstApplicable
      ? [
          `${index + 1}`,
          item.description,
          item.sacCode ?? "-",
          formatPdfAmount(item.quantity),
          item.unit,
          formatPdfAmount(item.unitPrice),
          formatPdfAmount(item.taxableValue),
          `${formatPdfAmount(item.gstPct)}%`,
          formatPdfAmount(item.gstAmount),
          formatPdfAmount(item.lineTotal),
        ]
      : [
          `${index + 1}`,
          item.description,
          formatPdfAmount(item.quantity),
          item.unit,
          formatPdfAmount(item.unitPrice),
          formatPdfAmount(item.lineTotal),
        ],
  );

  cursorY =
    runAutoTable(doc, {
      startY: cursorY,
      margin: tableMargin,
      theme: "grid",
      head,
      body,
      headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: INK_RGB, valign: "top" },
      alternateRowStyles: { fillColor: SOFT_FILL_RGB },
      columnStyles: gstApplicable
        ? { 0: { cellWidth: 8 }, 1: { cellWidth: "auto" }, 2: { cellWidth: 14 } }
        : { 0: { cellWidth: 8 }, 1: { cellWidth: "auto" } },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) continuation();
      },
    }) + 6;

  // ---- Totals --------------------------------------------------------------------
  const totalsWidth = 80;
  const totalsX = g.right - totalsWidth;
  const rows: Array<[string, string]> = [["Subtotal", formatPdfMoney(input.subtotal)]];

  if (input.discountAmount > 0) rows.push(["Discount", `- ${formatPdfMoney(input.discountAmount)}`]);

  if (gstApplicable) {
    rows.push(["Taxable Amount", formatPdfMoney(input.taxableAmount)]);
    if (input.cgstAmount > 0 && input.sgstAmount > 0) {
      rows.push(["CGST", formatPdfMoney(input.cgstAmount)]);
      rows.push(["SGST", formatPdfMoney(input.sgstAmount)]);
    } else if (input.igstAmount > 0) {
      rows.push(["IGST", formatPdfMoney(input.igstAmount)]);
    }
    if (input.tcsAmount > 0) rows.push(["TCS", formatPdfMoney(input.tcsAmount)]);
  }

  if (input.roundOff !== 0) {
    rows.push(["Round Off", `${input.roundOff > 0 ? "+ " : "- "}${formatPdfMoney(Math.abs(input.roundOff))}`]);
  }

  const neededHeight = rows.length * 5.5 + 14;
  if (cursorY + neededHeight > g.bottom - FOOTER_RESERVE_MM) {
    doc.addPage();
    continuation();
    cursorY = g.margin + CONTINUATION_HEADER_RESERVE_MM - 10;
  }

  rows.forEach(([label, value]) => {
    text(doc, label, totalsX, cursorY, { size: 9, color: MUTED_RGB });
    text(doc, value, g.right, cursorY, { size: 9, align: "right" });
    cursorY += 5.5;
  });

  hr(doc, totalsX, g.right, cursorY, accent, 0.4);
  cursorY += 5.5;
  text(doc, "Grand Total", totalsX, cursorY, { size: 10.5, bold: true });
  text(doc, formatPdfMoney(input.grandTotal), g.right, cursorY, { size: 10.5, bold: true, align: "right" });
  cursorY += 9;

  text(doc, `Amount in Words: ${input.amountInWords}`, g.left, cursorY, { size: 8.7, italic: true, color: MUTED_RGB });
  cursorY += 9;

  // ---- Bank details / notes / terms -----------------------------------------
  if (company.bank && (company.bank.accountNo || company.bank.upiId)) {
    heading(doc, "Payment Details", cursorY, { color: accent, size: 8.5 });
    cursorY += 5;
    const bank = company.bank;
    const bankLines = [
      bank.accountName ? `Account Name: ${bank.accountName}` : null,
      bank.name ? `Bank: ${bank.name}` : null,
      bank.accountNo ? `A/C No.: ${bank.accountNo}` : null,
      bank.ifsc ? `IFSC: ${bank.ifsc}` : null,
      bank.upiId ? `UPI: ${bank.upiId}` : null,
    ].filter((line): line is string => Boolean(line));
    bankLines.forEach((line) => {
      text(doc, line, g.left, cursorY, { size: 8.3, color: MUTED_RGB });
      cursorY += 4;
    });
    cursorY += 3;
  }

  if (input.notes) {
    heading(doc, "Notes", cursorY, { color: accent, size: 8.5 });
    cursorY += 5;
    text(doc, input.notes, g.left, cursorY, { size: 8.3, color: MUTED_RGB, maxWidth: g.contentWidth });
    cursorY += 8;
  }

  if (input.terms) {
    heading(doc, "Terms & Conditions", cursorY, { color: accent, size: 8.5 });
    cursorY += 5;
    text(doc, input.terms, g.left, cursorY, { size: 8.3, color: MUTED_RGB, maxWidth: g.contentWidth });
  }

  finalizeFooters(doc, company, `${company.name} - ${docLabel} - ${input.invoiceNo}`);
  return doc;
}

/** Builds the invoice/cash-bill PDF and triggers a browser download. */
export async function downloadInvoicePdf(input: PdfInvoiceInput, filename?: string): Promise<void> {
  await ensurePdfReady();
  const doc = buildInvoicePdf(input);
  saveFilenameSafe(doc, filename ?? `Invoice_${input.invoiceNo}`);
}
