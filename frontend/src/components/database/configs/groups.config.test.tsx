/**
 * Tests for Groups Configuration
 * Tests group config structure and response mapping
 */
import { describe, it, expect, vi } from "vitest";
import {
  groupsConfig,
  toGroupRequest,
  toGroupUpdateRequest,
} from "./groups.config";
import type { Group } from "@/lib/group-helpers";
import { ApiError } from "~/lib/api-error";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// The session gate is session-cache's own concern.
vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

describe("groupsConfig", () => {
  it("exports a valid entity config", () => {
    expect(groupsConfig).toBeDefined();
    expect(groupsConfig.name).toEqual({
      singular: "Gruppe",
      plural: "Gruppen",
    });
  });

  it("has form sections configured", () => {
    expect(groupsConfig.form.sections).toHaveLength(1);
    expect(groupsConfig.form.sections[0]?.title).toBe("Gruppendetails");
  });

  it("has required form fields", () => {
    const fields = groupsConfig.form.sections[0]?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);

    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("room_id");
    expect(fieldNames).toContain("teacher_ids");
  });

  it("transforms data before submit with empty room_id", () => {
    const data: Partial<Group> = {
      name: "Test Group",
      room_id: "",
    };

    const transformed = groupsConfig.form.transformBeforeSubmit?.(data);
    // Empty string is preserved (not converted to undefined with ??)
    expect(transformed?.room_id).toBe("");
  });

  it("transforms null room_id to undefined", () => {
    const data = {
      name: "Test Group",
      room_id: null as unknown as string | undefined,
    };

    const transformed = groupsConfig.form.transformBeforeSubmit?.(data);
    expect(transformed?.room_id).toBeUndefined();
  });

  it("maps request data correctly", () => {
    const data: Partial<Group> = {
      name: "Test Group",
      room_id: "5",
      teacher_ids: ["1", "2"],
    };

    const mapped = toGroupRequest(data);
    expect(mapped).toEqual({
      name: "Test Group",
      room_id: "5",
      teacher_ids: ["1", "2"],
    });
  });

  // ADR 0311: the save sends the version the form was filled from, and a
  // cleared room as null, because the route keeps a room the body does not
  // name.
  it("saves against the version read and clears a room with null", () => {
    expect(
      toGroupUpdateRequest({
        name: "Test Group",
        room_id: "",
        teacher_ids: ["1"],
        version: "v3",
      }),
    ).toEqual({
      name: "Test Group",
      room_id: null,
      teacher_ids: ["1"],
      expected_version: "v3",
    });
  });

  it("loads caregiver teacher options and skips staff without teacher ids", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: [
          { id: "10", full_name: "Ada Lovelace", teacher_id: "77" },
          { id: "11", full_name: "Ignored Staff" },
        ],
      }),
    );

    const teacherField = groupsConfig.form.sections[0]?.fields.find(
      (field) => field.name === "teacher_ids",
    );
    const loadOptions =
      teacherField && typeof teacherField.options === "function"
        ? teacherField.options
        : undefined;
    const options = await loadOptions?.();

    expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/staff/by-role?role=user");
    expect(options).toEqual([{ value: "77", label: "Ada Lovelace" }]);
  });

  // An empty list would look like a school without caregivers; the form
  // shows the catalog text with retry instead (#2517).
  it("throws the ApiError when the caregiver lookup fails", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ code: "general.permission" }, { status: 403 }),
    );

    const teacherField = groupsConfig.form.sections[0]?.fields.find(
      (field) => field.name === "teacher_ids",
    );
    const loadOptions =
      teacherField && typeof teacherField.options === "function"
        ? teacherField.options
        : undefined;

    await expect(loadOptions?.()).rejects.toMatchObject({
      status: 403,
      code: "general.permission",
    });
  });

  it("loads room options from the rooms api", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: [
          { id: "7", name: "Raum Sonnenblume" },
          { id: "9", name: "Raum Regenbogen" },
        ],
        pagination: {
          current_page: 1,
          page_size: 50,
          total_pages: 1,
          total_records: 2,
        },
      }),
    );

    const roomField = groupsConfig.form.sections[0]?.fields.find(
      (field) => field.name === "room_id",
    );
    const loadOptions =
      roomField && typeof roomField.options === "function"
        ? roomField.options
        : undefined;
    const options = await loadOptions?.();

    expect(mockFetch.mock.calls.at(-1)?.[0]).toBe("/api/rooms");
    expect(options).toEqual([
      { value: "", label: "Kein Gruppenraum" },
      { value: "7", label: "Raum Sonnenblume" },
      { value: "9", label: "Raum Regenbogen" },
    ]);
  });

  it("throws general.unavailable when the rooms request never reaches the API", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const roomField = groupsConfig.form.sections[0]?.fields.find(
      (field) => field.name === "room_id",
    );
    const loadOptions =
      roomField && typeof roomField.options === "function"
        ? roomField.options
        : undefined;

    const caught = await loadOptions?.().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ code: "general.unavailable" });
  });
});
