import { TenantRouteSeed } from "../tenant-route-seed";
import { readContract, seedRead } from "~/lib/server-seed.server";
import * as contract from "~/lib/contract/timetable.generated";
import * as substitutions from "~/lib/contract/substitutions.generated";
import * as shifts from "~/lib/contract/staff-shifts.generated";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { isScopeBooked } from "~/lib/module-register";
import {
  berlinTodayISO,
  careWeekDayCount,
  isValidISODate,
  parseISODate,
  toISODate,
} from "~/lib/date-helpers";
import {
  careDayISO,
  getWeekRange,
  getWeekdays,
  mapGaps,
  mapWeeklyInstances,
} from "~/lib/timetable-helpers";
import { mapScheduleSubstitutionOverview } from "~/lib/substitution-helpers";
import { mapStaffScheduleOverview } from "~/lib/shift-helpers";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import PageContent from "./page-content";

export default async function VertretungPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await params;
  const query = await searchParams;
  const d = Array.isArray(query.d) ? query.d[0] : query.d;
  const today = berlinTodayISO();
  const day = d && isValidISODate(d) ? d : today;
  return (
    <TenantRouteSeed
      slug={tenant}
      load={({ token, session, tenant: school }) => {
        if (
          school.timetableEnabled === false ||
          !hasPermission(session, "schedules:read")
        )
          return [];
        const weekendOpen = school.weekendFollowsFriday === true;
        const range = getWeekRange(
          parseISODate(careDayISO(day, weekendOpen, today)),
          0,
        );
        const from = toISODate(range.from);
        const to = toISODate(range.to);
        const gapsFrom = from < today ? today : from;
        const careDays = getWeekdays(range.from).slice(
          0,
          careWeekDayCount(from, weekendOpen, today),
        );
        const coverageTo = toISODate(careDays.at(-1) ?? range.to);
        const canReadCoverage =
          isAdmin(session) &&
          hasPermission(session, "time_tracking:manage") &&
          hasPermission(session, "users:read") &&
          isScopeBooked("dienstplan", school.bookedModules);
        return [
          {
            key: tenantDailyKeys.vertretungWeek(from, to),
            render: true,
            value: seedRead("GET /api/timetable/instances/", async (signal) => {
              const { data } = await readContract(
                contract.routes["GET /api/timetable/instances/"],
                { token, signal, query: { from, to } },
              );
              return mapWeeklyInstances(data);
            }),
          },
          {
            key: tenantDailyKeys.vertretungStaffList(from, to),
            render: true,
            value: seedRead("GET /api/substitutions/", async (signal) => {
              const { data } = await readContract(
                substitutions.routes["GET /api/substitutions/"],
                { token, signal, query: { from, to } },
              );
              return mapScheduleSubstitutionOverview(data);
            }),
          },
          ...(to >= today
            ? [
                {
                  key: tenantDailyKeys.vertretungGaps(gapsFrom, to),
                  render: true,
                  value: seedRead("GET /api/timetable/gaps", async (signal) => {
                    const { data } = await readContract(
                      contract.routes["GET /api/timetable/gaps"],
                      { token, signal, query: { date: gapsFrom, date_to: to } },
                    );
                    return mapGaps(data);
                  }),
                },
              ]
            : []),
          ...(canReadCoverage && coverageTo >= today
            ? [
                {
                  key: tenantDailyKeys.dienstplanOverview(from, coverageTo),
                  value: seedRead(
                    "GET /api/staff-shifts/overview",
                    async (signal) => {
                      const { data } = await readContract(
                        shifts.routes["GET /api/staff-shifts/overview"],
                        { token, signal, query: { from, to: coverageTo } },
                      );
                      return mapStaffScheduleOverview(data);
                    },
                  ),
                },
              ]
            : []),
        ];
      }}
    >
      <PageContent />
    </TenantRouteSeed>
  );
}
