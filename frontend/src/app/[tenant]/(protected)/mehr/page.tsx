"use client";

import { Suspense, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { LogoutModal } from "~/components/auth/logout-modal";
import {
  MobileNavIcon,
  useStaffBottomNavModel,
  type StaffBottomNavModel,
} from "~/components/dashboard/mobile-bottom-nav";
import {
  NOTIFICATIONS_BADGE_MAX,
  useOpenNotificationsSheet,
} from "~/components/dashboard/header/notifications-sheet-state";
import {
  STAFF_NEWS_TITLE,
  StaffNewsList,
} from "~/components/dashboard/header/staff-news-button";
import { UnreadBadge } from "~/components/messaging/unread-badge";
import { ListRowLink } from "~/components/ui/list-row-link";
import { ModuleLockMark } from "~/components/ui/module-lock-mark";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useDeviceContext } from "~/lib/device-context";
import { logoutConcept } from "~/lib/concepts/logout";
import { ENROLLMENT_SECTION } from "~/lib/section-navigation";
import { useTenantRouter } from "~/lib/tenant-router";

/**
 * „Mehr“ als eigene Seite (Prototyp #8070, offener Produktentscheid 2):
 * In der App öffnet der Reiter „Mehr“ diese Wurzelseite statt des Blatts
 * mit der Seitenleiste. Oben die Abläufe des Betreuungsalltags, darunter die
 * Gruppen der Seitenleiste, am Ende Konto und Abmelden.
 *
 * Dieselbe Datenquelle wie Pill und Blatt (`useStaffBottomNavModel`), also
 * dieselben Rechte-, Modul- und Schulschalter-Regeln; was in der Pill steht,
 * fehlt hier. Auf dem Desktop gibt es die Seite nicht: dort führt sie zur
 * Startseite, die Seitenleiste bleibt der Weg.
 */

/** Die Abläufe, die Mitarbeitende täglich brauchen: oben, vor den Gruppen. */
const STAFF_FLOW_HREFS: readonly string[] = [
  "/messages",
  "/mein-dienstplan",
  "/calendar",
  "/time-tracking",
  "/absences",
];

type MenuItem = StaffBottomNavModel["displayAdditionalItems"][number];

function MenuRows({
  items,
  model,
}: Readonly<{ items: readonly MenuItem[]; model: StaffBottomNavModel }>) {
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((item) => (
        <li key={item.href}>
          <ListRowLink
            href={model.resolveItemHref(item)}
            className="min-h-14"
            icon={
              <MobileNavIcon
                item={item}
                active={false}
                className="h-5 w-5 shrink-0 text-gray-600"
              />
            }
            title={item.label}
            badge={
              item.locked ? (
                <ModuleLockMark />
              ) : item.href === ENROLLMENT_SECTION.href ? (
                <UnreadBadge
                  count={model.enrollmentsUnreadCount}
                  tone="staff"
                  noun="ungelesene Anmeldungen"
                />
              ) : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}

function MorePageContent() {
  const model = useStaffBottomNavModel();
  const openNotificationsSheet = useOpenNotificationsSheet();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { resolved, isApp } = useDeviceContext();
  const router = useTenantRouter();

  // Desktop: keine eigene Seite, die Seitenleiste trägt alle Ziele.
  useEffect(() => {
    if (resolved && !isApp) router.replace("/home");
  }, [resolved, isApp, router]);

  const flows = STAFF_FLOW_HREFS.flatMap((href) => {
    const item = model.displayAdditionalItems.find(
      (candidate) => candidate.href === href,
    );
    return item ? [item] : [];
  });
  const flowHrefs = new Set(flows.map((item) => item.href));
  const groups = model.visibleDrawerGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !flowHrefs.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <TenantPage
      title="Mehr"
      overlays={
        <LogoutModal isOpen={logoutOpen} onClose={() => setLogoutOpen(false)} />
      }
    >
      {/* Hierher führt der rote Zähler am Reiter „Mehr“. */}
      {model.mode === "teacher" && model.staffNews.length > 0 ? (
        <SectionCard title={STAFF_NEWS_TITLE}>
          <StaffNewsList items={model.staffNews} />
        </SectionCard>
      ) : null}
      {flows.length > 0 ? (
        <SectionCard title="Mein Tag" flush>
          <MenuRows items={flows} model={model} />
        </SectionCard>
      ) : null}
      {groups.map((group) => (
        <SectionCard
          key={group.key}
          title={group.group?.label ?? "Weiteres"}
          flush
        >
          <MenuRows items={group.items} model={model} />
        </SectionCard>
      ))}
      <SectionCard title="Konto" flush>
        <ul className="divide-y divide-gray-100">
          {model.mode === "teacher" ? (
            <li>
              <ListRowLink
                onClick={openNotificationsSheet}
                className="min-h-14"
                icon={
                  <Bell
                    className="h-5 w-5 shrink-0 text-gray-600"
                    aria-hidden="true"
                  />
                }
                title="Benachrichtigungen"
                badge={
                  <NotificationBadge
                    count={model.feedUnreadCount}
                    tone="red"
                    size="md"
                    max={NOTIFICATIONS_BADGE_MAX}
                    ariaLabel={`${model.feedUnreadCount} neue Hinweise`}
                  />
                }
              />
            </li>
          ) : null}
          {model.profileUrl ? (
            <li>
              <ListRowLink
                href={model.tenantPath(model.profileUrl)}
                className="min-h-14"
                icon={
                  <MobileNavIcon
                    item={{ iconKey: "profile" }}
                    active={false}
                    className="h-5 w-5 shrink-0 text-gray-600"
                  />
                }
                title="Profil"
              />
            </li>
          ) : null}
          <li>
            <ListRowLink
              onClick={() => setLogoutOpen(true)}
              className="min-h-14"
              chevron={false}
              icon={
                <MobileNavIcon
                  item={{ iconKey: "profile", concept: logoutConcept }}
                  active={false}
                  className="h-5 w-5 shrink-0 text-gray-600"
                />
              }
              title="Abmelden"
            />
          </li>
        </ul>
      </SectionCard>
    </TenantPage>
  );
}

export default function MorePage() {
  // `useSearchParams` im Navigationsmodell braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={null}>
      <MorePageContent />
    </Suspense>
  );
}
