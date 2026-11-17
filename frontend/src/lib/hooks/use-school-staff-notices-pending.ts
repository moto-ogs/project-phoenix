"use client";

import { useSession } from "next-auth/react";
import { schoolStaffNoticesApi } from "~/lib/school-staff-notices-api";
import {
  countPendingAcknowledgements,
  STAFF_NOTICES_REFRESH_EVENT,
  type StaffNotice,
} from "~/lib/staff-notices-api";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useUnreadCount } from "./use-unread-count";

export interface SchoolStaffNoticesPending {
  pendingCount: number;
}

/**
 * Zähler der Tagesinformationen in moto schule (#2208): heutige Hinweise der
 * OGS-Leitung, deren Kenntnisnahme verlangt ist und noch fehlt. Dasselbe Maß
 * wie im OGS-Portal — ein Hinweis ohne Pflicht-Kenntnisnahme zählt nicht,
 * sonst stünde die Zahl dauerhaft.
 *
 * Gezählt wird im SWR-Eintrag der heutigen Hinweise, den auch die Seite und
 * die Karte der Klassenansicht lesen. Der Eintrag gehört der Schul-Sitzung
 * (Schule + Konto): die Hülle bleibt über einen Kontowechsel hinweg montiert,
 * zeigt aber nie die Zahl der vorigen Person.
 */
export function useSchoolStaffNoticesPending(): SchoolStaffNoticesPending {
  const { status } = useSession();
  const { unreadCount } = useUnreadCount<StaffNotice[]>(
    shellResourceKeys.schoolNoticesToday(),
    {
      enabled: status === "authenticated",
      fetcher: schoolStaffNoticesApi.fetchTodaysNotices,
      count: countPendingAcknowledgements,
      eventNames: [STAFF_NOTICES_REFRESH_EVENT],
      refetchOnFocus: true,
    },
  );
  return { pendingCount: unreadCount };
}
