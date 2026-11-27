/**
 * Tests for Activities Configuration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  activitiesConfig,
  toActivityRequest,
  toActivityUpdateRequest,
} from "./activities.config";
import { mapActivityResponse, type Activity } from "@/lib/activity-helpers";
import { buildBackendActivity } from "~/test/fixtures/activities";

// Mock next-auth
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(() =>
    Promise.resolve({
      user: { id: "1" },
    }),
  ),
}));

// Mock global fetch
global.fetch = vi.fn();

// The session gate is session-cache's own concern.
vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

describe("activitiesConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a valid entity config", () => {
    expect(activitiesConfig).toBeDefined();
    expect(activitiesConfig.name).toEqual({
      singular: "Aktivität",
      plural: "Aktivitäten",
    });
  });

  it("has form sections configured", () => {
    expect(activitiesConfig.form.sections).toHaveLength(2);
    expect(activitiesConfig.form.sections[0]?.title).toBe("Grundinformationen");
    expect(activitiesConfig.form.sections[1]?.title).toBe("Betreuer");
  });

  it("has required form fields", () => {
    const fields = activitiesConfig.form.sections[0]?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("ag_category_id");
    expect(fieldNames).toContain("max_participant");
  });

  it("has supervisor field in Betreuer section", () => {
    const fields = activitiesConfig.form.sections[1]?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("supervisor_id");
  });

  it("has default max_participant value", () => {
    expect(activitiesConfig.form.defaultValues?.max_participant).toBe(20);
  });

  it("maps request data correctly", () => {
    const data: Partial<Activity> = {
      name: "Test Activity",
      max_participant: 25,
      ag_category_id: "3",
    };

    const mapped = toActivityRequest(data);
    expect(mapped).toEqual({
      name: "Test Activity",
      max_participants: 25,
      category_id: "3",
    });
  });

  it("maps request data with supervisor", () => {
    const data: Partial<Activity> = {
      name: "Test Activity",
      max_participant: 25,
      ag_category_id: "3",
      supervisor_id: "42",
    };

    const mapped = toActivityRequest(data);
    expect(mapped).toEqual({
      name: "Test Activity",
      max_participants: 25,
      category_id: "3",
      supervisor_ids: ["42"],
    });
  });

  it("keeps identifiers beyond 2^53 exact (#7806)", () => {
    const data: Partial<Activity> = {
      name: "Test Activity",
      max_participant: 25,
      ag_category_id: "9007199254740993",
      supervisor_id: "9007199254740995",
    };

    expect(toActivityRequest(data)).toMatchObject({
      category_id: "9007199254740993",
      supervisor_ids: ["9007199254740995"],
    });
  });

  // The database form shows name, limit, category and primary supervisor
  // only. Its save names nothing else, so the route keeps the opening, the
  // planned room and the schedules, and sends the version read (ADR 0311).
  it("saves only the shown fields against the version read", () => {
    const read = {
      name: "Fußball AG",
      max_participant: 12,
      ag_category_id: "3",
      is_open_ags: true,
      planned_room_id: "9",
      supervisor_id: "42",
      supervisors: [
        { id: "1", staff_id: "42", is_primary: true },
        { id: "2", staff_id: "43", is_primary: false },
      ],
      version: "v1",
    } as Partial<Activity>;

    expect(toActivityUpdateRequest(read)).toEqual({
      name: "Fußball AG",
      max_participants: 12,
      category_id: "3",
      expected_version: "v1",
    });
  });

  it("keeps the co-supervisors when the primary supervisor changes", () => {
    const edited = {
      name: "Fußball AG",
      max_participant: 12,
      ag_category_id: "3",
      supervisor_id: "44",
      supervisors: [
        { id: "1", staff_id: "42", is_primary: true },
        { id: "2", staff_id: "43", is_primary: false },
      ],
      version: "v1",
    } as Partial<Activity>;

    expect(toActivityUpdateRequest(edited).supervisor_ids).toEqual([
      "44",
      "43",
    ]);
    expect(
      toActivityUpdateRequest({ ...edited, supervisor_id: "" }).supervisor_ids,
    ).toEqual(["43"]);
  });

  it("maps an empty participant limit to null", () => {
    const data = {
      name: "Test Activity",
      max_participant: "",
      ag_category_id: "3",
    } as unknown as Partial<Activity>;

    const mapped = toActivityRequest(data);
    expect(mapped).toEqual({
      name: "Test Activity",
      max_participants: null,
      category_id: "3",
    });
  });

  it("maps the contract's activity once", async () => {
    const responseData = buildBackendActivity({
      id: "1",
      name: "Test Activity",
    });

    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({ data: responseData }),
    );

    const mapped = await activitiesConfig.api.get!("1");
    expect(mapped).toEqual(mapActivityResponse(responseData));
    expect(mapped.max_participant).toBe(20);
    expect(mapped.is_open_ags).toBe(true);
  });

  // An empty list would look like a school without categories or
  // supervisors; the form shows the catalog text with retry instead (#2517).
  it.each([
    ["ag_category_id", 0],
    ["supervisor_id", 1],
  ])(
    "throws the ApiError when the %s options fail to load",
    async (name, sectionIndex) => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: "error", code: "general.unavailable" }),
          { status: 503 },
        ),
      );
      const field = activitiesConfig.form.sections[sectionIndex]?.fields.find(
        (candidate) => candidate.name === name,
      );
      const loadOptions =
        field && typeof field.options === "function"
          ? field.options
          : undefined;

      await expect(loadOptions?.()).rejects.toMatchObject({
        status: 503,
        code: "general.unavailable",
      });
    },
  );

  it("offers the available supervisors by staff id and name", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: [
          {
            id: "12",
            staff_id: "12",
            is_primary: false,
            first_name: "Ada",
            last_name: "Lind",
          },
        ],
      }),
    );
    const field = activitiesConfig.form.sections[1]?.fields.find(
      (candidate) => candidate.name === "supervisor_id",
    );
    const loadOptions =
      field && typeof field.options === "function" ? field.options : undefined;

    await expect(loadOptions?.()).resolves.toEqual([
      { value: "12", label: "Ada Lind" },
    ]);
    expect(vi.mocked(global.fetch).mock.calls[0]?.[0]).toBe(
      "/api/activities/supervisors/available",
    );
  });
});
