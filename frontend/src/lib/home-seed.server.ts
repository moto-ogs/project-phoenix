import { leadsSchool } from "~/lib/auth-utils";
import { mapBirthdayOverview } from "~/lib/birthdays-api";
import {
  countOpenBookingChildren,
  mapBookingLeftovers,
} from "~/lib/booking-leftover";
import { findPeriodForDate, mapPeriods } from "~/lib/calendar-period-helpers";
import * as active from "~/lib/contract/active.generated";
import * as birthdays from "~/lib/contract/birthdays.generated";
import * as dayChanges from "~/lib/contract/day-changes.generated";
import * as enrollment from "~/lib/contract/enrollment.generated";
import * as settings from "~/lib/contract/settings.generated";
import * as staff from "~/lib/contract/staff.generated";
import * as students from "~/lib/contract/students.generated";
import * as timetable from "~/lib/contract/timetable.generated";
import * as timeTracking from "~/lib/contract/time-tracking.generated";
import { mapDashboardAnalyticsResponse } from "~/lib/dashboard-helpers";
import { berlinTodayISO } from "~/lib/date-helpers";
import { mapDayChanges } from "~/lib/day-changes";
import { mapPhaseExpiryWarning } from "~/lib/enrollment-phase-api";
import { homeBlockAccess } from "~/lib/home-block-access";
import { resolveHomeLayout } from "~/lib/home-blocks";
import { mapHomeLayout } from "~/lib/home-layout-api";
import { isScopeBooked, PAGE_MODULES } from "~/lib/module-register";
import {
  mapHomeGroupRead,
  mapOgsGroupLiveResponse,
} from "~/lib/ogs-group-live-api";
import {
  mapPickupExtension,
  mapPickupExtensionReminder,
} from "~/lib/pickup-extension-api";
import {
  getSmartRedirectPath,
  isSchoolPortalHandoffPath,
} from "~/lib/redirect-utils";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { mapSchoolVacationHints } from "~/lib/school-vacations-api";
import { mapRosterDeviations } from "~/lib/roster-deviation";
import { mapDevicePinSetupReason } from "~/lib/settings-api";
import { mapOwnAssignment } from "~/lib/shift-helpers";
import { loadSupervision } from "~/lib/shell-bootstrap.server";
import { mapDashboardSummary } from "~/lib/staff-overview-api";
import {
  databaseKeys,
  devicePinKeys,
  homeKeys,
  homeLayoutKeys,
  timetableKeys,
  timeTrackingKeys,
} from "~/lib/swr/portal-keys";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";
import { dashboardKeys } from "~/lib/swr/shell-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import { mapPlannedInstance } from "~/lib/timetable-operations-types";

