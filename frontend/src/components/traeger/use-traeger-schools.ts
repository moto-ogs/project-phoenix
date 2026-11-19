"use client";

import { useTraegerResource } from "./use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchTraegerSchools } from "~/lib/traeger-api";

/** Shared school metadata, never school sessions or person data. */
export function useTraegerSchools() {
  const resource = useTraegerResource(
    traegerKeys.schools(),
    fetchTraegerSchools,
    "die Liste der Schulen",
    { keepPreviousData: false, revalidateIfStale: false },
  );
  return {
    schools: resource.data,
    error: resource.error,
    fetchError: resource.failure,
    refused: resource.refused,
    mutate: resource.mutate,
  };
}
