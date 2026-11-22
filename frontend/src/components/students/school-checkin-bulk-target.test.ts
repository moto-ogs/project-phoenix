import { describe, expect, it } from "vitest";

import {
  checkInBlockedReason,
  checkinBulkTarget,
  directModeHint,
  pullBlockedReason,
  pullCandidates,
} from "./school-checkin-bulk-target";

// What „Anmelden“ and „Holen“ can do with the marked children while a target
// is chosen: Anmelden places absent children only, Holen moves present ones.

const absent = { current_location: "Zuhause" };
const inTransit = { current_location: "Unterwegs" };
const inMensa = { current_location: "Anwesend - Mensa" };
const inYard = { current_location: "Schulhof" };

describe("checkinBulkTarget", () => {
  it("counts absent children and present children outside the target", () => {
    expect(
      checkinBulkTarget([absent, inTransit, inMensa, inYard], "Schulhof", true),
    ).toEqual({ roomName: "Schulhof", absentCount: 1, pullCount: 2 });
  });

  it("offers no pull without the right to move present children", () => {
    expect(
      checkinBulkTarget([inTransit], "Schulhof", false).pullCount,
    ).toBeUndefined();
  });

  it("leaves a child out that is already in the target room", () => {
    expect(pullCandidates([inMensa, inYard, absent], "Mensa")).toEqual([
      inYard,
    ]);
  });
});

describe("blocked reasons", () => {
  it("names Holen when only present children are marked", () => {
    const target = { roomName: "Schulhof", absentCount: 0, pullCount: 2 };
    expect(checkInBlockedReason(target, 2)).toBe(
      "Die ausgewählten Kinder sind schon angemeldet. Mit „Holen“ kommen sie in Schulhof.",
    );
    expect(pullBlockedReason(target, 2)).toBeUndefined();
  });

  it("points to the room page when the person may not pull", () => {
    expect(
      checkInBlockedReason({ roomName: "Schulhof", absentCount: 0 }, 1),
    ).toBe(
      "Die ausgewählten Kinder sind schon angemeldet. In Schulhof kommen sie über die Seite des Raums.",
    );
  });

  it("does not block a plain check-in or a selection with absent children", () => {
    expect(checkInBlockedReason(null, 3)).toBeUndefined();
    expect(
      checkInBlockedReason(
        { roomName: "Schulhof", absentCount: 1, pullCount: 0 },
        3,
      ),
    ).toBeUndefined();
  });

  it("says which children Holen needs", () => {
    expect(
      pullBlockedReason({ roomName: "Mensa", absentCount: 2, pullCount: 0 }, 2),
    ).toBe(
      "Wähle ein Kind aus, das schon angemeldet und noch nicht in Mensa ist.",
    );
  });
});

describe("directModeHint", () => {
  it("stays the plain line without a target", () => {
    expect(directModeHint(null)).toBe("Jeder Tipp meldet sofort an oder ab.");
  });

  it("names the way into the target for present children", () => {
    expect(
      directModeHint({ roomName: "Schulhof", absentCount: 0, pullCount: 0 }),
    ).toContain("holst du über „Mehrere“ in Schulhof");
    expect(directModeHint({ roomName: "Schulhof", absentCount: 0 })).toContain(
      "holst du auf der Seite des Raums in Schulhof",
    );
  });
});
