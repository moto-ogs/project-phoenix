import { describe, expect, it } from "vitest";

import { tagesplanAppTitle } from "~/components/timetable/tagesplan-app";

describe("tagesplanAppTitle", () => {
  it("nennt heute, morgen und gestern mit Wochentag und Datum", () => {
    expect(tagesplanAppTitle("2026-11-24", "2026-11-24")).toBe(
      "Heute, Di 24.11.",
    );
    expect(tagesplanAppTitle("2026-11-25", "2026-11-24")).toBe(
      "Morgen, Mi 25.11.",
    );
    expect(tagesplanAppTitle("2026-11-23", "2026-11-24")).toBe(
      "Gestern, Mo 23.11.",
    );
  });

  it("zeigt andere Tage nur mit Wochentag und Datum, auch über den Monatswechsel", () => {
    expect(tagesplanAppTitle("2026-12-01", "2026-11-24")).toBe("Di 01.12.");
    expect(tagesplanAppTitle("2026-12-01", "2026-11-30")).toBe(
      "Morgen, Di 01.12.",
    );
  });
});
