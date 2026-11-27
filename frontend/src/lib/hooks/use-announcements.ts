"use client";

import { announcementKeys } from "~/lib/swr/shell-keys";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { LIVE_RECONCILE_INTERVAL_MS, useSWRAuth } from "~/lib/swr";
import { bffJson } from "~/lib/bff-fetch";
import type * as platformContract from "~/lib/contract/platform.generated";

async function fetchUnread(): Promise<
  platformContract.PlatformAnnouncementResponse[]
> {
  return bffJson("tenant", "GET /api/platform/announcements/unread");
}

/** Records that the person saw the announcement (`seen_at`, #7555). */
async function markSeen(id: string): Promise<void> {
  await bffJson("tenant", "POST /api/platform/announcements/{id}/seen", {
    params: { id },
  });
}

async function markDismissed(id: string): Promise<void> {
  await bffJson("tenant", "POST /api/platform/announcements/{id}/dismiss", {
    params: { id },
  });
}

export function useAnnouncements() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  const { data, mutate, isLoading } = useSWRAuth(
    announcementKeys.unread(),
    fetchUnread,
    {
      keepPreviousData: false,
      // No SSE event announces them; every route change refetches below, so
      // an idle tab only reconciles every five minutes (#5017).
      refreshInterval: LIVE_RECONCILE_INTERVAL_MS,
      revalidateOnFocus: false, // Don't revalidate on window focus to avoid showing dismissed items again
      // The scoped shell already seeded the opening document. With no
      // seed SWR still loads on mount; explicit refresh always reads anew.
      revalidateIfStale: false,
      dedupingInterval: 5000, // Prevent rapid refetches
    },
  );

  // Revalidate on route change (since component stays mounted in layout)
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    // Route changes reuse this layout. Fetch after the next paint, so an
    // unread notice cannot make the incoming page do another render first.
    let task: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      task = setTimeout(() => void mutate(), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(task);
    };
  }, [pathname, mutate]);

  return {
    announcements: data ?? [],
    isLoading,
    dismiss: markDismissed,
    markSeen,
    refresh: () => mutate(),
  };
}
