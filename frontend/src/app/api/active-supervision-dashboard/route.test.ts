/**
 * Temporary (#7563): the route older app bundles still call. One backend
 * call, group_id forwarding and error propagation; the mapping and its
 * tests moved to the client (supervision-dashboard-wire.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { mockServerSessionData } from "~/test/mocks/next-auth";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { buildSupervisionDashboardWire } from "~/test/fixtures/supervision-dashboard";
import {
  type ExtendedSession,
  createMockContext,
  createMockRequest,
} from "~/test/route-test-helpers";

const { mockAuth, mockApiGet } = vi.hoisted(() => ({
  mockAuth: vi.fn<() => Promise<ExtendedSession | null>>(),
  mockApiGet: vi.fn(),
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
  }),
);

vi.mock("~/lib/api-helpers.server", async () => {
  const { mockHandleApiError } =
    await import("~/test/helpers/handle-api-error");
  return {
    apiGet: mockApiGet,
    apiPost: vi.fn(),
    apiPut: vi.fn(),
    apiDelete: vi.fn(),
    handleApiError: vi.fn(mockHandleApiError),
  };
});

const defaultSession = mockServerSessionData() as ExtendedSession;

const emptyWire = buildSupervisionDashboardWire();

describe("GET /api/active-supervision-dashboard", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockAuth.mockReset();
    mockAuth.mockResolvedValue(defaultSession);
  });

  it("issues exactly one backend request without group_id", async () => {
    mockApiGet.mockResolvedValueOnce({ status: "success", data: emptyWire });

    const response = await GET(
      createMockRequest("/api/active-supervision-dashboard"),
      createMockContext(),
    );

    expect(response.status).toBe(200);
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith(
      "/api/active/supervision-dashboard",
      expect.any(String),
    );
  });

  it("forwards a valid group_id and drops an invalid one", async () => {
    mockApiGet.mockResolvedValue({ status: "success", data: emptyWire });

    await GET(
      createMockRequest("/api/active-supervision-dashboard?group_id=42"),
      createMockContext(),
    );
    expect(mockApiGet).toHaveBeenLastCalledWith(
      "/api/active/supervision-dashboard?group_id=42",
      expect.any(String),
    );

    await GET(
      createMockRequest("/api/active-supervision-dashboard?group_id=abc"),
      createMockContext(),
    );
    expect(mockApiGet).toHaveBeenLastCalledWith(
      "/api/active/supervision-dashboard",
      expect.any(String),
    );
  });

  it("propagates backend errors instead of degrading to empty sections", async () => {
    mockApiGet.mockRejectedValueOnce(new ApiResponseError(403, "forbidden"));

    const response = await GET(
      createMockRequest("/api/active-supervision-dashboard?group_id=42"),
      createMockContext(),
    );

    expect(response.status).toBe(403);
  });
});
