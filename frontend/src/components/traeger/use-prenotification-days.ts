"use client";

// Die Vorabankündigung des Gläubigers in Tagen (#4695): Laufseite,
// Freigabefrage und Fälligkeiten nennen damit den ersten erlaubten Tag einer
// Abbuchung.

import { useTraegerResource } from "./use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { fetchSepaCreditor } from "~/lib/traeger-sepa-api";

/**
 * The creditor's pre-notification days; null while unknown, while `enabled`
 * is false, or when the read fails: the screens then name the rule without
 * its days, and nothing on the page depends on the number.
 */
export function usePrenotificationDays(enabled = true): number | null {
  const creditor = useTraegerResource(
    enabled ? traegerKeys.sepaCreditor() : null,
    fetchSepaCreditor,
    "die Angaben des Gläubigers",
  ).data;
  return creditor?.prenotificationDays ?? null;
}
