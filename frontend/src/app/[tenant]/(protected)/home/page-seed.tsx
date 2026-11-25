"use client";

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import {
  findPeriodForDate,
  type CalendarPeriod,
} from "~/lib/calendar-period-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import {
  databaseKeys,
  devicePinKeys,
  homeKeys,
  homeLayoutKeys,
  timetableKeys,
  timeTrackingKeys,
} from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { dashboardKeys } from "~/lib/swr/shell-keys";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

export function HomeSeed({
  seed,
  planningSeed,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  planningSeed: ServerSeedInput;
  children: ReactNode;
}>) {
  const { data: session } = useSession();
  const accountId = session?.user.id;
  const today = useBerlinToday();
  const periods = databaseKeys.calendarPeriods();
  const claims = [
    homeLayoutKeys.key(),
    dashboardKeys.analytics(),
    homeKeys.dayFlow(),
    timeTrackingKeys.ownAssignmentsToday(today),
    enrollmentKeys.phaseExpiryWarnings(),
    devicePinKeys.status(),
    timetableKeys.schoolVacationHints(today),
    accountId ? homeKeys.dayChanges(accountId) : null,
    homeKeys.birthdayOverview(),
    homeKeys.staffSummary(),
  ];
  return (
    <SWRServerSeed seed={seed} claims={claims} render>
      <SWRServerSeed
        seed={planningSeed}
        claims={[periods]}
        claimsFrom={{
          key: periods,
          derive: (rows: CalendarPeriod[]) => {
            const period = findPeriodForDate(rows, today);
            return period
              ? [
                  timetableKeys.bookingLeftoverCount(period.id),
                  tenantDailyKeys.rosterDeviationCount(period.id),
                ]
              : [];
          },
        }}
      >
        {children}
      </SWRServerSeed>
    </SWRServerSeed>
  );
}
