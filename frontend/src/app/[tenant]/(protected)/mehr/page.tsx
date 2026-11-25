"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
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
import { Collection, CollectionGroup } from "~/components/ui/collection";
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

/** Symbol einer Zeile: dieselbe Größe und Farbe in jeder Zeile. */
const ROW_ICON = "h-5 w-5 shrink-0 text-gray-600";

function MenuRows({
  items,
  model,
}: Readonly<{ items: readonly MenuItem[]; model: StaffBottomNavModel }>) {
  return items.map((item) => (
    <li key={item.href}>
      <ListRowLink
        href={model.resolveItemHref(item)}
        className="min-h-14"
        icon={<MobileNavIcon item={item} active={false} className={ROW_ICON} />}
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
  ));
}

interface MoreSection {
  readonly key: string;
  readonly title: string;
  /** Zahl der Zeilen, für die Verteilung auf Spalten. */
  readonly size: number;
  readonly rows: ReactNode;
}

/**
 * Teilt die Abschnitte in ihrer festen Reihenfolge auf `columns` Spalten
 * auf: die erste Spalte von oben nach unten, dann die nächste. So liest man
 * auf jedem Gerät in derselben Folge wie am Telefon, und die Spalten stehen
 * trotzdem etwa gleich hoch.
 */
function splitColumns(
  sections: readonly MoreSection[],
  columns: number,
): MoreSection[][] {
  // Der Gruppenkopf zählt wie eine knappe Zeile.
  const weight = (section: MoreSection) => section.size + 0.7;
  const total = sections.reduce((sum, section) => sum + weight(section), 0);
  const result: MoreSection[][] = [];
  let current: MoreSection[] = [];
  let filled = 0;
  sections.forEach((section, index) => {
    const remainingColumns = columns - result.length;
    const remainingSections = sections.length - index;
    const target = (total * (result.length + 1)) / columns;
    const half = weight(section) / 2;
    // Neue Spalte, wenn der Abschnitt mehr als zur Hälfte über das Ziel der
    // laufenden Spalte ragt — oder sonst eine Spalte leer bliebe.
    if (
      current.length > 0 &&
      remainingColumns > 1 &&
      (filled + half > target || remainingSections < remainingColumns)
    ) {
      result.push(current);
      current = [];
    }
    current.push(section);
    filled += weight(section);
  });
  if (current.length > 0) result.push(current);
  return result;
}

function MorePageContent() {
  const model = useStaffBottomNavModel();
  const openNotificationsSheet = useOpenNotificationsSheet();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const { resolved, isApp, layout, isSplit } = useDeviceContext();
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

  const isTeacher = model.mode === "teacher";
  const news = isTeacher ? model.staffNews : [];

  const sections: MoreSection[] = [];
  // Oben, was auf die Person wartet: Benachrichtigungen mit ihrem Zähler
  // (derselbe rote Zähler steht am Reiter „Mehr“) und die neuen Hinweise
  // zu Kindern.
  if (isTeacher) {
    sections.push({
      key: "neu",
      title: STAFF_NEWS_TITLE,
      size: 1 + news.length * 1.3,
      rows: (
        <>
          <li>
            <ListRowLink
              onClick={openNotificationsSheet}
              className="min-h-14"
              icon={<Bell className={ROW_ICON} aria-hidden="true" />}
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
          {news.length > 0 ? <StaffNewsList items={news} rows /> : null}
        </>
      ),
    });
  }
  if (flows.length > 0) {
    sections.push({
      key: "tag",
      title: "Mein Tag",
      size: flows.length,
      rows: <MenuRows items={flows} model={model} />,
    });
  }
  for (const group of groups) {
    sections.push({
      key: group.key,
      title: group.group?.label ?? "Weiteres",
      size: group.items.length,
      rows: <MenuRows items={group.items} model={model} />,
    });
  }
  if (model.profileUrl) {
    sections.push({
      key: "konto",
      title: "Konto",
      size: 1,
      rows: (
        <li>
          <ListRowLink
            href={model.tenantPath(model.profileUrl)}
            className="min-h-14"
            icon={
              <MobileNavIcon
                item={{ iconKey: "profile" }}
                active={false}
                className={ROW_ICON}
              />
            }
            title="Profil"
          />
        </li>
      ),
    });
  }

  // Abmelden ist kein Ziel, sondern beendet die Sitzung: eigene Karte mit
  // Abstand am Ende, in Warnfarbe.
  const logout = (
    <Collection label="Abmelden">
      <ul>
        <li>
          <ListRowLink
            onClick={() => setLogoutOpen(true)}
            className="min-h-14"
            chevron={false}
            icon={
              <MobileNavIcon
                item={{ iconKey: "profile", concept: logoutConcept }}
                active={false}
                className="text-moto-red-strong h-5 w-5 shrink-0"
              />
            }
            title={<span className="text-moto-red-strong">Abmelden</span>}
          />
        </li>
      </ul>
    </Collection>
  );

  const group = (section: MoreSection, sticky = true) => (
    <CollectionGroup key={section.key} title={section.title} sticky={sticky}>
      {section.rows}
    </CollectionGroup>
  );

  // Telefon: EINE Liste, die Abschnitte als Gruppenköpfe darin. iPad: die
  // Abschnitte als Karten in zwei (hoch) oder drei (quer) Spalten, damit
  // keine Zeile 750–1100 px breit wird und der Pfeil nah am Text steht.
  const columns = layout === "tablet" ? (isSplit ? 3 : 2) : 1;

  return (
    <TenantPage
      title="Mehr"
      overlays={
        <LogoutModal isOpen={logoutOpen} onClose={() => setLogoutOpen(false)} />
      }
    >
      {columns === 1 ? (
        <div className="flex flex-col gap-6">
          <Collection label="Mehr">
            {sections.map((section) => group(section))}
          </Collection>
          {logout}
        </div>
      ) : (
        <div
          className={`grid items-start gap-4 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          {splitColumns(sections, columns).map((column, index, all) => (
            <div key={column[0]?.key} className="flex flex-col gap-4">
              {column.map((section) => (
                <Collection key={section.key} label={section.title}>
                  {group(section, false)}
                </Collection>
              ))}
              {index === all.length - 1 ? (
                <div className="mt-2">{logout}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
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
