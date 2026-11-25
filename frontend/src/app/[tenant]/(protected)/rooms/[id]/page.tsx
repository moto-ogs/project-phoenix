import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { contractGet } from "~/lib/contract/client.server";
import * as contract from "~/lib/contract/rooms.generated";
import * as studentsContract from "~/lib/contract/students.generated";
import { hasPermission } from "~/lib/auth-utils";
import {
  mapRoomResponse,
  mapRoomHistoryEntry,
  isRoomHistoryDisabled,
  roomStudentCard,
} from "~/lib/room-helpers";
import { canReadStudents } from "~/lib/student-access";
import { mapStudentListRow } from "~/lib/student-wire";
import { roomKeys } from "~/lib/swr/rooms-keys";
import * as timetable from "~/lib/contract/timetable.generated";
import { berlinTodayISO, isValidISODate } from "~/lib/date-helpers";
import { roomPlanCareDay, roomPlanWeekDays } from "~/lib/room-plan";
import { mapRoomPlanBlocks } from "~/lib/room-plan-api";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import PageContent from "./page-content";

export const unstable_dynamicStaleTime = 60;

export default async function RoomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    d?: string | string[];
    view?: string | string[];
  }>;
}) {
  const [{ tenant, id }, query] = await Promise.all([params, searchParams]);
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (!hasPermission(session, "rooms:read")) return [];
        const detail = seedRead("room detail", async (signal) => {
          const options = { token, signal, params: { id } };
          const [room, history] = await Promise.all([
            readContract(contract.routes["GET /api/rooms/{id}"], options),
            readContract(
              contract.routes["GET /api/rooms/{id}/history"],
              options,
            ).catch((error) => {
              if (!isRoomHistoryDisabled(error)) throw error;
              return null;
            }),
          ]);
          return {
            room: mapRoomResponse(room.data),
            history: history?.data.map(mapRoomHistoryEntry) ?? [],
            historyDisabled: history === null,
            historyFailure: null,
          };
        });
        const entries: ServerSeedEntry[] = [
          {
            key: roomKeys.detailKey(id),
            render: true,
            value: detail,
          },
        ];
        const binary = school.presenceMode === "binary";
        const canUpdate = hasPermission(session, "rooms:update");
        const canReadPlan = hasPermission(session, "schedules:read");
        const tab = first(query.tab);
        const explicitPlan = tab === "plan" && canReadPlan;
        if (!binary && !explicitPlan && canReadStudents(session)) {
          entries.push({
            key: roomKeys.students(id),
            value: detail.then((room) => {
              if (
                !room ||
                (tab === "stammdaten" && canUpdate && !room.room.archivedAt)
              )
                return undefined;
              return seedRead("room child cards", async (signal) => {
                const answer = await contractGet(
                  studentsContract.routes["GET /api/students/"],
                  {
                    token,
                    signal,
                    query: { room_id: id, page_size: 200, view: "slim" },
                  },
                );
                if (!answer.ok) throw answer.error.cause;
                return {
                  students: answer.value.data.map((row) =>
                    roomStudentCard(mapStudentListRow(row, "slim")),
                  ),
                  pagination: answer.value.pagination,
                };
              });
            }),
          });
        }
        if (canReadPlan && (explicitPlan || binary)) {
          const today = berlinTodayISO();
          const date = first(query.d);
          const weekendOpen = school.weekendFollowsFriday === true;
          const day = roomPlanCareDay(
            date && isValidISODate(date) ? date : today,
            weekendOpen,
            today,
          );
          const days =
            first(query.view) === "tag"
              ? [day]
              : roomPlanWeekDays(day, weekendOpen, today);
          const from = days[0] ?? day;
          const to = days.at(-1) ?? day;
          const readPlan = () =>
            seedRead("room plan", async (signal) =>
              mapRoomPlanBlocks(
                (
                  await readContract(
                    timetable.routes["GET /api/timetable/instances/"],
                    {
                      token,
                      signal,
                      query: { room_id: id, from, to },
                    },
                  )
                ).data,
              ),
            );
          entries.push({
            key: roomKeys.plan(id, from, to),
            value:
              explicitPlan || !canUpdate
                ? readPlan()
                : detail.then((room) =>
                    room?.room.archivedAt ? readPlan() : undefined,
                  ),
          });
        }
        return entries;
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
