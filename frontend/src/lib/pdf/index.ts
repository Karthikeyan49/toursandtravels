/**
 * Client-side PDF generation engine for tours & travel documents.
 *
 * Every builder in this module takes a plain, self-contained input type
 * defined locally (see `itinerary.ts`, `invoice.ts`, `voucher.ts`) — never a
 * type imported from `@/lib/api/*`. Those API modules are owned by other
 * pages/agents and may not exist yet or may change shape; a calling page is
 * responsible for mapping whatever it fetched into these input shapes. This
 * is the standard "declarative template" split: the renderer takes data, not
 * an app entity.
 */
export { PDF_FONT_FAMILY, ensurePdfReady } from "./fonts";
export type { PdfCompanyProfile } from "./companyProfile";
export { saveFilenameSafe } from "./saveFilename";

export {
  DEFAULT_PRIMARY_HEX,
  INK_RGB,
  MUTED_RGB,
  LINE_RGB,
  SOFT_FILL_RGB,
  WHITE_RGB,
  POSITIVE_RGB,
  NEGATIVE_RGB,
  PAGE_MARGIN_MM,
  CONTINUATION_HEADER_RESERVE_MM,
  FOOTER_RESERVE_MM,
  hexToRgb,
  pageGeometry,
  text,
  hr,
  heading,
  drawCheck,
  drawCross,
  formatPdfMoney,
  formatPdfAmount,
  runAutoTable,
  renderLetterhead,
  renderContinuationHeader,
  ensureSpace,
  finalizeFooters,
} from "./theme";
export type { RgbTuple, PageGeometry, TextOptions, HeadingOptions, LetterheadOptions, ContinuationHeaderOptions, EnsureSpaceOptions, UserOptions } from "./theme";

export { buildItineraryPdf, downloadItineraryPdf } from "./itinerary";
export type {
  ItineraryInput,
  ItineraryBooking,
  ItineraryDay,
  ItineraryTravelLeg,
  ItineraryDriver,
  ItineraryOptions,
} from "./itinerary";

export { buildInvoicePdf, downloadInvoicePdf } from "./invoice";
export type { PdfInvoiceInput, PdfInvoiceType, PdfInvoiceCustomer, PdfInvoiceItem } from "./invoice";

export { buildVoucherPdf, downloadVoucherPdf } from "./voucher";
export type { PdfVoucherInput, PdfVoucherType } from "./voucher";
