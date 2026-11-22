import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { fetchGroupLeaderCandidates } from "~/lib/staff-role-api";

describe("fetchGroupLeaderCandidates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps the narrow group-leader candidate response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "7", teacher_id: "9", full_name: "Toni Test" }],
      }),
    });

    await expect(fetchGroupLeaderCandidates()).resolves.toEqual([
      { id: "7", teacherId: "9", fullName: "Toni Test" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/staff/by-role?role=user", {
      method: "GET",
    });
  });

  // The contract allows null: Go writes an empty result of several roles as
  // null. A malformed answer never arrives; the catalog proxy refuses it (502).
  it("reads a null list as no candidates", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    });

    await expect(fetchGroupLeaderCandidates()).resolves.toEqual([]);
  });
});
