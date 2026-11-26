import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  closedRoomsOn,
  roomClosurePeriod,
  type RoomClosure,
} from "./room-closures-api";

const closure = (
  id: string,
  roomId: string,
  startDate: string,
  endDate: string,
): RoomClosure => ({ id, roomId, startDate, endDate, reason: "Reinigung" });

describe("room closures (#7653)", () => {
  it("closes a room on every day of its period, both ends included", () => {
    const closures = [closure("1", "10", "2026-11-30", "2026-12-02")];
    expect(closedRoomsOn(closures, "2026-11-29").has("10")).toBe(false);
    expect(closedRoomsOn(closures, "2026-11-30").get("10")?.id).toBe("1");
    expect(closedRoomsOn(closures, "2026-12-02").get("10")?.id).toBe("1");
    expect(closedRoomsOn(closures, "2026-12-03").has("10")).toBe(false);
  });

  it("names the closure ending last when two overlap", () => {
    const closures = [
      closure("1", "10", "2026-11-30", "2026-12-01"),
      closure("2", "10", "2026-11-30", "2026-12-05"),
    ];
    expect(closedRoomsOn(closures, "2026-11-30").get("10")?.id).toBe("2");
  });

  it("writes one day or a period in German", () => {
    expect(
      roomClosurePeriod(closure("1", "10", "2026-11-30", "2026-11-30")),
    ).toBe("30.11.2026");
    expect(
      roomClosurePeriod(closure("1", "10", "2026-11-30", "2026-12-02")),
    ).toBe("30.11.2026 bis 02.12.2026");
  });

  it("adds calendar days across a month and a clock change", () => {
    expect(addCalendarDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addCalendarDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
