"use client";

import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { externalStaffNote } from "~/lib/staff-helpers";
import { substitutionService } from "~/lib/substitution-api";
import type { RunningSupervision } from "~/lib/substitution-helpers";
import { useSWRAuth } from "~/lib/swr";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";

export type SupervisionTarget = RunningSupervision["availableTargets"][number];

/**
 * Loads the running supervision a dialog acts on while it is open, with the
 * load failure and its „Wiederholen“. `object` names it in the error text.
 */
export function useRunningSupervision(
  activeGroupId: string | null,
  isOpen: boolean,
  object: string,
) {
  const key =
    isOpen && activeGroupId
      ? tenantDailyKeys.runningSupervision(activeGroupId)
      : null;
  const { data, error, mutate } = useSWRAuth(
    key,
    () => substitutionService.fetchRunningSupervision(activeGroupId ?? ""),
    { keepPreviousData: false },
  );
  const { error: loadError } = useSwrResourceLoadError(
    [{ data, error }],
    object,
    () => mutate(),
  );
  return {
    overview: data ?? null,
    loadError,
    isLoading: key !== null && data === undefined && !error,
  };
}

// Wie in den anderen Auswahllisten: „Name (Extern · Musikschule, Einladung
// offen)“ (#4573). Externe mit jedem Zugang kommen hier an (ADR 0091).
export function supervisionTargetLabel(target: SupervisionTarget): string {
  const note = externalStaffNote(target);
  return note ? `${target.fullName} (${note})` : target.fullName;
}
