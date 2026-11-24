import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { fetchHomeLayout } from "./home-layout-api";

describe("fetchHomeLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the tenant route wrapper payload", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            blocks: [{ key: "section.day_changes", span: 4, col: 0, row: 0 }],
            overrides: { "section.birthdays": false },
            policies: { "tile.students_present": "required" },
            can_manage_policies: true,
            policies_version: "v-stored",
          },
        }),
    } as Response);

    await expect(fetchHomeLayout()).resolves.toEqual({
      blocks: [{ key: "section.day_changes", span: 4, col: 0, row: 0 }],
      overrides: { "section.birthdays": false },
      policies: { "tile.students_present": "required" },
      canManagePolicies: true,
      policiesVersion: "v-stored",
    });
  });

  it("uses the recommended layout only when access is unavailable", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
    } as Response);

    await expect(fetchHomeLayout()).resolves.toEqual({
      blocks: [],
      overrides: {},
      policies: {},
      canManagePolicies: false,
      policiesVersion: "",
    });
  });

  it("throws network failures so SWR can retry the read", async () => {
    fetchMock.mockRejectedValue(new Error("network unavailable"));

    await expect(fetchHomeLayout()).rejects.toThrow("network unavailable");
  });

  it("throws unexpected HTTP failures so SWR can retry the read", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(fetchHomeLayout()).rejects.toMatchObject({ status: 500 });
  });
});
