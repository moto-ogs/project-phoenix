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
  type ArrivalPickupPeriod,
  fetchTraegerArrivalPickupTimes,
} from "~/lib/traeger-arrival-pickup-api";

/**
 * The heatmap of arrival and pickup times of one period (#4714). Past days do
 * not change, so the page reads it once per period and keeps the previous
 * period on screen while the next one loads. A refusal withdraws it
 * everywhere: from the cache, the page head and the export
 * (`useConfirmedResource`).
 */
export function useTraegerArrivalPickupTimes(period: ArrivalPickupPeriod) {
  const { data: session } = useSession();
  const key =
    session?.user.scope === "org"
      ? traegerKeys.arrivalPickupTimes(period.from, period.to)
      : null;
  const guard = useRefusalGuard(key);
  const response = useSWRAuth(
    key,
    () => fetchTraegerArrivalPickupTimes(period),
    { keepPreviousData: true, revalidateOnFocus: false, ...guard.callbacks },
  );
  const times = useConfirmedResource(
    response,
    guard,
    "die Ankunfts- und Abholzeiten",
  );
  return {
    times: times.data,
    // A failed reload keeps confirmed figures above the error; a refusal
    // shows the error alone.
    error: metadataLoadError(
      times.loadError,
      times.data !== null,
      times.failure,
    ),
    loading: times.data === null && !times.failure,
    reload: times.reload,
    // The CSV export can also discover a revoked permission.
    reportError: guard.callbacks.onError,
  };
}
