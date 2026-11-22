/**
 * Tests for Activities Configuration
 * Tests emoji matching, config structure, and form sections
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { activitiesConfig } from "./activities.config";
import {
  mapActivityResponse,
  type Activity,
  type ActivitySupervisor,
} from "@/lib/activity-helpers";
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

  it("has correct API configuration", () => {
    expect(activitiesConfig.api.routes.list).toBe("GET /api/activities/");
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

  it("has no transformBeforeSubmit", () => {
    expect(activitiesConfig.form.transformBeforeSubmit).toBeUndefined();
  });

  it("has detail header configuration", () => {
    const mockActivity = {
      id: "1",
      name: "Fußball AG",
      category_name: "Sport",
      max_participant: 20,
      participant_count: 15,
    } as unknown as Activity;

    expect(activitiesConfig.detail.header?.title(mockActivity)).toBe(
      "Fußball AG",
    );
    expect(activitiesConfig.detail.header?.subtitle?.(mockActivity)).toBe(
      "Sport",
    );
  });

  it("calculates activity emoji for sports", () => {
    const mockActivity = {
      id: "1",
      name: "Fußball AG",
      category_name: "Sport",
      max_participant: 20,
    } as unknown as Activity;

    const emoji = activitiesConfig.detail.header?.avatar?.text(mockActivity);
    expect(emoji).toBe("⚽");
  });

  it("calculates activity emoji for creative activities", () => {
    const mockActivity = {
      id: "1",
      name: "Kunst AG",
      category_name: "Kreativ",
      max_participant: 20,
    } as unknown as Activity;

    const emoji = activitiesConfig.detail.header?.avatar?.text(mockActivity);
    expect(emoji).toBe("🎨");
  });

  it("uses initials as fallback emoji", () => {
    const mockActivity = {
      id: "1",
      name: "Unknown Activity",
      category_name: "Other",
      max_participant: 20,
    } as unknown as Activity;

    const emoji = activitiesConfig.detail.header?.avatar?.text(mockActivity);
    expect(emoji).toBe("UN");
  });

  it("maps request data correctly", () => {
    const data: Partial<Activity> = {
      name: "Test Activity",
      max_participant: 25,
      ag_category_id: "3",
    };

    const mapped = activitiesConfig.service?.mapRequest?.(data);
    expect(mapped).toEqual({
      name: "Test Activity",
      max_participants: 25,
      category_id: 3,
    });
  });

  it("maps request data with supervisor", () => {
    const data: Partial<Activity> = {
      name: "Test Activity",
      max_participant: 25,
      ag_category_id: "3",
      supervisor_id: "42",
    };

    const mapped = activitiesConfig.service?.mapRequest?.(data);
    expect(mapped).toEqual({
      name: "Test Activity",
      max_participants: 25,
      category_id: 3,
      supervisor_ids: [42],
    });
  });

  it("maps an empty participant limit to null", () => {
    const data = {
      name: "Test Activity",
      max_participant: "",
      ag_category_id: "3",
    } as unknown as Partial<Activity>;

    const mapped = activitiesConfig.service?.mapRequest?.(data);
    expect(mapped).toEqual({
      name: "Test Activity",
      max_participants: null,
      category_id: 3,
    });
  });

  it("maps the contract's activity once", () => {
    const responseData = buildBackendActivity({
      id: "1",
      name: "Test Activity",
    });

    const mapped = activitiesConfig.service?.mapResponse?.(responseData);
    expect(mapped).toEqual(mapActivityResponse(responseData));
    expect(mapped?.max_participant).toBe(20);
    expect(mapped?.is_open_ags).toBe(true);
  });

  it("has list configuration", () => {
    expect(activitiesConfig.list.title).toBe("Aktivität auswählen");
    expect(activitiesConfig.list.searchStrategy).toBe("frontend");
  });

  it("displays supervisor in list item subtitle", () => {
    const mockActivity = {
      id: "1",
      name: "Test AG",
      max_participant: 20,
      supervisors: [
        {
          id: "1",
          staff_id: "1",
          activity_id: "1",
          is_primary: true,
          first_name: "Max",
          last_name: "Mustermann",
        } as ActivitySupervisor,
      ],
    } as unknown as Activity;

    const subtitle = activitiesConfig.list.item.subtitle?.(mockActivity);
    expect(subtitle).toBe("Max Mustermann");
  });

  it("displays no supervisor message when none assigned", () => {
    const mockActivity = {
      id: "1",
      name: "Test AG",
      max_participant: 20,
      supervisors: [],
    } as unknown as Activity;

    const subtitle = activitiesConfig.list.item.subtitle?.(mockActivity);
    expect(subtitle).toBe("Keine Hauptbetreuung");
  });

  it("has custom labels", () => {
    expect(activitiesConfig.labels?.createButton).toBe(
      "Neue Aktivität erstellen",
    );
    expect(activitiesConfig.labels?.deleteConfirmation).toContain("löschen");
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
