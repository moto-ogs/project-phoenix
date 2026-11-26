import { hasPermission } from "~/lib/auth-utils";
import { contractGet } from "~/lib/contract/client.server";
import * as groupsContract from "~/lib/contract/groups.generated";
import * as roomsContract from "~/lib/contract/rooms.generated";
import * as studentsContract from "~/lib/contract/students.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import { holidayGuestBadgeSeed } from "~/lib/holiday-guest-badge-seed.server";
import { holidayGuestIds } from "~/lib/holiday-host-api";
import { mapGroupsResponse } from "~/lib/group-helpers";
import { mapRoomsResponse } from "~/lib/room-helpers";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { canReadStudents } from "~/lib/student-access";
import { mapEnrollmentAnswerFilter, studentQuery } from "~/lib/student-api";
import {
  buildStudentSearchFilters,
  fetchStudentSearch,
} from "~/lib/student-search-resource";
import {
  enrollmentAnswerChildrenOf,
  initialStudentSearch,
  searchSelection,
} from "~/lib/student-search-url";
import { mapStudentListRow } from "~/lib/student-wire";
import { groupKeys } from "~/lib/swr/groups-keys";
import { roomKeys } from "~/lib/swr/rooms-keys";
import { studentKeys } from "~/lib/swr/portal-keys";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";

export async function loadStudentSearchSeed(
  slug: string,
  params: URLSearchParams,
) {
  const context = await readTenantPageContext(slug);
  if (!context || !canReadStudents(context.session)) return null;
  const builtAt = Date.now();
  const { snapshot, token, session, tenant } = context;
  const initial = initialStudentSearch(
    params,
    berlinTodayISO(),
    tenant.studentPhotosEnabled === true,
  );
  const schoolClasses = seedRead(
    "studentSchoolClasses",
    async (signal) =>
      (
        await readContract(
          studentsContract.routes["GET /api/students/school-classes"],
          { token, signal },
        )
      ).data,
  );
  const entries: ServerSeedEntry[] = [
    {
      key: studentKeys.schoolClasses(),
      value: schoolClasses,
      render: initial.schoolClasses.length > 0,
    },
  ];
  const groups = hasPermission(session, "groups:read")
    ? seedRead("studentSearchGroups", async (signal) =>
        mapGroupsResponse(
          (
            await readContract(groupsContract.routes["GET /api/groups/"], {
              token,
              signal,
            })
          ).data,
        ),
      )
    : undefined;
  if (groups) {
    entries.push({
      key: groupKeys.key(),
      value: groups,
      render: initial.groupIds.length > 0,
    });
  }
  if (hasPermission(session, "rooms:read")) {
    entries.push({
      key: roomKeys.key({ page: 1, pageSize: 1000 }),
      value: seedRead("studentSearchRooms", async (signal) =>
        mapRoomsResponse(
          (
            await readContract(roomsContract.routes["GET /api/rooms/"], {
              token,
              signal,
              query: { page: 1, page_size: 1000 },
            })
          ).data,
        ),
      ),
    });
  }
  const answer = params.get("enrollment_answer") ?? "";
  const requiresAnswerAccess =
    answer !== "" && hasPermission(session, "users:read");
  let serverAnswerFilter = "";
  let answerChildren: ReadonlySet<string> | null = null;
  if (hasPermission(session, "users:read")) {
    const options = seedRead("studentEnrollmentAnswers", async (signal) =>
      (
        await readContract(
          studentsContract.routes[
            "GET /api/students/enrollment-answer-filters"
          ],
          {
            token,
            signal,
            query: { date: initial.isToday ? undefined : initial.date },
          },
        )
      ).data.map(mapEnrollmentAnswerFilter),
    );
    entries.push({
      key: tenantListKeys.enrollmentAnswerFilters(initial.date),
      render: requiresAnswerAccess,
      value: options,
    });
    if (requiresAnswerAccess) {
      const permitted = await options;
      // Never release a broad list in place of a filter awaiting approval.
      // The regular reader can handle refusal and retry, including a 403.
      if (!permitted) return seedOf(snapshot, entries, builtAt);
      answerChildren = enrollmentAnswerChildrenOf(permitted, answer);
      if (!answerChildren) serverAnswerFilter = answer;
    }
  }
  // An explicit selection of every offered group or class means no filter.
  // If the option read failed, leave the list to the browser that retries it.
  const [classOptions, groupOptions] = await Promise.all([
    initial.schoolClasses.length > 0 ? schoolClasses : [],
    initial.groupIds.length > 0 && groups ? groups : [],
  ]);
  if (!classOptions || !groupOptions) return seedOf(snapshot, entries, builtAt);
  const input = {
    ...initial,
    schoolClasses: searchSelection(initial.schoolClasses, classOptions),
    groupIds: searchSelection(
      initial.groupIds,
      groupOptions.map(({ id }) => id),
    ),
    enrollmentAnswer: serverAnswerFilter,
  };
  const search = seedRead("studentSearch", (signal) =>
    fetchStudentSearch(
      buildStudentSearchFilters(input),
      input.date,
      input.isToday,
      async (filters) => {
        const read = await contractGet(
          studentsContract.routes["GET /api/students/"],
          {
            token,
            signal,
            query: { ...studentQuery(filters), view: "slim" },
          },
        );
        if (!read.ok) throw read.error.cause;
        return {
          students: read.value.data.map((row) =>
            mapStudentListRow(row, "slim"),
          ),
          pagination: read.value.pagination,
        };
      },
    ),
  );
  entries.push({ key: studentKeys.search(input), render: true, value: search });
  if (hasPermission(session, "students:read")) {
    const result = await search;
    const rows = result?.students ?? [];
    const visible = answerChildren
      ? rows.filter((student) => answerChildren.has(student.id))
      : rows;
    const guestIds = holidayGuestIds(visible);
    if (guestIds.length) entries.push(holidayGuestBadgeSeed(token, guestIds));
  }
  return seedOf(snapshot, entries, builtAt);
}
