"use client";

import { useSession } from "next-auth/react";
import { ABSENCES_REFRESH_EVENT } from "~/lib/absence-helpers";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { useShellAuth } from "~/lib/shell-auth-context";
import { staffAbsenceService } from "~/lib/staff-api";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useModuleBooked } from "~/lib/tenant-context";
import { useUnreadCount, type UseUnreadCountResult } from "./use-unread-count";

// A failure stays a failure (#8268): a 0 would read as „nothing pending“.
async function fetchPendingAbsenceCount(): Promise<number> {
  const rows = await staffAbsenceService.listPending();
  return rows.length;
}

/**
 * Pending-count badge for the Mitarbeiter sidebar item (#1419): open absence
 * requests (status requested + question) across all staff. Gated on
 * vacation:approve — the same permission the backend endpoint requires. No
 * dedicated count endpoint: the pending payload is one tenant's open requests
 * (small), so counting client-side avoids duplicating the permission gate and
 * status-set logic backend-side.
 *
 * Refreshes on staff-absences-refresh (dispatched by the inbox, the staff
 * detail Abwesenheiten tab, and the MA resubmit form) plus on focus.
 */
export function useStaffAbsencesPending(): UseUnreadCountResult {
  const { data: session, status } = useSession();
  const { mode } = useShellAuth();
  const canReview =
    isAdmin(session) || hasPermission(session, "vacation:approve");
  const accountId = session?.user?.id;
  const zeiterfassungBooked = useModuleBooked("zeiterfassung");
  return useUnreadCount(
    accountId ? shellResourceKeys.staffAbsencesPending(accountId) : null,
    {
      // Urlaub und Abwesenheiten des Teams gehören zur Zeiterfassung (#4894).
      enabled:
        status === "authenticated" &&
        mode === "teacher" &&
        zeiterfassungBooked &&
        !!accountId &&
        canReview,
      fetcher: fetchPendingAbsenceCount,
      eventNames: [ABSENCES_REFRESH_EVENT],
      eventDebounceMs: 500,
    },
  );
}