export async function loadHomeSeed(slug: string) {
  const context = await readTenantPageContext(slug);
  if (
    !context ||
    isSchoolPortalHandoffPath(getSmartRedirectPath(context.session))
  )
    return null;
  const builtAt = Date.now();
  const { session, snapshot, tenant, token } = context;
  const today = berlinTodayISO();
  const timetableEnabled = tenant.timetableEnabled !== false;
  const access = homeBlockAccess(
    session,
    false,
    tenant.operationalOverviewScope,
  );
  const layout = seedRead("homeLayout", async (signal) =>
    mapHomeLayout(
      (
        await readContract(settings.routes["GET /api/settings/home-layout"], {
          token,
          signal,
        })
      ).data,
    ),
  );
  const entries: ServerSeedEntry[] = [
    { key: homeLayoutKeys.key(), value: layout, render: true },
  ];

  if (leadsSchool(session)) {
    entries.push(
      {
        key: enrollmentKeys.phaseExpiryWarnings(),
        value: seedRead("homePhaseExpiry", async (signal) => {
          const answer = await readContract(
            enrollment.routes["GET /api/enrollment/phases/expiry-warnings"],
            { token, signal },
          );
          return answer.data.map(mapPhaseExpiryWarning);
        }),
      },
      {
        key: devicePinKeys.status(),
        value: seedRead("homeDevicePin", async (signal) =>
          mapDevicePinSetupReason(
            (
              await readContract(
                settings.routes["GET /api/settings/device-pin-status"],
                {
                  token,
                  signal,
                },
              )
            ).data,
          ),
        ),
      },
    );
  }
  if (timetableEnabled && access.has("schedules:manage")) {
    entries.push({
      key: tenantDailyKeys.pickupExtensionReminders(),
      value: seedRead("homePickupExtensionReminders", async (signal) => {
        const answer = await readContract(
          timetable.routes["GET /api/timetable/pickup-extensions/"],
          { token, signal },
        );
        return (answer.data.tasks ?? [])
          .map(mapPickupExtension)
          .map(mapPickupExtensionReminder);
      }),
    });
    entries.push({
      key: timetableKeys.schoolVacationHints(today),
      value: seedRead("homeSchoolVacationHints", async (signal) =>
        mapSchoolVacationHints(
          (
            await readContract(
              timetable.routes["GET /api/timetable/school-vacation-hints"],
              {
                token,
                signal,
              },
            )
          ).data,
        ),
      ),
    });
  }

  // NowStrip needs these independently of which cards are on the board.
  if (access.has("groups:read")) {
    entries.push({
      key: dashboardKeys.analytics(),
      render: true,
      value: seedRead("homeAnalytics", async (signal) =>
        mapDashboardAnalyticsResponse(
          (
            await readContract(
              active.routes["GET /api/active/analytics/dashboard"],
              {
                token,
                signal,
              },
            )
          ).data,
        ),
      ),
    });
  }
  if (timetableEnabled && access.has("schedules:read")) {
    entries.push({
      key: homeKeys.dayFlow(),
      value: seedRead("homeDayFlow", async (signal) => {
        const answer = await readContract(
          timetable.routes["GET /api/timetable/operations/planned-now"],
          { token, signal, query: { scope: "day", include_roster: false } },
        );
        return (answer.data.instances ?? []).map(mapPlannedInstance);
      }),
    });
  }
  if (
    timetableEnabled &&
    access.has("time_tracking:own") &&
    (access.caresForGroups || !access.isAdminScope) &&
    !session.user.viaTraeger
  ) {
    entries.push({
      key: timeTrackingKeys.ownAssignmentsToday(today),
      value: seedRead("homeOwnAssignments", async (signal) => {
        const answer = await readContract(
          timeTracking.routes["GET /api/time-tracking/assignments"],
          { token, signal, query: { from: today, to: today } },
        );
        return (answer.data ?? []).map(mapOwnAssignment);
      }),
    });
  }

  // Only fetch card-owned data for cards the initial layout places. My Group
  // additionally uses the shell's confirmed group membership; this does not
  // change placement of the cards below.
  const saved = await layout;
  if (!saved) return seedOf(snapshot, entries, builtAt);
  const board = {
    access,
    timetableEnabled,
    detailed: tenant.presenceMode !== "binary",
    openCareGroupMode: tenant.groupMode === "open_care",
    bookedModules: tenant.bookedModules,
    birthdaysEnabled: true,
    remindersEnabled: true,
    messagingEnabled:
      tenant.messagingEnabled === true &&
      isScopeBooked(PAGE_MODULES["/messages"], tenant.bookedModules),
    staffMessagingEnabled: tenant.staffMessagingEnabled === true,
  };
  const { placements } = resolveHomeLayout(
    board,
    saved.blocks,
    saved.overrides,
    saved.policies,
  );
  const withOwnGroup = resolveHomeLayout(
    {
      ...board,
      access: homeBlockAccess(session, true, tenant.operationalOverviewScope),
    },
    saved.blocks,
    saved.overrides,
    saved.policies,
  );
  if (withOwnGroup.placements.some(({ key }) => key === "section.my_group")) {
    entries.push({
      key: homeKeys.ownGroup(session.user.id),
      value: loadSupervision(token).then((navigation) => {
        if (!navigation?.groups?.navigation?.some((group) => group.is_personal))
          return undefined;
        return seedRead("homeOwnGroup", async (signal) => {
          const answer = await readContract(
            students.routes["GET /api/students/ogs-group-live"],
            { token, signal },
          );
          return mapHomeGroupRead(mapOgsGroupLiveResponse(answer.data));
        });
      }),
    });
  }
  const keys = new Set(placements.map(({ key }) => key));
  if (keys.has("section.day_changes")) {
    entries.push({
      key: homeKeys.dayChanges(session.user.id),
      value: seedRead("homeDayChanges", async (signal) =>
        mapDayChanges(
          (
            await readContract(
              dayChanges.routes["GET /api/day-changes/today"],
              {
                token,
                signal,
              },
            )
          ).data,
        ),
      ),
    });
  }
  if (keys.has("section.birthdays")) {
    entries.push({
      key: homeKeys.birthdayOverview(),
      value: seedRead("homeBirthdays", async (signal) =>
        mapBirthdayOverview(
          (
            await readContract(birthdays.routes["GET /api/birthdays/"], {
              token,
              signal,
            })
          ).data,
        ),
      ),
    });
  }
  if (keys.has("section.staff_today")) {
    entries.push({
      key: homeKeys.staffSummary(),
      value: seedRead("homeStaffSummary", async (signal) =>
        mapDashboardSummary(
          (
            await readContract(
              staff.routes["GET /api/staff/dashboard-summary"],
              {
                token,
                signal,
                query: { period: "week" },
              },
            )
          ).data,
        ),
      ),
    });
  }
  return seedOf(snapshot, entries, builtAt);
}

/** The optional planning notices never delay the board and its layout. */
export async function loadHomePlanningSeed(slug: string) {
  const context = await readTenantPageContext(slug);
  if (
    !context ||
    context.tenant.timetableEnabled === false ||
    !homeBlockAccess(
      context.session,
      false,
      context.tenant.operationalOverviewScope,
    ).has("schedules:manage") ||
    isSchoolPortalHandoffPath(getSmartRedirectPath(context.session))
  )
    return null;
  const builtAt = Date.now();
  const { snapshot, token } = context;
  const today = berlinTodayISO();
  const periods = seedRead("homePlanningPeriods", async (signal) =>
    mapPeriods(
      (
        await readContract(timetable.routes["GET /api/timetable/periods/"], {
          token,
          signal,
        })
      ).data,
    ),
  );
  const entries: ServerSeedEntry[] = [
    { key: databaseKeys.calendarPeriods(), value: periods },
  ];
  const list = await periods;
  const period = list && findPeriodForDate(list, today);
  if (period) {
    const query = { period_id: period.id };
    entries.push(
      {
        key: timetableKeys.bookingLeftoverCount(period.id),
        value: seedRead("homeBookingLeftoverCount", async (signal) =>
          countOpenBookingChildren(
            mapBookingLeftovers(
              (
                await readContract(
                  timetable.routes[
                    "GET /api/timetable/templates/booking-leftovers"
                  ],
                  { query, token, signal },
                )
              ).data,
            ),
          ),
        ),
      },
      {
        key: tenantDailyKeys.rosterDeviationCount(period.id),
        value: seedRead(
          "homeRosterDeviationCount",
          async (signal) =>
            mapRosterDeviations(
              (
                await readContract(
                  timetable.routes[
                    "GET /api/timetable/templates/roster-deviations"
                  ],
                  { query, token, signal },
                )
              ).data,
            ).length,
        ),
      },
    );
  }
  return seedOf(snapshot, entries, builtAt);
}
