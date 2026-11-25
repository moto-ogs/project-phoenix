"use client";

import { parentKeys } from "~/lib/swr/parent-keys";
import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import { useSWRCacheKey } from "~/lib/swr";
import { ParentPageSkeleton } from "~/components/parent/parent-page";

import { useParentChildren } from "~/lib/hooks/use-parent-resources";
import { useParentMealPlanEnabled } from "~/lib/hooks/use-parent-meal-plan-enabled";
import { useParentMessagesUnread } from "~/lib/hooks/use-parent-messages-unread";
import { useParentNewsEnabled } from "~/lib/hooks/use-parent-news-enabled";
import { useParentNewsUnread } from "~/lib/hooks/use-parent-news-unread";
import { Header } from "~/components/dashboard/header";
import { DemoBanner, isDemoBannerShown } from "~/components/demo/demo-banner";
import { useDemoEveningActive } from "~/components/demo/demo-evening-notice";
import { PortalShell } from "~/components/ui/portal-shell";

import { ParentBottomNav } from "./parent-bottom-nav";
import { ParentSettingsReturnPathMemory } from "./parent-settings-nav";
import { ParentSidebar } from "./parent-sidebar";
import { ParentFirstSteps } from "~/components/parent/onboarding/parent-first-steps";
import { useShellAuth } from "~/lib/shell-auth-context";
import { ParentCareTermScope } from "~/lib/parent-care-term";
import { MobilePageHelpPortal } from "~/components/help/mobile-page-help-portal";
import {
  ParentNotificationsBell,
  useParentNotificationsUnread,
} from "~/components/parent/notifications/parent-notifications-bell";
import { ParentNotificationsSheet } from "~/components/parent/notifications/parent-notifications-sheet";

/**
 * Die Huelle der Eltern-App.
 *
 * Loest die geteilte AppShell des Personal-Portals ab; den Rahmen liefert
 * die geteilte `PortalShell`. Zaehler und
 * Sichtbarkeiten werden hier einmal geladen und an beide Navigationen
 * gereicht; die Navigationen selbst holen keine Daten.
 */
export function ParentShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const tNav = useTranslations("parentNav");
  const shellAuth = useShellAuth();
  const { status } = shellAuth;
  const authenticated = status === "authenticated";
  const { unreadCount: messagesUnread } =
    useParentMessagesUnread(authenticated);
  const { unreadCount: newsOpen } = useParentNewsUnread(authenticated);
  const { unreadCount: noticesUnread } =
    useParentNotificationsUnread(authenticated);
  const { data: linkedChildren, accessVersions } =
    useParentChildren(authenticated);
  const scoped = useSWRCacheKey();
  const identity = scoped("");
  // Each child with its access, sorted: a new order of the roster (a name
  // corrected) is no change, a swap of two children's access is.
  const relationships = linkedChildren
    ? `${parentKeys.relationshipSet(linkedChildren)}|${linkedChildren
        .map(
          (child) =>
            `${child.student_id}=${accessVersions?.[child.student_id] ?? ""}`,
        )
        .sort()
        .join(",")}`
    : null;
  // A changed set of children (a relationship ended or began) or a changed
  // access of one (a permission withdrawn while the child stays linked)
  // discards the pages below, also those React keeps hidden, with their
  // drafts. Account and school changes discard the whole portal tree
  // (SessionTreeBoundary).
  const [contentEpoch, setContentEpoch] = useState({
    relationships,
    revision: 0,
  });
  if (
    contentEpoch.relationships !== null &&
    contentEpoch.relationships !== relationships
  ) {
    setContentEpoch({
      relationships,
      revision: contentEpoch.revision + 1,
    });
  } else if (relationships !== null && contentEpoch.relationships === null) {
    setContentEpoch({ ...contentEpoch, relationships });
  }
  const newsEnabled = useParentNewsEnabled(
    authenticated,
    linkedChildren ?? null,
  );
  const mealPlanEnabled = useParentMealPlanEnabled(
    authenticated,
    linkedChildren ?? null,
  );

  const badges = {
    messages: messagesUnread,
    news: newsOpen,
    notifications: noticesUnread,
  };
  const gates = { news: newsEnabled, mealPlan: mealPlanEnabled };
  const childCount = linkedChildren?.length ?? 0;
  // Öffentliche Demo (#3468): derselbe feste Streifen wie in der OGS-App
  // (h-12). Kopfzeile und Seitennavigation rücken um seine Höhe nach unten.
  const demoBannerShown = isDemoBannerShown(shellAuth);
  // Abends liegt unter dem Demo-Streifen eine Hinweiszeile (h-8, #3921).
  const eveningRow = useDemoEveningActive() && demoBannerShown;

  return (
    // Texte ohne Kindbezug nennen die Betreuung wie die Schulen des Kontos
    // (#6082); die Kinderbereiche setzen den Begriff ihres Kindes darüber.
    <ParentCareTermScope enabled={authenticated}>
      <div
        className={eveningRow ? "pt-20" : demoBannerShown ? "pt-12" : undefined}
      >
        <MobilePageHelpPortal>
          <PortalShell
            header={
              <Header
                notificationBell={
                  authenticated ? <ParentNotificationsBell /> : undefined
                }
              />
            }
            headerClassName={
              eveningRow
                ? "sticky top-20 z-50 hidden lg:block"
                : demoBannerShown
                  ? "sticky top-12 z-50 hidden lg:block"
                  : "sticky top-0 z-50 hidden lg:block"
            }
            backgroundClassName="moto-dotted-background--parent"
            skipLinkLabel={tNav("skipToContent")}
            topLayer={
              <>
                {demoBannerShown ? <DemoBanner /> : null}
                <div
                  data-parent-safe-area-top
                  className="relative z-10 h-[env(safe-area-inset-top)] min-h-8 bg-transparent lg:hidden"
                  aria-hidden="true"
                />
              </>
            }
            sidebar={
              <ParentSidebar
                badges={badges}
                gates={gates}
                childCount={childCount}
                demoBannerShown={demoBannerShown}
                eveningRow={eveningRow}
              />
            }
            bottomNav={
              <ParentBottomNav
                badges={badges}
                gates={gates}
                childCount={childCount}
              />
            }
          >
            <ParentSettingsReturnPathMemory />
            <Fragment key={contentEpoch.revision}>
              {identity === null ? <ParentPageSkeleton rows={2} /> : children}
            </Fragment>
          </PortalShell>
        </MobilePageHelpPortal>
        {authenticated ? <ParentNotificationsSheet /> : null}
        {authenticated && shellAuth.user?.id && linkedChildren ? (
          <ParentFirstSteps
            accountId={shellAuth.user.id}
            childCount={childCount}
            newsEnabled={newsEnabled}
          />
        ) : null}
      </div>
    </ParentCareTermScope>
  );
}
