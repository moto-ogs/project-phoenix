import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  type ExtendedSession,
  createMockContext,
  defaultSession,
} from "~/test/route-test-helpers";

const { mockAuth, mockApiPost } = vi.hoisted(() => ({
  mockAuth: vi.fn<() => Promise<ExtendedSession | null>>(),
  mockApiPost: vi.fn(),
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
  }),
);

vi.mock("~/lib/api-helpers.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/api-helpers.server")>()),
  apiPost: mockApiPost,
}));

function searchRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/search", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// Temporary (#7563): the legacy path of the temporary route file; the
// mapping's tests live with lib/school-search-wire.
describe("POST /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(defaultSession);
  });

  it("forwards a missing query as empty text for the backend to refuse", async () => {
    mockApiPost.mockResolvedValueOnce({
      data: { children: [], contacts: [], staff: [], rooms: [], groups: [] },
    });
    await POST(searchRequest({}), createMockContext());
    expect(mockApiPost).toHaveBeenCalledWith("/api/search", "test-token", {
      query: "",
    });
  });
});
