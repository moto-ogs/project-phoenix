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
 * refresh keeps the confirmed changes and sets `refreshFailed`.
 */
export function useTraegerDayChanges() {
  const { data: session } = useSession();
  const key =
    session?.user.scope === "org" ? traegerKeys.schoolsDayChanges() : null;
  const guard = useRefusalGuard(key);
  const response = useSWRAuth(key, fetchTraegerSchoolsDayChanges, {
    revalidateOnFocus: true,
    refreshInterval: DAY_CHANGES_REFRESH_MS,
    ...guard.callbacks,
  });
  const changes = useConfirmedResource(
    response,
    guard,
    "die Änderungen von heute",
  );
  const confirmed = changes.data !== null;
  return {
    changes: changes.data,
    error: confirmed ? null : changes.loadError,
    refreshFailed: confirmed && changes.failure !== undefined,
    reload: changes.reload,
  };
}
