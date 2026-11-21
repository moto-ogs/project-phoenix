import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionFetch = vi.hoisted(() => vi.fn());
vi.mock("~/lib/session-cache", () => ({ sessionFetch }));

import { fetchGroupLeaderCandidates } from "~/lib/staff-role-api";

describe("fetchGroupLeaderCandidates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps the narrow group-leader candidate response", async () => {
    sessionFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "7", teacher_id: "9", full_name: "Toni Test" }],
      }),
    });

    await expect(fetchGroupLeaderCandidates()).resolves.toEqual([
      { id: "7", teacherId: "9", fullName: "Toni Test" },
    ]);
    expect(sessionFetch).toHaveBeenCalledWith("/api/staff/by-role?role=user", {
      method: "GET",
    });
  });

  // The contract allows null: Go writes an empty result of several roles as
  // null. A malformed answer never arrives; the catalog proxy refuses it (502).
  it("reads a null list as no candidates", async () => {
    sessionFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null }),
    });

    await expect(fetchGroupLeaderCandidates()).resolves.toEqual([]);
  });
});
