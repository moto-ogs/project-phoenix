/**
 * The calls of the Datenverwaltung's entity configs (#7806): each reaches its
 * registered route through bffJson with the generated request and answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activitiesConfig } from "./activities.config";
import { devicesConfig } from "./devices.config";
import { groupsConfig } from "./groups.config";
import { permissionsConfig } from "./permissions.config";
import { rolesConfig } from "./roles.config";
import { teachersConfig } from "./teachers.config";
import type { Group } from "~/lib/group-helpers";
import { buildBackendGroup } from "~/test/fixtures/groups";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list", () => {
  it.each([
    ["devices", () => devicesConfig.api.list(), "/api/iot"],
    ["roles", () => rolesConfig.api.list(), "/api/auth/roles"],
    [
      "activities",
      () => activitiesConfig.api.list(),
      "/api/activities?include_system=true",
    ],
    [
      "permissions",
      () => permissionsConfig.api.list(),
      "/api/auth/permissions",
    ],
    ["staff", () => teachersConfig.api.list(), "/api/staff"],
  ])("reads the %s list from its route", async (_entity, list, url) => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [] }));

    await expect(list()).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
  });
});

describe("groups", () => {
  // The edit form hands in the whole loaded group; the route takes only
  // name, room and leads.
  it("sends only the fields of the group request", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: buildBackendGroup({ id: "3" }) }),
    );
    const loaded: Partial<Group> = {
      id: "3",
      name: "Blau",
      room_id: "5",
      room_name: "Raum 5",
      student_count: 12,
      supervisors: [{ id: "8", name: "Mia" }],
      teacher_ids: ["8"],
    };

    await expect(groupsConfig.api.update("3", loaded)).resolves.toMatchObject({
      id: "3",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/groups/3");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Blau",
      room_id: "5",
      teacher_ids: ["8"],
    });
  });
});

describe("roles", () => {
  // The master-data PUT carries the version the edit was made from and
  // answers the stored role with its new version (ADR 0311).
  it("saves over the read version and answers the stored role", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: "success",
        data: {
          id: "4",
          name: "Springkraft",
          description: "",
          is_system: false,
          base_role: "user",
          school_portal: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          version: "v2",
        },
      }),
    );

    await expect(
      rolesConfig.api.update(
        "4",
        { name: "Springkraft", baseRole: "user" },
        {
          id: "4",
          name: "Springkraft",
          description: "",
          isSystem: false,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          version: "v1",
        },
      ),
    ).resolves.toMatchObject({ id: "4", version: "v2" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/roles/4/master-data");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Springkraft",
      base_role: "user",
      expected_version: "v1",
    });
  });
});
