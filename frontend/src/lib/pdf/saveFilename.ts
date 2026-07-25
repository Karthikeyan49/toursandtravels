import type { jsPDF } from "jspdf";

/**
 * Sanitises a proposed filename before handing it to `doc.save()`.
 *
 * A booking number, customer name or invoice number can contain slashes,
 * quotes or other characters that would otherwise produce a broken download
 * (some browsers silently truncate at the first `/`) or, in the worst case,
 * a path/formula-injection-style surprise if that string is ever echoed
 * somewhere else. Anything that is not a word character, dot or hyphen is
 * replaced with `_`, and a `.pdf` extension is appended if missing.
 */
export function saveFilenameSafe(doc: jsPDF, name: string): void {
  const safe = name.replace(/[^\w.-]/g, "_");
  const withExtension = safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
  doc.save(withExtension);
}
