// Temporary (#7563): tests of the staff record route file that serves bundles
// built before #7563. The mapping of the record is tested at the client
// mappers (`lib/staff-api.test.ts`, `lib/teacher-helpers.test.ts`); DELETE
// goes to the catalog proxy. Delete this file with the route.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PUT } from "./route";
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

const { mockAuth, mockApiGet, mockApiPut } = vi.hoisted(() => ({
  mockAuth: vi.fn<() => Promise<ExtendedSession | null>>(),
  mockApiGet: vi.fn(),
  mockApiPut: vi.fn(),
}));

vi.mock("~/server/auth", async () =>
  (await import("~/test/portal-binding")).mockPortalModule("tenant", {
    auth: mockAuth,
  }),
);

vi.mock("~/lib/api-helpers.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/api-helpers.server")>()),
  apiGet: mockApiGet,
  apiPut: mockApiPut,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(defaultSession);
});

describe("GET /api/staff/[id] (temporary)", () => {
  it("answers the contract record with the flat fields older bundles read", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: backendStaffRecord({ ended_on: "2026-07-31" }),
    });

    const response = await GET(
      createMockRequest("/api/staff/7"),
      createMockContext({ id: "7" }),
    );

    expect(mockApiGet).toHaveBeenCalledWith("/api/staff/7", "test-token");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: unknown };
    expect(json.data).toEqual(
      expect.objectContaining({
        ...legacyStaffFields,
        started_on: "2024-09-02",
        ended_on: "2026-07-31",
        teacher_id: "5",
      }),
    );
  });
});

describe("PUT /api/staff/[id] (temporary)", () => {
  it("forwards the body as sent and answers the record with the flat fields", async () => {
    mockApiPut.mockResolvedValueOnce({
      status: "success",
      data: backendStaffRecord(),
    });
    const body = { person_id: "10", staff_notes: " geändert " };

    const response = await PUT(
      createMockRequest("/api/staff/7", { method: "PUT", body }),
      createMockContext({ id: "7" }),
    );

    expect(response.status).toBe(200);
    expect(mockApiPut).toHaveBeenCalledWith("/api/staff/7", "test-token", body);
    const json = (await response.json()) as { data: unknown };
    expect(json.data).toEqual(expect.objectContaining(legacyStaffFields));
  });
});
