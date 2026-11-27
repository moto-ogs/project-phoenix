"use client";

import { useSession } from "next-auth/react";
import {
  useConfirmedResource,
  useRefusalGuard,
} from "./use-traeger-confirmed-resource";
import { useSWRAuth } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerSchoolsDayChanges } from "~/lib/traeger-day-changes-api";

/** The Träger portal has no live channel; „Heute anders“ refreshes by the minute, like the hints. */
const DAY_CHANGES_REFRESH_MS = 60_000;

/**
 * „Heute anders“ of every school of the Träger (#7672). `error` is the load
 * error card: only without confirmed changes, or on a refusal. A failed
 * refresh keeps the confirmed changes and sets `refreshFailed`. With
 * `tomorrow` (YYYY-MM-DD) it reads the preview on tomorrow (#8236).
 */
export function useTraegerDayChanges(tomorrow?: string) {
  const { data: session } = useSession();
  let key: string | null = null;
  if (session?.user.scope === "org") {
    key = tomorrow
      ? traegerKeys.schoolsDayChangesOn(tomorrow)
      : traegerKeys.schoolsDayChanges();
  }
  const guard = useRefusalGuard(key);
  const response = useSWRAuth(
    key,
    () => fetchTraegerSchoolsDayChanges(tomorrow),
    {
      revalidateOnFocus: true,
      refreshInterval: DAY_CHANGES_REFRESH_MS,
      // Beim Wechsel auf morgen (#8236) gelten die Daten von heute nicht als
      // bestätigt: Schlägt morgen fehl, zeigt die Karte den Fehler statt
      // einer endlosen Ladeanzeige.
      keepPreviousData: false,
      ...guard.callbacks,
    },
  );
  const changes = useConfirmedResource(
    response,
    guard,
    tomorrow ? "die Änderungen von morgen" : "die Änderungen von heute",
  );
  const confirmed = changes.data !== null;
  return {
    changes: changes.data,
    error: confirmed ? null : changes.loadError,
    refreshFailed: confirmed && changes.failure !== undefined,
    reload: changes.reload,
  };
}
