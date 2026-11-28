import { describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";

const fetchStudentPickupData = vi.fn();

vi.mock("~/lib/pickup-schedule-api", () => ({
  fetchStudentPickupData: (...args: unknown[]) =>
    fetchStudentPickupData(...args),
}));

import { upcomingPickupDaysOf } from "~/lib/pickup-withdrawal";

describe("upcomingPickupDaysOf", () => {
  it("surfaces a failed pickup-schedule lookup before the permission is saved", async () => {
    const failure = new ApiError("schedule unavailable", 503, {
      code: "general.unavailable",
    });
    fetchStudentPickupData.mockRejectedValueOnce(failure);

    await expect(upcomingPickupDaysOf("student-1", "guardian-1")).rejects.toBe(
      failure,
    );
  });
});
