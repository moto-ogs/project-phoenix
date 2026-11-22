import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as catererSchoolsContract from "./contract/caterer-schools.generated";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("./api-helpers", () => ({ authFetch: mockAuthFetch }));

import { fetchCatererOrders } from "./caterer-api";

function orders(
  overrides: Partial<catererSchoolsContract.SchoolOrdersResponse> = {},
): catererSchoolsContract.SchoolOrdersResponse {
  return {
    school: { id: "4", name: "Schule am Berg" },
    delivery_address: "Bergstraße 1",
    format_version: 1,
    rhythm: "daily",
    detail: "by_class",
    days: [],
    ...overrides,
  };
}

describe("fetchCatererOrders", () => {
  beforeEach(() => mockAuthFetch.mockReset());

  it("leaves values this build does not know undefined and empty lists empty", async () => {
    mockAuthFetch.mockResolvedValueOnce({
      data: orders({
        rhythm: "monthly",
        detail: "by_group",
        days: [
          {
            date: "2026-09-09",
            closed: false,
            deadline: "2026-09-08T10:00:00Z",
            status: "paused",
            total: 0,
            classes: null,
            children: null,
            changes: null,
          },
        ],
      }),
    });

    const result = await fetchCatererOrders("4", "2026-09-07", "2026-09-11");

    expect(result.rhythm).toBeUndefined();
    expect(result.detail).toBeUndefined();
    expect(result.days[0]).toMatchObject({
      status: undefined,
      classes: [],
      children: [],
      changes: [],
    });
  });
});
