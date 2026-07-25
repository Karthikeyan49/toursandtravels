import { describe, expect, it } from "vitest";
import { buildQuery, ApiError } from "@/lib/api/client";
import { formatDateRange, formatMoney, formatPax, nightsBetween } from "@/lib/format";
import { findSectionByPath, NAVIGATION } from "@/lib/navigation";
import { statusMeta } from "@/components/StatusBadge";

/**
 * Harness check plus a guard on the four contracts every page depends on.
 * If any of these break, dozens of pages break silently.
 */

describe("buildQuery", () => {
  it("drops empty, null and undefined values", () => {
    expect(buildQuery({ page: 1, status: "", q: undefined, archived: null, sort: "date" })).toBe(
      "?page=1&sort=date",
    );
  });

  it("returns an empty string when nothing survives", () => {
    expect(buildQuery({ q: "", status: undefined })).toBe("");
  });

  it("keeps false, which is a real filter value", () => {
    expect(buildQuery({ active: false })).toBe("?active=false");
  });
});

describe("ApiError", () => {
  it("survives instanceof and exposes the 422 field map", () => {
    const error = new ApiError("Validation failed", 422, { email: ["Email is required"] });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isValidation).toBe(true);
    expect(error.fieldError("email")).toBe("Email is required");
  });
});

describe("format", () => {
  it("formats money with Indian grouping", () => {
    expect(formatMoney(125000)).toBe("₹1,25,000.00");
  });

  it("collapses a same-month date range", () => {
    expect(formatDateRange("2026-08-12", "2026-08-18")).toBe("12 – 18 Aug 2026");
  });

  it("counts nights, not days", () => {
    expect(nightsBetween("2026-08-12", "2026-08-15")).toBe(3);
  });

  it("omits zero pax categories", () => {
    expect(formatPax(2, 0, 1)).toBe("2A · 1I");
  });
});

describe("navigation", () => {
  it("resolves detail routes to their section", () => {
    expect(findSectionByPath("/bookings/42")?.label).toBe("Sales");
    expect(findSectionByPath("/settings/users")?.label).toBe("Settings");
  });

  it("does not let the dashboard swallow every route", () => {
    expect(findSectionByPath("/")?.label).toBe("Overview");
    expect(findSectionByPath("/invoices")?.label).toBe("Finance");
  });

  it("has unique section labels, which key the persisted active module", () => {
    const labels = NAVIGATION.map((section) => section.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("statusMeta", () => {
  it("maps known statuses to a token and a readable label", () => {
    expect(statusMeta("in_progress")).toEqual({ token: "in-progress", label: "In progress" });
  });

  it("renders an unknown backend enum instead of blanking the cell", () => {
    expect(statusMeta("awaiting_visa")).toEqual({ token: "draft", label: "Awaiting visa" });
  });
});
