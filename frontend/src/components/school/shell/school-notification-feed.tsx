"use client";

// Die Glocke von moto schule (#7139): derselbe Benachrichtigungs-Feed des
// Kontos wie im Staff-Portal, über die Routen des Schulportals und mit dessen
// Links. Der Anbieter umschließt Kopfzeile und Vollbild-Blatt der Hülle.

import { useSession } from "next-auth/react";
import { useMemo, type ReactNode } from "react";

import {
  type NotificationFeedPortal,
  NotificationFeedPortalProvider,
} from "~/lib/notification-feed-portal";
import { schoolPath } from "~/lib/school-url";

export function SchoolNotificationFeedProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { data: session } = useSession();
  const schoolId = session?.user?.tenantId ?? null;
  const portal = useMemo(
    (): NotificationFeedPortal => ({
      apiBase: "/api/school/notifications/feed",
      keyScope: "school",
      resolveLink: schoolPath,
      analyticsSchoolId: schoolId === null ? null : String(schoolId),
    }),
    [schoolId],
  );
  return (
    <NotificationFeedPortalProvider value={portal}>
      {children}
    </NotificationFeedPortalProvider>
  );
}
