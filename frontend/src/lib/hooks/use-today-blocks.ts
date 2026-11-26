"use client";

import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { timetableOperationsApi } from "~/lib/timetable-operations-api";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";

/** Alle fünf Minuten neu: Blöcke starten, enden und fallen aus. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * Die Blöcke des heutigen Tages laut Plan, ohne Kinderlisten (#2180, #8134).
 *
 * „Betreuungsplan heute“, „Mein Tag“ und die Jetzt-Zone lesen dieselbe
 * Abfrage unter demselben Schlüssel: stehen mehrere davon auf der Startseite,
 * fragt sie den Server nur einmal.
 *
 * Bewusst `scope: "day"` statt des Standardfensters: das liefert nur, was in
 * den nächsten 15 Minuten beginnt, und lässt einen gerade laufenden Block
 * ganz weg. Bewusst ohne Kinderlisten: die Startseite ist eine Übersicht,
 * und die Namen gehören in den Termin (GDPR).
 */
export function useTodayBlocks({
  enabled = true,
}: { readonly enabled?: boolean } = {}) {
  return useSWRAuth<PlannedTimetableInstance[]>(
    enabled ? homeKeys.dayFlow() : null,
    () =>
      timetableOperationsApi.plannedNow({ scope: "day", includeRoster: false }),
    { refreshInterval: REFRESH_MS },
  );
}
