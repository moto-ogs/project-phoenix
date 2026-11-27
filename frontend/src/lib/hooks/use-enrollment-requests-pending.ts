"use client";

import { useSession } from "next-auth/react";
import { canReviewEnrollmentChangeRequests } from "~/lib/change-request-access";
import { fetchPendingEnrollmentChangeRequestCount } from "~/lib/change-request-list-api";
import { CHANGE_REQUESTS_REFRESH_EVENT } from "~/lib/change-requests-refresh";
import { useShellAuth } from "~/lib/shell-auth-context";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useModuleBooked } from "~/lib/tenant-context";
import { useUnreadCount, type UseUnreadCountResult } from "./use-unread-count";

/**
 * Zähler der offenen Anmeldungsänderungen für das Badge am Anfragen-Eintrag
 * (#2435). Er kommt zu den vier Kinderdaten-Arten und den Abwesenheiten hinzu,
 * hat aber ein eigenes Recht (config:manage) und deshalb einen eigenen Hook —
 * wer die Art nicht entscheiden darf, zählt sie auch nicht mit.
 *
 * Gezählt wird in der Datenbank, nicht die Länge einer geladenen Seite: sonst
 * stünde ab der Seitengröße dauerhaft dieselbe Zahl im Badge, egal wie viel
 * wirklich wartet.
 */
export function useEnrollmentRequestsPending(): UseUnreadCountResult {
  const { data: session, status } = useSession();
  const { mode } = useShellAuth();
  const accountId = session?.user?.id;
  const onlineAnmeldungBooked = useModuleBooked("online_anmeldung");
  return useUnreadCount(
    accountId ? shellResourceKeys.enrollmentRequestsPending(accountId) : null,
    {
      // Änderungen an Anmeldungen gibt es nur mit Online-Anmeldung (#4894).
      enabled:
        status === "authenticated" &&
        mode === "teacher" &&
        onlineAnmeldungBooked &&
        !!accountId &&
        canReviewEnrollmentChangeRequests(session),
      fetcher: fetchPendingEnrollmentChangeRequestCount,
      eventNames: [CHANGE_REQUESTS_REFRESH_EVENT],
      eventDebounceMs: 500,
    },
  );
}
