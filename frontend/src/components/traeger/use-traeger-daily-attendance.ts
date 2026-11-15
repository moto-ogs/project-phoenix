"use client";

import { useSession } from "next-auth/react";
import { metadataLoadError } from "./metadata-load-error";
import {
  useConfirmedResource,
  useRefusalGuard,
} from "./use-traeger-confirmed-resource";
import { useSWRAuth } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/portal-keys";
import {
  type DailyAttendancePeriod,
  fetchTraegerDailyAttendance,
} from "~/lib/traeger-daily-attendance-api";

/**
 * The daily attendance report of Mecklenburg-Vorpommern of one period
 * (#4717). Past days do not change, so the page reads it once per period and
 * keeps the previous period on screen while the next one loads. A refusal
 * withdraws it everywhere: from the cache, the page head and the export
 * (`useConfirmedResource`).
 */
export function useTraegerDailyAttendance(period: DailyAttendancePeriod) {
  const { data: session } = useSession();
  const key =
    session?.user.scope === "org"
      ? traegerKeys.dailyAttendance(period.from, period.to)
      : null;
  const guard = useRefusalGuard(key);
  const response = useSWRAuth(key, () => fetchTraegerDailyAttendance(period), {
    keepPreviousData: true,
    revalidateOnFocus: false,
    ...guard.callbacks,
  });
  const report = useConfirmedResource(response, guard, "die Tagesmeldung");
  return {
    report: report.data,
    // A failed reload keeps confirmed figures above the error; a refusal
    // shows the error alone.
    error: metadataLoadError(
      report.loadError,
      report.data !== null,
      report.failure,
    ),
    loading: report.data === null && !report.failure,
    // The CSV export can also discover a revoked permission.
    reportError: guard.callbacks.onError,
  };
}
