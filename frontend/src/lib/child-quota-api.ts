/**
 * Kinderkontingent der eigenen Schule für die Datenverwaltung (#3569). Die
 * Zahlen tragen die Namen der 409-Details (students.child_quota_reached).
 */

import { bffJson } from "~/lib/bff-fetch";
import type * as studentsContract from "~/lib/contract/students.generated";

/** Kinderkontingent (booked) und Kontingentzahl (occupied) der Schule. */
export interface ChildQuota {
  readonly booked: number;
  readonly occupied: number;
}

/** Wandelt die Backend-Antwort; ohne Kinderkontingent null. */
function mapChildQuota(
  response: studentsContract.childQuotaResponse | null,
): ChildQuota | null {
  if (
    response?.limited !== true ||
    typeof response.booked_places !== "number" ||
    typeof response.occupied_places !== "number"
  ) {
    return null;
  }
  return {
    booked: response.booked_places,
    occupied: response.occupied_places,
  };
}

export async function fetchChildQuota(): Promise<ChildQuota | null> {
  return mapChildQuota(
    await bffJson("tenant", "GET /api/students/child-quota"),
  );
}
