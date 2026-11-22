/**
 * The dashboard fetch (#2096, #7563): one request through the catalog proxy,
 * group_id forwarding, and error propagation (no swallowed sub-loads).
 * Moved here from the tests of the former BFF route.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSupervisionDashboardWire } from "~/test/fixtures/supervision-dashboard";
import { fetchSupervisionDashboard } from "./supervision-dashboard-resource";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ok = () => answer(200, { data: buildSupervisionDashboardWire() });

describe("fetchSupervisionDashboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(answers: () => Response) {
    const transport = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(answers()),
    );
    vi.stubGlobal("fetch", transport);
    return transport;
  }

  it("issues exactly one request without group_id", async () => {
    const transport = stubFetch(ok);

    const data = await fetchSupervisionDashboard(null);

    expect(transport).toHaveBeenCalledExactlyOnceWith(
      "/api/active/supervision-dashboard",
      expect.objectContaining({ method: "GET" }),
    );
    expect(data.businessDay).toBe("2026-08-31");
  });

  it("forwards a valid group_id and drops an invalid one", async () => {
    const transport = stubFetch(ok);

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
    const transport = stubFetch(() =>
      answer(403, { status: 403, code: "general.forbidden" }),
    );

    await expect(fetchSupervisionDashboard("42")).rejects.toMatchObject({
      status: 403,
    });
    // The stale selection is retried once without group_id, then fails.
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "/api/active/supervision-dashboard?group_id=42",
      "/api/active/supervision-dashboard",
    ]);
  });
});
