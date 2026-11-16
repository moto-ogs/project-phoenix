import { describe, expect, it } from "vitest";

import {
  canReinstateInstance,
  canCompleteInstance,
  canStartPlannedInstance,
  completeAvailableClock,
  isPlannedStartExpired,
} from "./timetable-lifecycle";

const now = new Date("2026-05-10T13:50:00+02:00");

describe("timetable lifecycle clock", () => {
  it("unlocks start after startAvailableAt and locks it after plan end", () => {
    const instance = {
      canStart: false,
      startAvailableAt: "2026-05-10T13:45:00+02:00",
      startExpiresAt: "2026-05-10T15:00:00+02:00",
    };
    expect(canStartPlannedInstance(instance, now)).toBe(true);
    expect(
      canStartPlannedInstance(instance, new Date("2026-05-10T15:00:00+02:00")),
    ).toBe(false);
  });

  it("treats a block as expired once the planned end is reached", () => {
    expect(
      isPlannedStartExpired(
        "2026-05-10T15:00:00+02:00",
        new Date("2026-05-10T15:00:00+02:00"),
      ),
    ).toBe(true);
    expect(
      isPlannedStartExpired(
        "2026-05-10T15:00:00+02:00",
        new Date("2026-05-10T14:59:00+02:00"),
      ),
    ).toBe(false);
  });

  it("keeps start available when the payload already allows it", () => {
    expect(
      canStartPlannedInstance(
        { canStart: true, startExpiresAt: "not-a-date" },
        now,
      ),
    ).toBe(true);
    expect(canStartPlannedInstance({ canStart: false }, now)).toBe(false);
    expect(isPlannedStartExpired(undefined, now)).toBe(false);
  });

  it("unlocks complete when completeAvailableAt is reached", () => {
    expect(canCompleteInstance(false, "2026-05-10T14:30:00+02:00", now)).toBe(
      false,
    );
    expect(canCompleteInstance(false, "2026-05-10T13:45:00+02:00", now)).toBe(
      true,
    );
    expect(canCompleteInstance(true, "", now)).toBe(true);
  });
});

describe("completeAvailableClock", () => {
  // #3809: with a lead before the planned end, "Beenden ab" names the earlier
  // time the backend announces, not the planned end.
  it("names the Berlin time from which a block can be completed", () => {
    expect(completeAvailableClock("2026-10-02T13:45:00Z", "16:00")).toBe(
      "15:45",
    );
  });

  it("falls back to the planned end without an announced time", () => {
    expect(completeAvailableClock("", "16:00")).toBe("16:00");
    expect(completeAvailableClock(undefined, "16:00")).toBe("16:00");
    expect(completeAvailableClock("kaputt", "16:00")).toBe("16:00");
  });
});

describe("canReinstateInstance", () => {
  const block = {
    status: "cancelled",
    date: "2026-09-09",
    startTime: "14:00",
    endTime: "15:00",
  };

  it("allows a cancelled block until its end", () => {
    expect(canReinstateInstance(block, new Date("2026-09-09T12:59:00Z"))).toBe(
      true,
    );
    expect(canReinstateInstance(block, new Date("2026-09-09T13:00:00Z"))).toBe(
      false,
    );
  });

  it("refuses blocks that are not cancelled", () => {
    expect(
      canReinstateInstance(
        { ...block, status: "planned" },
        new Date("2026-09-09T10:00:00Z"),
      ),
    ).toBe(false);
  });

  it("falls back to the end of the day without a later end", () => {
    const open = { ...block, endTime: "00:00" };
    expect(canReinstateInstance(open, new Date("2026-09-09T21:00:00Z"))).toBe(
      true,
    );
    expect(canReinstateInstance(open, new Date("2026-09-09T22:00:00Z"))).toBe(
      false,
    );
  });
});
