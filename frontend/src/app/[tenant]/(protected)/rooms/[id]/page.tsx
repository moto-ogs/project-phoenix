import { TenantRouteSeed } from "../../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/rooms.generated";
import { hasPermission } from "~/lib/auth-utils";
import {
  mapRoomResponse,
  mapRoomHistoryEntry,
  isRoomHistoryDisabled,
} from "~/lib/room-helpers";
import { roomKeys } from "~/lib/swr/rooms-keys";
import * as timetable from "~/lib/contract/timetable.generated";
import { berlinTodayISO, isValidISODate } from "~/lib/date-helpers";
import { roomPlanCareDay, roomPlanWeekDays } from "~/lib/room-plan";
import { mapRoomPlanBlocks } from "~/lib/room-plan-api";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import PageContent from "./page-content";

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
        const entries: ServerSeedEntry[] = [
          {
            key: roomKeys.detailKey(id),
            render: true,
            value: seedRead("room detail", async (signal) => {
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
            }),
          },
        ];
        if (
          hasPermission(session, "schedules:read") &&
          (first(query.tab) === "plan" ||
            (school.presenceMode === "binary" &&
              !hasPermission(session, "rooms:update")))
        ) {
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
          entries.push({
            key: roomKeys.plan(id, from, to),
            value: seedRead("room plan", async (signal) =>
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
