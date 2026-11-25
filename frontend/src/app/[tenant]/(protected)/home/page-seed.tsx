"use client";

import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { berlinTodayISO } from "~/lib/date-helpers";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import {
  devicePinKeys,
  homeKeys,
  homeLayoutKeys,
  timetableKeys,
  timeTrackingKeys,
} from "~/lib/swr/portal-keys";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { dashboardKeys } from "~/lib/swr/shell-keys";

export function HomeSeed({
  seed,
  children,
}: Readonly<{ seed: ServerSeedInput; children: ReactNode }>) {
  const { data: session } = useSession();
  const accountId = session?.user.id;
  const today = berlinTodayISO();
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
      {children}
    </SWRServerSeed>
  );
}
