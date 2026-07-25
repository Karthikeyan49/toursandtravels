/**
 * The client's priority document: "compile all travel, accommodation, and
 * local contact details into a single, clean, printable document to be
 * handed over physically (or via PDF) to the customer before the trip"
 * (Tours_Travels_Software_Requirements.md §5).
 *
 * This module takes a plain, self-contained data shape — not an app-wide
 * `Booking` entity — so the calling page maps whatever it fetched from
 * `@/lib/api/bookings` (or wherever) into `ItineraryInput` before calling
 * `buildItineraryPdf`/`downloadItineraryPdf`. See the module-level comment in
 * `index.ts` for why this module never imports from `@/lib/api/*`.
 */
import { jsPDF } from "jspdf";
import { formatDate, formatDateRange, formatDuration, formatPax, formatPhone } from "@/lib/format";
import type { PdfCompanyProfile } from "./companyProfile";
import { ensurePdfReady } from "./fonts";
import { saveFilenameSafe } from "./saveFilename";
import {
  drawCheck,
  drawCross,
  ensureSpace,
  finalizeFooters,
  heading,
  hexToRgb,
  INK_RGB,
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

export interface ItineraryBooking {
  bookingNo: string;
  leadPaxName: string;
  contactPhone?: string;
  travelFrom: string;
  travelTo: string;
  nights: number;
  adults: number;
  children: number;
  infants: number;
  destinationName?: string;
  packageName?: string;
}

export interface ItineraryDay {
  dayNo: number;
  date?: string;
  title: string;
  description?: string;
  hotelName?: string;
  mealPlan?: string;
}

export interface ItineraryTravelLeg {
  legNo: number;
  mode: "flight" | "train" | "bus" | "car" | "other";
  direction: "onward" | "return" | "internal";
  carrierName?: string;
  vehicleNumber?: string;
  pnr?: string;
  seatClass?: string;
  fromLocation: string;
  toLocation: string;
  departureDate: string;
  departureTime?: string;
  arrivalDate?: string;
  arrivalTime?: string;
  baggageAllowance?: string;
}

export interface ItineraryDriver {
  fromDate: string;
  toDate: string;
  driverName?: string;
  driverPhone?: string;
  vehicleType?: string;
  registrationNo?: string;
  pickupPoint?: string;
}

export interface ItineraryOptions {
  transportMode?: string;
  roomCategory?: string;
  foodIncluded?: boolean;
  dietType?: "veg" | "non_veg" | "brahmin" | "jain";
  baggageIncluded?: boolean;
  baggageNotes?: string;
  localTransportIncluded?: boolean;
  sightseeingIncluded?: boolean;
  insuranceIncluded?: boolean;
}

export interface ItineraryInput {
  booking: ItineraryBooking;
  days: ItineraryDay[];
  travelLegs: ItineraryTravelLeg[];
  drivers: ItineraryDriver[];
  options?: ItineraryOptions;
  emergencyContact?: { name?: string; phone?: string };
  company: PdfCompanyProfile;
}

const DOC_LABEL = "TRIP ITINERARY";

const DIET_LABELS: Record<NonNullable<ItineraryOptions["dietType"]>, string> = {
  veg: "Vegetarian",
  non_veg: "Non-Vegetarian",
  brahmin: "Brahmin Food",
  jain: "Jain Food",
};

const MODE_LABELS: Record<ItineraryTravelLeg["mode"], string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  car: "Car",
  other: "Other",
};

