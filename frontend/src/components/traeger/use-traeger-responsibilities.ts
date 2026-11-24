"use client";

import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchResponsibilities } from "~/lib/traeger-responsibilities-api";
import { useTraegerResource } from "./use-traeger-resource";

/**
 * Who is responsible at the schools of the Träger, with the stored
 * Schulträger and Gemeinde (#4811). The read shows bank accounts, so the
 * server logs it; like every Träger read it does not read again on focus.
 */
export function useTraegerResponsibilities() {
  return useTraegerResource(
    traegerKeys.responsibilities(),
    fetchResponsibilities,
    "die Zuständigkeiten der Schulen",
  );
}
