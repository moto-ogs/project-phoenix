import { describe, expect, it } from "vitest";

import {
  tagesplanAppStats,
  tagesplanAppTitle,
} from "~/components/timetable/tagesplan-app";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";

describe("tagesplanAppTitle", () => {
  it("nennt heute, morgen und gestern in Worten, ohne Datum", () => {
    expect(tagesplanAppTitle("2026-11-24", "2026-11-24")).toBe("Heute");
    expect(tagesplanAppTitle("2026-11-25", "2026-11-24")).toBe("Morgen");
    expect(tagesplanAppTitle("2026-11-23", "2026-11-24")).toBe("Gestern");
  });

  it("nennt andere Tage „Tagesplan“, auch über den Monatswechsel", () => {
    expect(tagesplanAppTitle("2026-12-01", "2026-11-24")).toBe("Tagesplan");
    expect(tagesplanAppTitle("2026-12-01", "2026-11-30")).toBe("Morgen");
  });
});

function block(
  overrides: Partial<PlannedTimetableInstance>,
): PlannedTimetableInstance {
  return {
    status: "planned",
    isAssigned: false,
    ...overrides,
  } as PlannedTimetableInstance;
}

describe("tagesplanAppStats", () => {
  it("zählt Blöcke, eigene und laufende", () => {
    const items = tagesplanAppStats(
      [
        block({ isAssigned: true, status: "active" }),
        block({}),
        block({ isAssigned: true }),
      ],
      true,
      null,
    );
    expect(items).toEqual([
      { value: 3, label: "Blöcke" },
      { value: 2, label: "mit dir" },
      { value: 1, label: "läuft" },
    ]);
  });

  it("zeigt in der eingeschränkten Sicht den Hinweis statt der eigenen", () => {
    expect(
      tagesplanAppStats(
        [block({ isAssigned: true })],
        false,
        "Nur deine Einsätze",
      ),
    ).toEqual([{ value: 1, label: "Block" }, { label: "Nur deine Einsätze" }]);
  });

  it("bleibt ohne Blöcke leer", () => {
    expect(tagesplanAppStats([], true, null)).toEqual([]);
  });
});