/** "HH:mm[:ss]" -> "2:30 PM". Falls back to the raw string if unparsable. */
function formatClock(time: string | undefined): string {
  if (!time) return "-";
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return time;
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatDateTimeCell(date: string | undefined, time: string | undefined): string {
  if (!date) return "-";
  const dateLabel = formatDate(date);
  return time ? `${dateLabel} ${formatClock(time)}` : dateLabel;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1).replace(/_/g, " ")}`;
}

/** Builds the itinerary PDF in memory. Synchronous — no network, no fonts to await. */
export function buildItineraryPdf(input: ItineraryInput): jsPDF {
  const { booking, days, travelLegs, drivers, options, emergencyContact, company } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const g = pageGeometry(doc);
  const accent = hexToRgb(company.primaryColorHex);

  const headerY = renderLetterhead(doc, company, {
    docLabel: DOC_LABEL,
    docNoLabel: "Booking No.",
    docNo: booking.bookingNo,
    accent,
    metaLines: [`Generated: ${formatDate(new Date())}`],
  });

  // ---- Cover panel: who, when, how many ------------------------------------
  const panelTop = headerY;
  const panelHeight = 26;
  doc.setFillColor(SOFT_FILL_RGB[0], SOFT_FILL_RGB[1], SOFT_FILL_RGB[2]);
  doc.rect(g.left, panelTop, g.contentWidth, panelHeight, "F");

  const colGap = g.contentWidth / 2;
  const rowStep = 7.5;
  const cellPad = 5;
  const destination = booking.destinationName ?? booking.packageName ?? "-";

  const coverRows: Array<[string, string, string, string]> = [
    ["Lead Passenger", booking.leadPaxName, "Contact", formatPhone(booking.contactPhone)],
    ["Travel Dates", formatDateRange(booking.travelFrom, booking.travelTo), "Duration", formatDuration(booking.nights)],
    ["Pax", formatPax(booking.adults, booking.children, booking.infants), "Destination", destination],
  ];

  coverRows.forEach(([labelA, valueA, labelB, valueB], index) => {
    const y = panelTop + cellPad + 2 + index * rowStep;
    text(doc, labelA.toUpperCase(), g.left + cellPad, y, { size: 7.2, color: MUTED_RGB, bold: true });
    text(doc, valueA, g.left + cellPad, y + 4, { size: 9.5, color: INK_RGB, maxWidth: colGap - cellPad * 2 });
    text(doc, labelB.toUpperCase(), g.left + colGap + cellPad, y, { size: 7.2, color: MUTED_RGB, bold: true });
    text(doc, valueB, g.left + colGap + cellPad, y + 4, { size: 9.5, color: INK_RGB, maxWidth: colGap - cellPad * 2 });
  });

  let cursorY = panelTop + panelHeight + 9;

  const tableMargin = { top: CONTINUATION_HEADER_RESERVE_MM, left: g.left, right: g.margin, bottom: FOOTER_RESERVE_MM };
  const continuation = () => renderContinuationHeader(doc, company, { docLabel: DOC_LABEL, docNo: booking.bookingNo, accent });

  // ---- Day-by-day itinerary --------------------------------------------------
  heading(doc, "Day-by-day Itinerary", cursorY, { color: accent });
  cursorY += 5;
  if (days.length > 0) {
    cursorY =
      runAutoTable(doc, {
        startY: cursorY,
        margin: tableMargin,
        theme: "grid",
        head: [["Day", "Date", "Itinerary", "Hotel", "Meals"]],
        body: days
          .slice()
          .sort((a, b) => a.dayNo - b.dayNo)
          .map((day) => [
            `Day ${day.dayNo}`,
            formatDate(day.date),
            day.description ? `${day.title}\n${day.description}` : day.title,
            day.hotelName ?? "-",
            day.mealPlan ?? "-",
          ]),
        headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold", fontSize: 8.5 },
        bodyStyles: { fontSize: 8.5, textColor: INK_RGB, valign: "top" },
        alternateRowStyles: { fillColor: SOFT_FILL_RGB },
        columnStyles: {
          0: { cellWidth: 16 },
          1: { cellWidth: 24 },
          2: { cellWidth: "auto" },
          3: { cellWidth: 34 },
          4: { cellWidth: 20 },
        },
        didDrawPage: (data) => {
          if (data.pageNumber > 1) continuation();
        },
      }) + 9;
  } else {
    text(doc, "No day-by-day itinerary has been recorded for this booking.", g.left, cursorY, {
      size: 9,
      color: MUTED_RGB,
      italic: true,
    });
    cursorY += 9;
  }

  // ---- Travel logistics -------------------------------------------------------
  cursorY = ensureSpace(doc, cursorY, 20, { company, docLabel: DOC_LABEL, docNo: booking.bookingNo, accent });
  heading(doc, "Travel Logistics", cursorY, { color: accent });
  cursorY += 5;
  if (travelLegs.length > 0) {
    cursorY =
      runAutoTable(doc, {
        startY: cursorY,
        margin: tableMargin,
        theme: "grid",
        head: [["Leg", "Mode", "Carrier / No.", "PNR / Class", "Route", "Departure", "Arrival", "Baggage"]],
        body: travelLegs
          .slice()
          .sort((a, b) => a.legNo - b.legNo)
          .map((leg) => [
            `${leg.legNo}`,
            `${MODE_LABELS[leg.mode]}\n(${capitalize(leg.direction)})`,
            [leg.carrierName, leg.vehicleNumber].filter(Boolean).join(" - ") || "-",
            [leg.pnr, leg.seatClass].filter(Boolean).join(" / ") || "-",
            `${leg.fromLocation} -> ${leg.toLocation}`,
            formatDateTimeCell(leg.departureDate, leg.departureTime),
            leg.arrivalDate ? formatDateTimeCell(leg.arrivalDate, leg.arrivalTime) : "-",
            leg.baggageAllowance ?? "-",
          ]),
        headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold", fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: INK_RGB, valign: "top" },
        alternateRowStyles: { fillColor: SOFT_FILL_RGB },
        didDrawPage: (data) => {
          if (data.pageNumber > 1) continuation();
        },
      }) + 9;
  } else {
    text(doc, "No travel legs have been finalised for this booking yet.", g.left, cursorY, {
      size: 9,
      color: MUTED_RGB,
      italic: true,
    });
    cursorY += 9;
  }

  // ---- Local transport & driver contacts --------------------------------------
  cursorY = ensureSpace(doc, cursorY, 20, { company, docLabel: DOC_LABEL, docNo: booking.bookingNo, accent });
  heading(doc, "Local Transport & Driver Contacts", cursorY, { color: accent });
  cursorY += 5;
  if (drivers.length > 0) {
    cursorY =
      runAutoTable(doc, {
        startY: cursorY,
        margin: tableMargin,
        theme: "grid",
        head: [["Period", "Driver", "Phone", "Vehicle", "Reg. No.", "Pickup Point"]],
        body: drivers.map((driver) => [
          `${formatDate(driver.fromDate)} - ${formatDate(driver.toDate)}`,
          driver.driverName ?? "-",
          formatPhone(driver.driverPhone),
          driver.vehicleType ?? "-",
          driver.registrationNo ?? "-",
          driver.pickupPoint ?? "-",
        ]),
        headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold", fontSize: 8.5 },
        bodyStyles: { fontSize: 8.5, textColor: INK_RGB, valign: "top" },
        alternateRowStyles: { fillColor: SOFT_FILL_RGB },
        didDrawPage: (data) => {
          if (data.pageNumber > 1) continuation();
        },
      }) + 9;
  } else {
    text(doc, "No local driver has been assigned to this booking yet.", g.left, cursorY, {
      size: 9,
      color: MUTED_RGB,
      italic: true,
    });
    cursorY += 9;
  }

  // ---- Inclusions at a glance --------------------------------------------------
  cursorY = ensureSpace(doc, cursorY, 46, { company, docLabel: DOC_LABEL, docNo: booking.bookingNo, accent });
  heading(doc, "Inclusions at a Glance", cursorY, { color: accent });
  cursorY += 8;

  if (options) {
    const items: Array<{ label: string; included?: boolean; note?: string }> = [
      { label: `Transport Mode: ${options.transportMode ? capitalize(options.transportMode) : "-"}` },
      { label: `Room Category: ${options.roomCategory ? capitalize(options.roomCategory) : "-"}` },
      {
        label: "Food Included",
        included: options.foodIncluded,
        note: options.foodIncluded && options.dietType ? DIET_LABELS[options.dietType] : undefined,
      },
      { label: "Baggage Included", included: options.baggageIncluded, note: options.baggageNotes },
      { label: "Local Transport Included", included: options.localTransportIncluded },
      { label: "Sightseeing Included", included: options.sightseeingIncluded },
      { label: "Travel Insurance Included", included: options.insuranceIncluded },
    ];

    const colWidth = g.contentWidth / 2;
    const perColumn = Math.ceil(items.length / 2);
    const itemRowHeight = 7;
    items.forEach((item, index) => {
      const col = index < perColumn ? 0 : 1;
      const row = index % perColumn;
      const x = g.left + col * colWidth;
      const y = cursorY + row * itemRowHeight;
      if (item.included === undefined) {
        // A plain value line (transport mode / room category) — no check/cross.
        text(doc, item.label, x + 5, y, { size: 9, color: INK_RGB });
      } else {
        if (item.included) drawCheck(doc, x, y - 2.6);
        else drawCross(doc, x, y - 2.6);
        const suffix = item.note ? ` - ${item.note}` : "";
        text(doc, `${item.label}${suffix}`, x + 5, y, { size: 9, color: INK_RGB });
      }
    });
    cursorY += perColumn * itemRowHeight + 4;
  } else {
    text(doc, "Inclusions have not been configured for this booking.", g.left, cursorY, {
      size: 9,
      color: MUTED_RGB,
      italic: true,
    });
    cursorY += 9;
  }

  // ---- Emergency contact --------------------------------------------------------
  cursorY = ensureSpace(doc, cursorY, 24, { company, docLabel: DOC_LABEL, docNo: booking.bookingNo, accent });
  heading(doc, "Emergency Contact", cursorY, { color: accent });
  cursorY += 7;

  const boxTop = cursorY - 5;
  const boxHeight = 14;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.3);
  doc.rect(g.left, boxTop, g.contentWidth, boxHeight);

  if (emergencyContact?.name || emergencyContact?.phone) {
    text(doc, emergencyContact.name ?? "Trip Coordinator", g.left + 5, boxTop + 6, { size: 10, bold: true });
    text(doc, formatPhone(emergencyContact.phone), g.left + 5, boxTop + 11, { size: 9.5, color: MUTED_RGB });
  } else {
    text(doc, `For any assistance during your trip, please contact ${company.name}.`, g.left + 5, boxTop + 6, {
      size: 9.5,
    });
    text(doc, company.phone ? formatPhone(company.phone) : "Contact details available with your travel desk.", g.left + 5, boxTop + 11, {
      size: 9.5,
      color: MUTED_RGB,
    });
  }

  finalizeFooters(doc, company, `${company.name} - Trip Itinerary - ${booking.bookingNo}`);
  return doc;
}

/** Builds the itinerary PDF and triggers a browser download. */
export async function downloadItineraryPdf(input: ItineraryInput, filename?: string): Promise<void> {
  await ensurePdfReady();
  const doc = buildItineraryPdf(input);
  saveFilenameSafe(doc, filename ?? `Itinerary_${input.booking.bookingNo}`);
}
