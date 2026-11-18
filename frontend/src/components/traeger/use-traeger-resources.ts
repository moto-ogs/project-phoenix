"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { metadataLoadError } from "./metadata-load-error";
import { useTraegerResource } from "./use-traeger-resource";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth, useSWRSeedFrom } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchHolidayPeriod,
  fetchHolidayPeriods,
  fetchTraegerSettingsSchema,
} from "~/lib/traeger-api";
import { fetchHolidayCriteria } from "~/lib/traeger-holiday-allocation-api";

export function useTraegerHolidayPeriods() {
  const { data: session } = useSession();
  const response = useSWRAuth(
    session?.user.scope === "org" ? traegerKeys.periods() : null,
    fetchHolidayPeriods,
    { keepPreviousData: false },
  );
  const error = useSwrLoadError(
    response.error,
    "die Liste der Ferienzeiträume",
    response.mutate,
  );
  return {
    ...response,
    loadError: metadataLoadError(
      error,
      response.data !== undefined,
      response.error,
    ),
  };
}

export function useTraegerHolidayPeriod(id: string) {
  const periodKey = traegerKeys.period(id);
  const resource = useTraegerResource(
    id ? periodKey : null,
    () => fetchHolidayPeriod(id),
    "die Übersicht des Ferienzeitraums",
  );
  const seedFrom = useSWRSeedFrom();
  const needsPreview = resource.data === null && !resource.failure;
  const preview = useMemo(
    () =>
      needsPreview
        ? seedFrom(traegerKeys.periods(), periodKey, (data: unknown) =>
            traegerKeys.periodPreview(data, id),
          )
        : undefined,
    [needsPreview, seedFrom, periodKey, id],
  );
  return {
    ...resource,
    // Existing metadata consumers use `undefined` as the loading value;
    // `refused` remains the distinct signal for a withdrawn answer.
    data: resource.data ?? undefined,
    // Consumers need the raw, persistent failure to distinguish a refusal
    // from the formatted load error.
    error: resource.failure,
    preview,
    loadError: resource.error,
  };
}

/** The Träger's criteria of the allocation (#4700), highest priority first. */
export function useTraegerHolidayCriteria() {
  const { data: session } = useSession();
  const response = useSWRAuth(
    session?.user.scope === "org" ? traegerKeys.holidayCriteria() : null,
    fetchHolidayCriteria,
    { keepPreviousData: false },
  );
  const error = useSwrLoadError(
    response.error,
    "die Kriterien der Platzvergabe",
    response.mutate,
  );
  return {
    ...response,
    loadError: metadataLoadError(
      error,
      response.data !== undefined,
      response.error,
    ),
  };
}

export function useTraegerSettingsSchema() {
  const { data: session } = useSession();
  const response = useSWRAuth(
    session?.user.scope === "org" ? traegerKeys.settings() : null,
    fetchTraegerSettingsSchema,
    { keepPreviousData: false },
  );
  const error = useSwrLoadError(
    response.error,
    "die Liste der Einstellungen",
    response.mutate,
  );
  return {
    ...response,
    loadError: metadataLoadError(
      error,
      response.data !== undefined,
      response.error,
    ),
  };
}
