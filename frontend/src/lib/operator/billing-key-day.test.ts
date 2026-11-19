import { describe, expect, it } from "vitest";
import {
  billingMonthName,
  keyDayPassedThisMonth,
  nextBillingKeyDate,
} from "./billing-key-day";

describe("nextBillingKeyDate (#7301)", () => {
  it("names this month's key date while the day is still ahead", () => {
    expect(nextBillingKeyDate(20, "2026-11-10")).toBe("2026-11-20");
  });

  it("moves to next month once the day is reached, across the year", () => {
    expect(nextBillingKeyDate(10, "2026-11-10")).toBe("2026-12-10");
    expect(nextBillingKeyDate(5, "2026-12-18")).toBe("2027-01-05");
  });
});

describe("keyDayPassedThisMonth", () => {
  it("says a day today or before is already reached", () => {
    expect(keyDayPassedThisMonth(10, "2026-11-10")).toBe(true);
    expect(keyDayPassedThisMonth(5, "2026-11-10")).toBe(true);
    expect(keyDayPassedThisMonth(11, "2026-11-10")).toBe(false);
  });
});

describe("billingMonthName", () => {
  it("writes the German month and year", () => {
    expect(billingMonthName("2026-03-01")).toBe("März 2026");
  });
});
