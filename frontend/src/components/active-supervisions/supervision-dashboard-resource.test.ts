/**
 * The dashboard fetch (#2096, #7563): one request through the catalog proxy,
 * group_id forwarding, and error propagation (no swallowed sub-loads).
 * Moved here from the tests of the former BFF route.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiError from "~/lib/api-error";
import { buildSupervisionDashboardWire } from "~/test/fixtures/supervision-dashboard";
import { fetchSupervisionDashboard } from "./supervision-dashboard-resource";

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ok = () => answer(200, { data: buildSupervisionDashboardWire() });

describe("fetchSupervisionDashboard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("issues exactly one request without group_id", async () => {
    const transport = vi
      .spyOn(apiError, "transportFetch")
      .mockResolvedValueOnce(ok());

    const data = await fetchSupervisionDashboard(null);

    expect(transport).toHaveBeenCalledExactlyOnceWith(
      "/api/active/supervision-dashboard",
      { headers: { "Content-Type": "application/json" } },
    );
    expect(data.businessDay).toBe("2026-08-31");
  });

  it("forwards a valid group_id and drops an invalid one", async () => {
    const transport = vi
      .spyOn(apiError, "transportFetch")
      .mockImplementation(() => Promise.resolve(ok()));

    await fetchSupervisionDashboard("42");
    expect(transport).toHaveBeenLastCalledWith(
      "/api/active/supervision-dashboard?group_id=42",
      expect.anything(),
    );

    await fetchSupervisionDashboard("abc");
    expect(transport).toHaveBeenLastCalledWith(
      "/api/active/supervision-dashboard",
      expect.anything(),
    );
  });

  it("propagates backend errors instead of degrading to empty sections", async () => {
    vi.spyOn(apiError, "transportFetch").mockImplementation(() =>
      Promise.resolve(answer(403, { status: 403, code: "general.forbidden" })),
    );

    await expect(fetchSupervisionDashboard("42")).rejects.toMatchObject({
      status: 403,
    });
  });
});
