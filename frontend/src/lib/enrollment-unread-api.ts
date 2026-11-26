"use client";

/**
 * Ungelesene Anmeldungen (#3778): der Zähler und sein Neu-zählen-Auslöser.
 * Eigenes kleines Modul, weil Seitenleiste und mobiles Menü auf jeder Seite
 * geladen sind und nicht die ganze Anmeldungs-API mitziehen sollen.
 */

import { bffJson } from "~/lib/bff-fetch";
import { mutate } from "~/lib/swr";
import { shellResourceKeys } from "~/lib/swr/shell-keys";

/**
 * Jeder Schlüssel des Zählers: useEnrollmentsUnread hängt das Konto an,
 * useSWRAuth stellt die Schule davor.
 */
function isEnrollmentsUnreadKey(key: unknown): boolean {
  return (
    typeof key === "string" &&
    key.includes(`${shellResourceKeys.enrollmentsUnreadPrefix}:`)
  );
}

/**
 * Lässt das Anmeldungen-Badge neu zählen: ein Request je Konto, egal wie
 * viele Stellen den Zähler gerade zeigen (#4989). Ein Ereignis je Stelle
 * hätte jede einzeln laden lassen.
 */
export function announceEnrollmentReadChange() {
  void mutate(isEnrollmentsUnreadKey);
}

/**
 * Ungelesene Anmeldungen der Person; 0 bei Fehlern oder ohne Recht.
 * Bewusst still: das Badge lädt ohne Handlung der Person (kein Toast ohne
 * Handlung, #2501), 0 blendet es nur aus. Der Bereich selbst zeigt seine
 * Ladefehler vor Ort.
 */
export async function fetchUnreadEnrollmentCount(): Promise<number> {
  try {
    const counts = await bffJson(
      "tenant",
      "GET /api/enrollment/admin/requests/unread-count",
    );
    return counts?.unread_count ?? 0;
  } catch {
    return 0;
  }
}
