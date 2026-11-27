import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The session boundary below runs the real SWR cleanup.
vi.unmock("swr");

import { ApiError } from "~/lib/api-error";
import { resetSWRScope } from "~/lib/swr/scope";
import { testClockDay } from "~/test/clock-instant";

import {
  _resetCheckInLockForTests,
  noteCheckInRefusal,
  useCheckInOpensAt,
} from "./check-in-lock";

const tooEarly = (opensAt: unknown) =>
  new ApiError("planned start not reached", 422, {
    code: "iot.planned_start_not_reached",
    details: { planned_start_time: opensAt, current_time: "07:10" },
  });

afterEach(() => _resetCheckInLockForTests());

describe("check-in lock (Einstempeln erst kurz vor Schichtbeginn)", () => {
  it("is open until the server refuses a check-in", () => {
    const { result } = renderHook(() =>
      useCheckInOpensAt(testClockDay(), "07:10"),
    );
    expect(result.current).toBeNull();
  });

  it("stays locked until the time the refusal names, then opens", () => {
    const today = testClockDay();
    const { result, rerender } = renderHook(
      ({ clock }) => useCheckInOpensAt(today, clock),
      { initialProps: { clock: "07:10" } },
    );
    act(() => noteCheckInRefusal(tooEarly("07:55"), today));
    expect(result.current).toBe("07:55");
    rerender({ clock: "07:54" });
    expect(result.current).toBe("07:55");
    rerender({ clock: "07:55" });
    expect(result.current).toBeNull();
  });

  it("keeps the lock while the clock is not known yet", () => {
    const today = testClockDay();
    noteCheckInRefusal(tooEarly("07:55"), today);
    const { result } = renderHook(() => useCheckInOpensAt(today, ""));
    expect(result.current).toBe("07:55");
  });

  it("applies only to the day of the refusal", () => {
    noteCheckInRefusal(tooEarly("07:55"), testClockDay(-1));
    const { result } = renderHook(() =>
      useCheckInOpensAt(testClockDay(), "07:10"),
    );
    expect(result.current).toBeNull();
  });

  it("ignores other refusals and malformed times", () => {
    const today = testClockDay();
    noteCheckInRefusal(
      new ApiError("reason", 422, { code: "iot.deviation_reason_required" }),
      today,
    );
    noteCheckInRefusal(new Error("network"), today);
    noteCheckInRefusal(tooEarly(undefined), today);
    noteCheckInRefusal(tooEarly("7:55 Uhr"), today);
    const { result } = renderHook(() => useCheckInOpensAt(today, "07:10"));
    expect(result.current).toBeNull();
  });

  it("is dropped at a session boundary", () => {
    const today = testClockDay();
    const { result } = renderHook(() => useCheckInOpensAt(today, "07:10"));
    act(() => noteCheckInRefusal(tooEarly("07:55"), today));
    expect(result.current).toBe("07:55");
    act(() => resetSWRScope({ revalidate: false }));
    expect(result.current).toBeNull();
  });
});
