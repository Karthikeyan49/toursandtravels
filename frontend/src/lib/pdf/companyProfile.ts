/**
 * The issuing company's letterhead data. Every document builder in this
 * module takes one of these — populated by the calling page from
 * `/admin/settings` (backed by `Setting::companyProfile()` server-side) — so
 * the PDF engine itself never fetches anything and stays fully decoupled
 * from `@/lib/api/*`.
 *
 * All fields but `name` are optional: a fresh install with an incomplete
 * settings page must still be able to print a usable, if sparse, document.
 */
export interface PdfCompanyProfile {
  /** Trading name shown large in the letterhead. */
  name: string;
  /** Full registered name, shown smaller where a legal distinction matters (e.g. invoices). */
  legalName?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** 15-character GST Identification Number. */
  gstin?: string;
  pan?: string;
  /** Data URL (e.g. "data:image/png;base64,...") — no network fetch is performed. */
  logoDataUrl?: string;
  /** "#rrggbb" — drives every accent color/rule across all four document types. */
  primaryColorHex?: string;
  bank?: {
    name?: string;
    accountName?: string;
    accountNo?: string;
    ifsc?: string;
    upiId?: string;
  };
}
