import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { suppressConsole } from "~/test/helpers/console";

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }));

vi.mock("~/lib/api-helpers.server", () => ({ apiGet: mockApiGet }));
// Session, renewal and the response envelope are the wrapper's, tested in
// lib/parent/route-wrapper.test.ts.
vi.mock("~/lib/parent/route-wrapper.server", () => ({
  createParentGetHandler: (handler: unknown) => handler,
}));

import { GET } from "./route";

const read = GET as unknown as (
  request: { signal: AbortSignal },
  token: string,
) => Promise<unknown>;
const request = { signal: new AbortController().signal };
const phase = {
  school_id: "3",
  school_name: "Schule am Berg",
  school_slug: "berg",
  school_subdomain: "berg",
  phase_id: "12",
  phase_name: "Schuljahr 2026/27",
  phase_kind: "school_year",
  service_start_date: "2026-08-01",
  service_end_date: "2027-07-31",
  already_linked: false,
  audience: "open",
};

describe("GET /api/parent/me/enrollable-schools", () => {
  suppressConsole("error");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the registered backend route and answers its decoded list", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: [{ ...phase, internal_note: "not in the contract" }],
    });
    await expect(read(request, "parent-token")).resolves.toEqual([phase]);
    expect(mockApiGet).toHaveBeenCalledWith(
      "/parent/me/enrollable-schools",
      "parent-token",
      { signal: request.signal },
    );
  });

  it("answers 502 for a list outside the contract, never an empty list", async () => {
    mockApiGet.mockResolvedValueOnce({ status: "success", data: null });
    await expect(read(request, "parent-token")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("passes the backend's refusal on unchanged", async () => {
    const refusal = new ApiResponseError(401, "{}");
    mockApiGet.mockRejectedValueOnce(refusal);
    await expect(read(request, "parent-token")).rejects.toBe(refusal);
  });
});
