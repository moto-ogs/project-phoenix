// Per-offering booking summary for the ADMIN flows (#2186). Capacity and
// availability rules are enforced on save; without this the only way an admin
// learns an offering is full is the error message after submitting a whole
// manual enrollment.
//
// Aggregate-only by design: counts per grade level, never child identities.

import { bffJson } from "~/lib/bff-fetch";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";

/**
 * Loads booking stats for every offering of a phase. Returns them keyed by
 * offering id, which is how every consumer looks them up. `booked` is the
 * peak number of children holding a slot at the same time inside the
 * phase's remaining service window, the number the backend capacity gate
 * compares against `capacity` (absent without a limit) when a booking is
 * saved.
 */
export async function fetchCareOfferingBookingStats(
  phaseId: string,
): Promise<
  Record<string, enrollmentContract.CareOfferingBookingStatsResponse>
> {
  const list = await bffJson(
    "tenant",
    "GET /api/enrollment/care-offerings/booking-stats",
    {
      query: { phase_id: phaseId },
      errorMessage: "Belegung konnte nicht geladen werden",
    },
  );
  return mapCareOfferingBookingStats(list);
}

export function mapCareOfferingBookingStats(
  list: readonly enrollmentContract.CareOfferingBookingStatsResponse[],
) {
  return Object.fromEntries(list.map((entry) => [entry.offering_id, entry]));
}

/**
 * German one-liner for an offering's occupancy, e.g. "18 von 20 Plätzen
 * belegt". Returns null when there is nothing informative to show, so callers
 * render no line at all rather than an empty one.
 */
export function formatOfferingOccupancy(
  stats: enrollmentContract.CareOfferingBookingStatsResponse | null | undefined,
): string | null {
  if (!stats) return null;
  if (stats.capacity == null) {
    return stats.booked > 0
      ? `${stats.booked} gebucht · unbegrenzte Plätze`
      : "Unbegrenzte Plätze";
  }
  if (stats.booked >= stats.capacity) {
    return `Ausgebucht (${stats.booked} von ${stats.capacity} Plätzen belegt)`;
  }
  return `${stats.booked} von ${stats.capacity} Plätzen belegt`;
}

/** True when one more booking would exceed the offering's capacity. */
export function offeringIsFull(
  stats: enrollmentContract.CareOfferingBookingStatsResponse | null | undefined,
): boolean {
  return offeringOccupancy(stats)?.full ?? false;
}

/** An offering's occupancy for the list displays (#4782). */
export interface OfferingOccupancy {
  booked: number;
  /** null: the offering has no capacity limit. */
  capacity: number | null;
  /**
   * Places still free, never negative: a booking kept under Bestandsschutz
   * can push `booked` above a lowered capacity. null without a limit.
   */
  free: number | null;
  full: boolean;
}

/** Occupancy of one offering; null while its stats are not loaded. */
export function offeringOccupancy(
  stats:
    | { readonly booked: number; readonly capacity?: number | null }
    | null
    | undefined,
): OfferingOccupancy | null {
  if (!stats) return null;
  const capacity = stats.capacity ?? null;
  if (capacity == null) {
    return { booked: stats.booked, capacity: null, free: null, full: false };
  }
  return {
    booked: stats.booked,
    capacity,
    free: Math.max(0, capacity - stats.booked),
    full: stats.booked >= capacity,
  };
}

/**
 * Free places summed over the active offerings that have a capacity limit:
 * an inactive offering cannot be booked, so its places are not free. null
 * when none has a limit, or when the stats of one of them are missing: an
 * incomplete sum would read as fewer free places than there are.
 */
export function totalFreePlaces(
  offerings: readonly {
    readonly id: string;
    readonly capacity?: number | null;
    readonly is_active: boolean;
  }[],
  statsById: Readonly<
    Record<string, enrollmentContract.CareOfferingBookingStatsResponse>
  >,
): number | null {
  let total = 0;
  let limited = false;
  for (const offering of offerings) {
    if (!offering.is_active || offering.capacity == null) continue;
    const free = offeringOccupancy(statsById[offering.id])?.free;
    if (free == null) return null;
    limited = true;
    total += free;
  }
  return limited ? total : null;
}
