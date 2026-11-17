import { describe, expect, it } from "vitest";
import type {
  BookingAccounts,
  CostCenter,
} from "~/lib/traeger-finance-exports-api";
import {
  costCenterError,
  costCenterOn,
  costCenterTimeline,
  effectiveHolidayCostCenter,
  effectiveRevenue,
  nextCostCenter,
  revenueAccountError,
} from "./booking-accounts-format";

const center = (id: string, validFrom: string, code: string): CostCenter => ({
  id,
  scope: "school",
  scopeId: "11",
  validFrom,
  code,
});

describe("cost centers", () => {
  const timeline = costCenterTimeline(
    [
      center("2", "2027-01-01", "K2"),
      center("1", "2026-09-01", "K1"),
      center("3", "2027-03-01", ""),
    ],
    "school",
    "11",
  );
  it("hold from their day until the next one", () => {
    expect(costCenterOn(timeline, "2026-08-31")).toBeNull();
    expect(costCenterOn(timeline, "2026-09-01")?.code).toBe("K1");
    expect(costCenterOn(timeline, "2026-12-31")?.code).toBe("K1");
    expect(costCenterOn(timeline, "2027-01-01")?.code).toBe("K2");
    expect(costCenterOn(timeline, "2027-03-01")?.code).toBe("");
    expect(nextCostCenter(timeline, "2026-10-01")?.code).toBe("K2");
    expect(nextCostCenter(timeline, "2027-03-01")).toBeNull();
  });
});

// The order the backend resolves when it issues a holiday invoice (#7357).
describe("the cost center of the holiday care of a school", () => {
  const of = (
    id: string,
    scope: CostCenter["scope"],
    scopeId: string,
    validFrom: string,
    code: string,
  ): CostCenter => ({ id, scope, scopeId, validFrom, code });
  const centers = [
    of("1", "school", "11", "2026-01-01", "5467"),
    of("2", "school_holiday", "11", "2026-11-04", "5469"),
    of("3", "school_holiday", "11", "2027-08-01", ""),
    of("4", "school", "12", "2026-01-01", "5567"),
    of("5", "holiday", "0", "2026-01-01", "FER"),
  ];
  it("is its own, else the school's, else the one of the Träger", () => {
    expect(effectiveHolidayCostCenter(centers, "11", "2026-11-04")).toEqual({
      code: "5469",
      source: "own",
      since: "2026-11-04",
    });
    expect(
      effectiveHolidayCostCenter(centers, "11", "2026-11-03"),
      "before its first day",
    ).toEqual({ code: "5467", source: "school", since: "" });
    expect(
      effectiveHolidayCostCenter(centers, "11", "2027-08-01"),
      "ended again",
    ).toEqual({ code: "5467", source: "school", since: "" });
    expect(effectiveHolidayCostCenter(centers, "12", "2026-11-04")).toEqual({
      code: "5567",
      source: "school",
      since: "",
    });
    expect(effectiveHolidayCostCenter(centers, "13", "2026-11-04")).toEqual({
      code: "FER",
      source: "fallback",
      since: "",
    });
    expect(
      effectiveHolidayCostCenter(centers.slice(0, 4), "13", "2026-11-04"),
    ).toEqual({ code: "", source: "missing", since: "" });
  });
});

describe("revenue accounts", () => {
  const page: BookingAccounts = {
    standardAccount: "4000",
    costCenterRequired: false,
    schools: [],
    offerings: [],
    revenueAccounts: [
      { scope: "care", scopeId: "0", account: "4400" },
      { scope: "offering", scopeId: "501", account: "4410" },
    ],
    costCenters: [],
  };
  it("fall back from the Angebot to the Leistung to the standard", () => {
    expect(effectiveRevenue(page, "offering", "501")).toEqual({
      account: "4410",
      source: "own",
    });
    expect(effectiveRevenue(page, "offering", "502")).toEqual({
      account: "4400",
      source: "service",
    });
    expect(effectiveRevenue(page, "meals")).toEqual({
      account: "4000",
      source: "standard",
    });
    expect(effectiveRevenue({ ...page, standardAccount: "" }, "meals")).toEqual(
      {
        account: "",
        source: "missing",
      },
    );
  });
});

// The cases of backend/testdata/finance-booking-accounts-cases.json that the
// page checks before it sends; the backend checks again.
describe("the rules of the values", () => {
  it.each([
    ["4400", null],
    [" 0085 ", null],
    ["", null],
    ["0000", "Nur Ziffern, nicht nur Nullen."],
    ["44-00", "Nur Ziffern, nicht nur Nullen."],
    ["123456789", "Höchstens 8 Ziffern."],
  ])("revenue account %j", (value, error) => {
    expect(revenueAccountError(value)).toBe(error);
  });
  it.each([
    ["GS Ispringen", null],
    ["KST_7", null],
    ["A".repeat(36), null],
    ["A".repeat(37), "Höchstens 36 Zeichen."],
    ["K-100", "Nur Buchstaben ohne Umlaute, Ziffern, Leerzeichen und _."],
    ["Öhringen", "Nur Buchstaben ohne Umlaute, Ziffern, Leerzeichen und _."],
  ])("cost center %j", (value, error) => {
    expect(costCenterError(value)).toBe(error);
  });
});
