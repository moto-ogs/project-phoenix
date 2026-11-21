import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getGroups: vi.fn() }));
vi.mock("~/lib/api", () => ({
  groupService: { getGroups: mocks.getGroups },
}));

import { groups } from "./groups";

describe("groups.optionsFetcher", () => {
  beforeEach(() => {
    mocks.getGroups.mockReset();
  });

  it("maps the school's groups to options sorted by name", async () => {
    mocks.getGroups.mockResolvedValue([
      { id: "2", name: "Zebras" },
      { id: "1", name: "Äpfel" },
      { id: "3", name: "Bären" },
    ]);

    await expect(groups.optionsFetcher()).resolves.toEqual([
      { value: "1", label: "Äpfel" },
      { value: "3", label: "Bären" },
      { value: "2", label: "Zebras" },
    ]);
  });

  // #2353: the shared cache entry must hold the failure, not an empty list.
  it("passes a failed read on instead of answering no groups", async () => {
    const failure = Object.assign(new Error("groups failed"), { status: 500 });
    mocks.getGroups.mockRejectedValue(failure);

    await expect(groups.optionsFetcher()).rejects.toBe(failure);
  });
});
