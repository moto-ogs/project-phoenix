import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { mockServerSessionData } from "~/test/mocks/next-auth";
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

vi.mock("~/lib/api-helpers.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/api-helpers.server")>()),
  apiGet: mockApiGet,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  handleApiError: vi.fn(
    (await import("~/test/helpers/handle-api-error")).mockHandleApiError,
  ),
}));

const defaultSession = mockServerSessionData() as ExtendedSession;

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// The backend's rows as GET /api/me/navigation sends them: numbers for IDs,
// every field the contract requires.
const AT = "2026-09-01T08:00:00Z";
const SWITCHES = {
  parent_news_enabled: false,
  parent_invite_mode: "direct",
  timetable_day_start_time: "08:00",
  timetable_day_end_time: "16:00",
};

function navigation(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    message: "Navigation context retrieved successfully",
    data: {
      educational_groups: [],
      supervised_groups: [],
      current_staff: null,
      incomplete: false,
      unavailable_sections: [],
      school_switches: SWITCHES,
      ...overrides,
    },
  };
}

describe("GET /api/user-context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(defaultSession);
  });

  it("maps backend data into user context response", async () => {
    const groups = [
      {
        id: 1,
        created_at: AT,
        updated_at: AT,
        tenant_id: 3,
        name: "Group A",
        room_id: 10,
        room: { id: 10, created_at: AT, updated_at: AT, name: "Room 10" },
        via_substitution: true,
      },
    ];
    const supervised = [
      {
        id: 2,
        created_at: AT,
        updated_at: AT,
        tenant_id: 3,
        start_time: AT,
        last_activity: AT,
        timeout_minutes: 30,
        group_id: null,
        room_id: 11,
        room: {
          id: 11,
          tenant_id: 3,
          created_at: AT,
          updated_at: AT,
          name: "Room 11",
          is_system: false,
          is_open_room: false,
        },
      },
    ];
    const staff = {
      id: 5,
      created_at: AT,
      updated_at: AT,
      tenant_id: 3,
      person_id: 7,
      birthday_display_opt_out: false,
    };

    mockApiGet.mockResolvedValueOnce(
      navigation({
        educational_groups: groups,
        supervised_groups: supervised,
        current_staff: staff,
        incomplete: true,
        unavailable_sections: ["supervised_groups"],
      }),
    );

    const request = createMockRequest("/api/user-context");
    const response = await GET(request, createMockContext());

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith("/api/me/navigation", "test-token");

    const json = await parseJsonResponse<
      ApiResponse<{
        educationalGroups: Array<{
          id: string;
          name: string;
          roomId?: string;
          room?: { id: string; name: string };
          viaSubstitution?: boolean;
        }>;
        supervisedGroups: Array<{
          id: string;
          roomId?: string;
          room?: { id: string; name: string };
        }>;
        currentStaff: { id: string; personId: string } | null;
        educationalGroupIds: string[];
        educationalGroupRoomNames: string[];
        supervisedRoomNames: string[];
        incomplete: boolean;
        unavailableSections: string[];
      }>
    >(response);

    expect(json.success).toBe(true);
    expect(json.data.educationalGroups).toEqual([
      {
        id: "1",
        name: "Group A",
        roomId: "10",
        room: { id: "10", name: "Room 10" },
        viaSubstitution: true,
      },
    ]);
    expect(json.data.supervisedGroups).toEqual([
      {
        id: "2",
        roomId: "11",
        room: { id: "11", name: "Room 11" },
      },
    ]);
    expect(json.data.currentStaff).toEqual({ id: "5", personId: "7" });
    expect(json.data.educationalGroupIds).toEqual(["1"]);
    expect(json.data.educationalGroupRoomNames).toEqual(["Room 10"]);
    expect(json.data.supervisedRoomNames).toEqual(["Room 11"]);
    expect(json.data.incomplete).toBe(true);
    expect(json.data.unavailableSections).toEqual(["supervised_groups"]);
  });

  it("maps a null supervised group list to an empty response list", async () => {
    mockApiGet.mockResolvedValueOnce(navigation({ supervised_groups: null }));

    const response = await GET(
      createMockRequest("/api/user-context"),
      createMockContext(),
    );
    const json =
      await parseJsonResponse<ApiResponse<{ supervisedGroups: unknown[] }>>(
        response,
      );

    expect(response.status).toBe(200);
    expect(json.data.supervisedGroups).toEqual([]);
  });

  it("maps the school switches", async () => {
    mockApiGet.mockResolvedValueOnce(navigation());

    const response = await GET(
      createMockRequest("/api/user-context"),
      createMockContext(),
    );
    const json =
      await parseJsonResponse<ApiResponse<{ schoolSwitches: unknown }>>(
        response,
      );

    expect(response.status).toBe(200);
    expect(json.data.schoolSwitches).toEqual({
      parentNewsEnabled: false,
      parentInviteMode: "direct",
      timetableDayStartTime: "08:00",
      timetableDayEndTime: "16:00",
    });
  });

  it("answers 502 when the backend breaks the contract", async () => {
    const { school_switches: _missing, ...withoutSwitches } =
      navigation().data;
    mockApiGet.mockResolvedValueOnce({
      ...navigation(),
      data: withoutSwitches,
    });

    const response = await GET(
      createMockRequest("/api/user-context"),
      createMockContext(),
    );

    expect(response.status).toBe(502);
  });

  it("surfaces an aggregate failure instead of returning partial empty data", async () => {
    mockApiGet.mockRejectedValueOnce(new ApiResponseError(500, "failed"));

    const request = createMockRequest("/api/user-context");
    const response = await GET(request, createMockContext());

    expect(response.status).toBe(500);
  });
});
