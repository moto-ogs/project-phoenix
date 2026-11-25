import { mapAbsenceType } from "~/lib/absence-type-api";
import {
  mapActivityCategoryResponse,
  mapActivityResponse,
} from "~/lib/activity-helpers";
import { mapPermissionResponse, mapRoleResponse } from "~/lib/auth-helpers";
import { ENDED_CARE_PAGE_SIZE, mapEndedCarePage } from "~/lib/care-exit-api";
import { mapChildQuota } from "~/lib/child-quota-api";
import { mapClassListEntry } from "~/lib/class-list-entries-api";
import { fetchRosterStudents } from "~/lib/class-roster-resource";
import { canReadStudents } from "~/lib/student-access";
import { studentQuery } from "~/lib/student-api";
import { mapStudentListRow } from "~/lib/student-wire";
import {
  mapTeacherDirectoryRow,
  mapTeacherResponse,
} from "~/lib/teacher-helpers";
import { hasPermission } from "~/lib/auth-utils";
import * as absenceTypes from "~/lib/contract/absence-types.generated";
import * as activities from "~/lib/contract/activities.generated";
import * as admin from "~/lib/contract/admin.generated";
import * as authPermissions from "~/lib/contract/auth-permissions.generated";
import * as authRoles from "~/lib/contract/auth-roles.generated";
import * as classList from "~/lib/contract/class-list-entries.generated";
import { contractGet } from "~/lib/contract/client.server";
import * as students from "~/lib/contract/students.generated";
import * as database from "~/lib/contract/database.generated";
import * as groups from "~/lib/contract/groups.generated";
import * as holidayGuests from "~/lib/contract/holiday-guests.generated";
import * as iot from "~/lib/contract/iot.generated";
import * as rooms from "~/lib/contract/rooms.generated";
import * as shiftTypes from "~/lib/contract/shift-types.generated";
import * as staff from "~/lib/contract/staff.generated";
import * as timetable from "~/lib/contract/timetable.generated";
import * as workTimeModels from "~/lib/contract/work-time-models.generated";
import { mapDeviceSlots } from "~/lib/device-slots";
import { readGradeTransitions } from "~/lib/grade-transition-api";
import { mapGroupsResponse } from "~/lib/group-helpers";
import { mapHolidayGuestGroup } from "~/lib/holiday-host-api";
import { mapDeviceResponse } from "~/lib/iot-helpers";
import { PAGE_MODULES } from "~/lib/module-register";
import { mapTrack } from "~/lib/planning-track-api";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { isHiddenSystemRole } from "~/lib/role-labels";
import { mapRoomsResponse } from "~/lib/room-helpers";
import { mapShiftType } from "~/lib/shift-type-helpers";
import { mapWorkTimeModel } from "~/lib/staff-api";
import { staffKeys, workTimeModelKeys } from "~/lib/swr/staff-keys";
import { groupKeys } from "~/lib/swr/groups-keys";
import { databaseKeys, holidayKeys } from "~/lib/swr/portal-keys";
import { roomKeys } from "~/lib/swr/rooms-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";

type Context = NonNullable<Awaited<ReturnType<typeof readTenantPageContext>>>;
interface CatalogRead {
  key: string;
  render?: boolean;
  allowed?(context: Context): boolean;
  read(token: string, signal: AbortSignal): Promise<unknown>;
}

const categoryQuery = {
  include_archived: true,
  include_system: true,
  with_usage: true,
} as const;

