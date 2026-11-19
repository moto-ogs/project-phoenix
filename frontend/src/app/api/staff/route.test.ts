// Temporary (#7563): tests of the staff route file that serves bundles built
// before #7563. The mapping of the record is tested at the client mapper
// (`lib/staff-api.test.ts`, `lib/teacher-helpers.test.ts`). Delete this file
// with the route.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import {
  type ExtendedSession,
  createMockContext,
  createMockRequest,
  defaultSession,
} from "~/test/route-test-helpers";
import {
  backendStaffRecord,
  legacyStaffFields,
} from "~/test/staff-record-wire";
import { ApiResponseError } from "~/lib/api-response-error.server";

const { mockAuth, mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockAuth: vi.fn<() => Promise<ExtendedSession | null>>(),
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
  }),
);

vi.mock("~/lib/api-helpers.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/api-helpers.server")>()),
  apiGet: mockApiGet,
  apiPost: mockApiPost,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(defaultSession);
});

describe("GET /api/staff (temporary)", () => {
  it("answers the contract record with the flat fields older bundles read", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: [backendStaffRecord()],
    });

    const response = await GET(
      createMockRequest("/api/staff"),
      createMockContext(),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: unknown[] };
    expect(json.data).toEqual([
      expect.objectContaining({
        ...legacyStaffFields,
        id: "7",
        person_id: "10",
        teacher_id: "5",
        person: expect.objectContaining({ id: "10", account_id: "50" }),
      }),
    ]);
  });

  it("forwards only the filters the contract names", async () => {
    mockApiGet.mockResolvedValueOnce({ status: "success", data: [] });

    await GET(
      createMockRequest(
        "/api/staff?strict=1&search=x&first_name=Jo&teachers_only=true",
      ),
      createMockContext(),
    );

    expect(mockApiGet).toHaveBeenCalledWith(
      "/api/staff?first_name=Jo&teachers_only=true",
      "test-token",
    );
  });

  it("answers 502 when the backend leaves the contract", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: [{ id: "7" }],
    });

    const response = await GET(
      createMockRequest("/api/staff"),
      createMockContext(),
    );

    expect(response.status).toBe(502);
  });

  it("keeps a backend error's status", async () => {
    mockApiGet.mockRejectedValueOnce(
      new ApiResponseError(
        403,
        JSON.stringify({ status: 403, code: "general.forbidden" }),
        { contentType: "application/problem+json" },
      ),
    );

    const response = await GET(
      createMockRequest("/api/staff"),
      createMockContext(),
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /api/staff (temporary)", () => {
  it("forwards the body as sent and answers the record with the flat fields", async () => {
    mockApiPost.mockResolvedValueOnce({
      status: "success",
      data: backendStaffRecord(),
    });
    const body = { person_id: "9007199254740993", staff_notes: " neu " };

    const response = await POST(
      createMockRequest("/api/staff", { method: "POST", body }),
      createMockContext(),
    );

    expect(response.status).toBe(200);
    expect(mockApiPost).toHaveBeenCalledWith("/api/staff", "test-token", body);
    const json = (await response.json()) as { data: unknown };
    expect(json.data).toEqual(
      expect.objectContaining({ ...legacyStaffFields, person_id: "10" }),
    );
  });
});
