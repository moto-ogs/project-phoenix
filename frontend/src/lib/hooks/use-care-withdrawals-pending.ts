"use client";

import { useSession } from "next-auth/react";

import { fetchCareWithdrawals } from "~/lib/care-exit-api";
import { canReviewCareWithdrawals } from "~/lib/change-request-access";
import { useShellAuth } from "~/lib/shell-auth-context";
import { shellResourceKeys } from "~/lib/swr/shell-keys";
import { useUnreadCount, type UseUnreadCountResult } from "./use-unread-count";
import { CHANGE_REQUESTS_REFRESH_EVENT } from "~/lib/change-requests-refresh";

export function useCareWithdrawalsPending(): UseUnreadCountResult {
  const { data: session, status } = useSession();
  const { mode } = useShellAuth();
  const accountId = session?.user?.id;
  return useUnreadCount(
    accountId ? shellResourceKeys.careWithdrawalsPending(accountId) : null,
    {
      enabled:
        status === "authenticated" &&
        mode === "teacher" &&
        !!accountId &&
        canReviewCareWithdrawals(session),
      fetcher: async () => (await fetchCareWithdrawals({ pageSize: 1 })).total,
      eventNames: [CHANGE_REQUESTS_REFRESH_EVENT],
      eventDebounceMs: 500,
      refetchOnFocus: true,
    },
  );
}