const catalogReads = {
  personal: {
    key: staffKeys.teachersKey(),
    allowed: ({ session }) =>
      ["users:read", "staff:manage", "staff:stammdaten"].some((permission) =>
        hasPermission(session, permission),
      ),
    read: async (token, signal) =>
      (
        await readContract(staff.routes["GET /api/staff/"], { token, signal })
      ).data
        .map(mapTeacherResponse)
        .map(mapTeacherDirectoryRow),
  },
  students: {
    // The full student list audits health access. Seed its independent
    // quota and group choices only, never the full list at Link intent.
    key: tenantAdminKeys.studentChildQuota(),
    render: false,
    allowed: ({ session }) => hasPermission(session, "users:delete"),
    read: async (token, signal) =>
      mapChildQuota(
        (
          await readContract(students.routes["GET /api/students/child-quota"], {
            token,
            signal,
          })
        ).data,
      ),
  },
  "students/ended-care": {
    key: tenantStudentKeys.endedCare(1, ""),
    allowed: ({ session }) => hasPermission(session, "users:delete"),
    read: async (token, signal) =>
      mapEndedCarePage(
        (
          await readContract(students.routes["GET /api/students/ended-care"], {
            token,
            signal,
            query: { page: 1, page_size: ENDED_CARE_PAGE_SIZE },
          })
        ).data,
      ),
  },
  "students/class-list": {
    key: tenantStudentKeys.classListEntries(),
    allowed: ({ session }) => hasPermission(session, "users:read"),
    read: async (token, signal) =>
      (
        await readContract(classList.routes["GET /api/class-list-entries/"], {
          token,
          signal,
        })
      ).data.map(mapClassListEntry),
  },
  index: {
    key: databaseKeys.counts(),
    read: async (token, signal) =>
      (
        await readContract(database.routes["GET /api/database/stats"], {
          token,
          signal,
        })
      ).data,
  },
  activities: {
    key: tenantAdminKeys.activities(),
    allowed: ({ session }) =>
      hasPermission(session, "activities:read") ||
      hasPermission(session, "activities:list"),
    read: async (token, signal) =>
      (
        await readContract(activities.routes["GET /api/activities/"], {
          token,
          signal,
          query: { include_system: true },
        })
      ).data.map(mapActivityResponse),
  },
  devices: {
    key: tenantAdminKeys.devices(),
    allowed: ({ session }) => hasPermission(session, "devices:read"),
    read: async (token, signal) =>
      (
        await readContract(iot.routes["GET /api/iot/"], { token, signal })
      ).data.map(mapDeviceResponse),
  },
  groups: {
    key: groupKeys.key({ page: 1, pageSize: 500 }),
    allowed: ({ session }) => hasPermission(session, "groups:read"),
    read: async (token, signal) =>
      mapGroupsResponse(
        (
          await readContract(groups.routes["GET /api/groups/"], {
            token,
            signal,
            query: { page: 1, page_size: 500 },
          })
        ).data,
      ),
  },
  "grade-transitions": {
    key: tenantAdminKeys.gradeTransitions(),
    allowed: ({ session }) => hasPermission(session, "grade_transitions:read"),
    read: (token, signal) =>
      readGradeTransitions(
        async (afterID, pageSize) =>
          (
            await readContract(
              admin.routes["GET /api/admin/grade-transitions/"],
              {
                token,
                signal,
                query: { after_id: afterID, page_size: pageSize },
              },
            )
          ).data ?? [],
      ),
  },
  rooms: {
    key: roomKeys.key({ page: 1, pageSize: 500, includeSystem: true }),
    allowed: ({ session }) => hasPermission(session, "rooms:read"),
    read: async (token, signal) =>
      mapRoomsResponse(
        (
          await readContract(rooms.routes["GET /api/rooms/"], {
            token,
            signal,
            query: { page: 1, page_size: 500, include_system: true },
          })
        ).data,
      ),
  },
  roles: {
    key: tenantAdminKeys.roles(),
    allowed: ({ session }) =>
      ["roles:read", "users:create", "users:manage"].some((permission) =>
        hasPermission(session, permission),
      ),
    read: async (token, signal) =>
      (
        await readContract(authRoles.routes["GET /auth/roles/"], {
          token,
          signal,
        })
      ).data.map(mapRoleResponse),
  },
  "shift-types": {
    key: tenantAdminKeys.shiftTypes(),
    allowed: ({ session }) => hasPermission(session, "time_tracking:manage"),
    read: async (token, signal) =>
      (
        await readContract(shiftTypes.routes["GET /api/shift-types/"], {
          token,
          signal,
          query: { with_usage: true },
        })
      ).data.map(mapShiftType),
  },
  "absence-types": {
    key: tenantAdminKeys.absenceTypes(),
    allowed: ({ session }) =>
      ["time_tracking:own", "time_tracking:manage", "vacation:approve"].some(
        (permission) => hasPermission(session, permission),
      ),
    read: async (token, signal) =>
      (
        await readContract(absenceTypes.routes["GET /api/absence-types/"], {
          token,
          signal,
        })
      ).data.map(mapAbsenceType),
  },
  categories: {
    key: tenantAdminKeys.categories(),
    read: async (token, signal) =>
      (
        await readContract(
          activities.routes["GET /api/activities/categories"],
          {
            token,
            signal,
            query: categoryQuery,
          },
        )
      ).data.map(mapActivityCategoryResponse),
  },
  permissions: {
    key: tenantAdminKeys.permissions(),
    allowed: ({ session }) => hasPermission(session, "permissions:read"),
    read: async (token, signal) =>
      (
        await readContract(authPermissions.routes["GET /auth/permissions/"], {
          token,
          signal,
        })
      ).data.map(mapPermissionResponse),
  },
  "planning-tracks": {
    key: tenantAdminKeys.planningTracks(),
    allowed: ({ tenant, session }) =>
      tenant.timetableEnabled !== false &&
      (hasPermission(session, "schedules:read") ||
        hasPermission(session, "schedules:manage")),
    read: async (token, signal) =>
      (
        await readContract(
          timetable.routes["GET /api/timetable/planning-tracks/"],
          {
            token,
            signal,
          },
        )
      ).data.map(mapTrack),
  },
  "work-time-models": {
    key: workTimeModelKeys.catalog(),
    allowed: ({ session }) => hasPermission(session, "time_tracking:manage"),
    read: async (token, signal) =>
      (
        await readContract(
          workTimeModels.routes["GET /api/work-time-models/"],
          {
            token,
            signal,
            query: { with_usage: true },
          },
        )
      ).data.map(mapWorkTimeModel),
  },
} satisfies Record<string, CatalogRead>;

