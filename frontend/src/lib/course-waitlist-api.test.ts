import { describe, expect, it, vi } from "vitest";

const { mockBffJson } = vi.hoisted(() => ({ mockBffJson: vi.fn() }));
vi.mock("~/lib/bff-fetch", () => ({ bffJson: mockBffJson }));

import { fetchCourseWaitlists } from "./course-waitlist-api";

describe("fetchCourseWaitlists", () => {
  it("asks for the contract's lists and maps them once", async () => {
    mockBffJson.mockResolvedValueOnce([
      {
        activity_group_id: "7",
        name: "Theater",
        participant_limit: 12,
        participants: 12,
        free_slots: 0,
        slot_free_for_next: false,
        entries: null,
      },
    ]);

    const waitlists = await fetchCourseWaitlists("7");

    expect(mockBffJson).toHaveBeenCalledWith(
      "/api/students/offering-change-requests/course-waitlists?activity_group_id=7",
    );
    expect(waitlists).toEqual([
      {
        activityGroupId: "7",
        name: "Theater",
        participantLimit: 12,
        participants: 12,
        freeSlots: 0,
        slotFreeForNext: false,
        entries: [],
      },
    ]);
  });

  it("reads a missing list as no waiting lists", async () => {
    mockBffJson.mockResolvedValueOnce(null);

    await expect(fetchCourseWaitlists()).resolves.toEqual([]);
  });
});