const supplementary: Partial<
  Record<keyof typeof catalogReads, readonly CatalogRead[]>
> = {
  devices: [
    {
      key: tenantAdminKeys.deviceSlots(),
      allowed: ({ session }) => hasPermission(session, "devices:read"),
      read: async (token, signal) =>
        mapDeviceSlots(
          (
            await readContract(iot.routes["GET /api/iot/device-slots"], {
              token,
              signal,
            })
          ).data,
        ),
    },
  ],
  groups: [
    {
      key: holidayKeys.guestGroups,
      read: async (token, signal) =>
        (
          await readContract(
            holidayGuests.routes["GET /api/holiday-guests/groups"],
            {
              token,
              signal,
            },
          )
        ).data.map(mapHolidayGuestGroup),
    },
  ],
  "shift-types": [
    { ...catalogReads.categories, key: tenantAdminKeys.shiftTypeCategories() },
  ],
  students: [
    {
      key: tenantAdminKeys.groupOptions(),
      allowed: ({ session }) => hasPermission(session, "groups:read"),
      read: async (token, signal) =>
        mapGroupsResponse(
          (
            await readContract(groups.routes["GET /api/groups/"], {
              token,
              signal,
            })
          ).data,
        )
          .map((group) => ({ value: String(group.id), label: group.name }))
          .sort((a, b) => a.label.localeCompare(b.label, "de")),
    },
  ],
  "students/class-list": [
    {
      key: tenantStudentKeys.classListClassSuggestions(),
      allowed: ({ session }) => canReadStudents(session),
      read: async (token, signal) =>
        (
          await readContract(
            students.routes["GET /api/students/school-classes"],
            {
              token,
              signal,
            },
          )
        ).data,
    },
    {
      key: tenantStudentKeys.classListRosterStudents(),
      render: true,
      allowed: ({ session }) => canReadStudents(session),
      read: (token, signal) =>
        fetchRosterStudents(async (filters) => {
          const answer = await contractGet(
            students.routes["GET /api/students/"],
            {
              token,
              signal,
              query: { ...studentQuery(filters), view: "slim" },
            },
          );
          if (!answer.ok) throw answer.error.cause;
          return {
            students: answer.value.data.map((row) =>
              mapStudentListRow(row, "slim"),
            ),
            pagination: answer.value.pagination,
          };
        }),
    },
  ],
};

export function readDatabaseCatalogSeed(
  slug: string,
  catalog: keyof typeof catalogReads,
  selectedId?: string,
) {
  const resource: CatalogRead = catalogReads[catalog];
  const extras = supplementary[catalog] ?? [];
  const detail =
    selectedId && /^[1-9]\d{0,18}$/.test(selectedId)
      ? catalog === "activities"
        ? tenantAdminKeys.activity(selectedId)
        : catalog === "roles"
          ? tenantAdminKeys.role(selectedId)
          : null
      : null;
  const builtAt = Date.now();
  const route = catalog === "index" ? "/database" : `/database/${catalog}`;
  const seed = readTenantPageContext(slug, PAGE_MODULES[route])
    .then((context) => {
      if (!context) return null;
      const { snapshot, session, token } = context;
      const entries: ServerSeedEntry[] = [];
      const list =
        resource.allowed?.(context) !== false
          ? seedRead(catalog, (signal) => resource.read(token, signal))
          : undefined;
      if (list)
        entries.push({
          key: resource.key,
          render: resource.render ?? true,
          value: list,
        });
      for (const extra of extras) {
        if (extra.allowed?.(context) === false) continue;
        entries.push({
          key: extra.key,
          render: extra.render,
          value: seedRead(extra.key, (signal) => extra.read(token, signal)),
        });
      }
      // The existing pages only open a detail for an item in the actual
      // list. A route query never grants access to an additional resource.
      if (detail && selectedId && list) {
        entries.push({
          key: detail,
          value: list.then(async (rows) => {
            if (!Array.isArray(rows)) return undefined;
            if (
              catalog === "activities" &&
              hasPermission(session, "activities:read") &&
              rows.some((row) => row.id === selectedId)
            ) {
              return seedRead("databaseActivity", async (signal) =>
                mapActivityResponse(
                  (
                    await readContract(
                      activities.routes["GET /api/activities/{id}"],
                      {
                        params: { id: selectedId },
                        token,
                        signal,
                      },
                    )
                  ).data,
                ),
              );
            }
            if (
              catalog === "roles" &&
              hasPermission(session, "roles:read") &&
              rows.some(
                (row) => row.id === selectedId && !isHiddenSystemRole(row),
              )
            ) {
              return seedRead("databaseRole", async (signal) =>
                mapRoleResponse(
                  (
                    await readContract(
                      authRoles.routes["GET /auth/roles/{id}/"],
                      {
                        params: { id: selectedId },
                        token,
                        signal,
                      },
                    )
                  ).data,
                ),
              );
            }
            return undefined;
          }),
        });
      }
      return seedOf(snapshot, entries, builtAt);
    })
    .catch(() => null);
  return {
    seed,
    claims: [resource.key, ...extras.map(({ key }) => key), detail],
  };
}
