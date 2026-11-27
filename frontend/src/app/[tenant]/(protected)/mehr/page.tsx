"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Bell, RotateCw, Search } from "lucide-react";
import { useInvalidateMatching } from "~/lib/swr";
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
import { SchoolSearchSlot } from "~/components/search/school-search-slot";
import { SpinnerIcon } from "~/components/ui/icons";
import { ListRowLink } from "~/components/ui/list-row-link";
import { ModuleLockMark } from "~/components/ui/module-lock-mark";
import { NotificationBadge } from "~/components/ui/notification-badge";
import { Button } from "~/components/ui/button";
import { Collection, CollectionGroup } from "~/components/ui/collection";
import { TenantPage } from "~/components/ui/tenant-page";
import { useDeviceContext } from "~/lib/device-context";
import { logoutConcept } from "~/lib/concepts/logout";
import { ENROLLMENT_SECTION } from "~/lib/section-navigation";
import { useTenantRouter } from "~/lib/tenant-router";
import { isDemoBuild } from "~/lib/demo-access";
import { useShellAuth } from "~/lib/shell-auth-context";
import { useCareWithdrawalsPending } from "~/lib/hooks/use-care-withdrawals-pending";
import { useChangeRequestsPending } from "~/lib/hooks/use-change-requests-pending";
import { useEnrollmentRequestsPending } from "~/lib/hooks/use-enrollment-requests-pending";
import { useMessagesUnread } from "~/lib/hooks/use-messages-unread";
import { useStaffAbsencesPending } from "~/lib/hooks/use-staff-absences-pending";
import { useStaffMessagesUnread } from "~/lib/hooks/use-staff-messages-unread";
import { useStaffNoticesPending } from "~/lib/hooks/use-staff-notices-pending";

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
// Runde 13: „Nachrichten“ bleibt in der Gruppe „Eltern“ wie in der
// Seitenleiste; oben gezogen ließ es die Gruppe leer, und „Eltern“ fehlte.
const STAFF_FLOW_HREFS: readonly string[] = [
  // Runde 11: Der Notfall stand ganz unten unter „Weiteres“; im Ernstfall
  // muss er ohne Suchen erreichbar sein. Runde 17: erste Zeile von „Mein
  // Tag“, rot hervorgehoben.
  "/emergency",
  "/mein-dienstplan",
  "/calendar",
  "/time-tracking",
  "/absences",
];

type MenuItem = StaffBottomNavModel["displayAdditionalItems"][number];

/**
 * Zähler an den Zeilen wie in der Seitenleiste des Desktops (#8070, Runde 7):
 * offene Anfragen, ungelesene Nachrichten (Eltern, Team-Chat) und offene
 * Hinweise der Leitung. Dieselben Quellen und Vorlesetexte wie dort.
 */
interface RowCounter {
  readonly count: number;
  readonly one: string;
  readonly noun: string;
}

function useRowCounters(): Readonly<Record<string, RowCounter>> {
  const { unreadCount: absences } = useStaffAbsencesPending();
  const { unreadCount: messages } = useMessagesUnread();
  const { unreadCount: teamChat } = useStaffMessagesUnread();
  const { unreadCount: notices } = useStaffNoticesPending();
  const { unreadCount: changeRequests } = useChangeRequestsPending();
  const { unreadCount: enrollmentRequests } = useEnrollmentRequestsPending();
  const { unreadCount: withdrawals } = useCareWithdrawalsPending();
  return {
    "/anfragen": {
      count: absences + changeRequests + enrollmentRequests + withdrawals,
      one: "offene Anfrage",
      noun: "offene Anfragen",
    },
    "/messages": {
      count: messages,
      one: "ungelesene Nachricht",
      noun: "ungelesene Nachrichten",
    },
    "/team-chat": {
      count: teamChat,
      one: "ungelesene Nachricht im Team-Chat",
      noun: "ungelesene Nachrichten im Team-Chat",
    },
    "/tagesinformationen": {
      count: notices,
      one: "offener Hinweis der Leitung",
      noun: "offene Hinweise der Leitung",
    },
  };
}

/** Symbol einer Zeile: dieselbe Größe und Farbe in jeder Zeile. */
const ROW_ICON = "h-5 w-5 shrink-0 text-gray-600";

/**
 * Zeilenhöhe (Runde 17): 56 px, am kleinen Telefon (SE, flacher als
 * 760 px) 44 px, damit acht Einträge ins erste Bild passen. Die
 * Trefferfläche bleibt über 44 px.
 */
const ROW_HEIGHT =
  "min-h-14 [@media(max-height:760px)]:min-h-11 [@media(max-height:760px)]:py-2.5";

/**
 * Eine Regel für alle Zähler (Runde 17): Blau zählt, was neu oder offen
 * ist (Benachrichtigungen, Anfragen, Nachrichten, Hinweise). Rot steht nur
 * für Dringendes, darum hier keine rote Zahl.
 */
const COUNT_TONE = "blue" as const;

/** Der Notfall fällt auf (Runde 17, 19): rotes Symbol und rotes Wort. */
const EMERGENCY_HREF = "/emergency";

function MenuRows({
  items,
  model,
  counters,
}: Readonly<{
  items: readonly MenuItem[];
  model: StaffBottomNavModel;
  counters: Readonly<Record<string, RowCounter>>;
}>) {
  return items.map((item) => {
    const counter = counters[item.href];
    const emergency = item.href === EMERGENCY_HREF;
    return (
      <li key={item.href}>
        <ListRowLink
          href={model.resolveItemHref(item)}
          className={ROW_HEIGHT}
          icon={
            // Runde 19: Der Notfall steht in derselben Symbolspalte wie
            // jede Zeile; er fällt durch Rot in Symbol und Wort auf.
            <MobileNavIcon
              item={item}
              active={false}
              className={
                emergency ? "text-moto-red-strong h-5 w-5 shrink-0" : ROW_ICON
              }
            />
          }
          title={
            emergency ? (
              <span className="text-moto-red-strong font-semibold">
                {item.label}
              </span>
            ) : (
              item.label
            )
          }
          badge={
            item.locked ? (
              <ModuleLockMark />
            ) : item.href === ENROLLMENT_SECTION.href ? (
              <UnreadBadge
                count={model.enrollmentsUnreadCount}
                tone="parents"
                noun="ungelesene Anmeldungen"
              />
            ) : counter && counter.count > 0 ? (
              // Eine Farbe für „ungelesen/offen“ (Runde 11, 17): Blau.
              <UnreadBadge
                count={counter.count}
                tone="parents"
                noun={counter.count === 1 ? counter.one : counter.noun}
              />
            ) : undefined
          }
        />
      </li>
    );
  });
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
  const counters = useRowCounters();
  // „Daten aktualisieren“ steht am Desktop in der Kopfzeile, die das Telefon
  // nicht hat (#8070, Runde 7): dieselbe Wirkung als Zeile.
  const invalidate = useInvalidateMatching();
  const [refresh, setRefresh] = useState<"idle" | "busy" | "done">("idle");
  const handleRefresh = () => {
    if (refresh === "busy") return;
    setRefresh("busy");
    void invalidate(() => true).finally(() => {
      setRefresh("done");
      setTimeout(() => setRefresh("idle"), 2000);
    });
  };
  // Name und Adresse wie im Profilmenü des Desktops; die Demo zeigt keine
  // technische Adresse (#3891).
  const { user } = useShellAuth();
  const userEmail = isDemoBuild() ? "" : (user?.email ?? "");

  // Die Lupe im schmalen Kopf tippt das Suchfeld der Kopfkarte an: eine
  // Suche, ein Weg hinein.
  const openSearch = () => {
    document
      .querySelector<HTMLInputElement>(
        '[data-app-page-toolbar] input[aria-haspopup="dialog"]',
      )
      ?.click();
  };

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
  const allGroups = model.visibleDrawerGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !flowHrefs.has(item.href)),
    }))
    .filter((group) => group.items.length > 0);
  // Zeilen ohne Gruppe (Hilfe) stehen unter „Konto“ (Runde 13): ein
  // Abschnitt „Weiteres“ mit einer einzigen Zeile gliederte zu fein.
  const hasAccount = Boolean(model.profileUrl);
  const groups = hasAccount
    ? allGroups.filter((group) => group.group != null)
    : allGroups;
  const looseItems = hasAccount
    ? allGroups
        .filter((group) => group.group == null)
        .flatMap((group) => group.items)
    : [];

  const isTeacher = model.mode === "teacher";
  const news = isTeacher ? model.staffNews : [];

  const sections: MoreSection[] = [];
  // Oben, was auf die Person wartet: die neuen Hinweise zu Kindern, einzeln
  // wie im Knopf „Neu für dich“ des Desktops. Die Benachrichtigungen sind
  // eine Sammlung (Glocke des Desktops) und stehen darum als erste Zeile
  // von „Mein Tag“, nicht zwischen den einzelnen Hinweisen (Runde 13).
  if (news.length > 0) {
    sections.push({
      key: "neu",
      title: STAFF_NEWS_TITLE,
      size: news.length * 1.3,
      rows: <StaffNewsList items={news} rows />,
    });
  }
  const notificationsRow = isTeacher ? (
    <li>
      <ListRowLink
        onClick={openNotificationsSheet}
        className={ROW_HEIGHT}
        icon={<Bell className={ROW_ICON} aria-hidden="true" />}
        title="Benachrichtigungen"
        badge={
          // Blau wie jeder Zähler auf dieser Seite (Runde 17): neue
          // Hinweise sind nicht dringend.
          <NotificationBadge
            count={model.feedUnreadCount}
            tone={COUNT_TONE}
            size="md"
            max={NOTIFICATIONS_BADGE_MAX}
            ariaLabel={`${model.feedUnreadCount} neue Hinweise`}
          />
        }
      />
    </li>
  ) : null;
  if (flows.length > 0 || notificationsRow) {
    sections.push({
      key: "tag",
      title: "Mein Tag",
      size: flows.length + (notificationsRow ? 1 : 0),
      rows: (
        <>
          {/* Der Notfall vor allem anderen (Runde 17), dann die Glocke. */}
          <MenuRows
            items={flows.filter((item) => item.href === EMERGENCY_HREF)}
            model={model}
            counters={counters}
          />
          {notificationsRow}
          <MenuRows
            items={flows.filter((item) => item.href !== EMERGENCY_HREF)}
            model={model}
            counters={counters}
          />
        </>
      ),
    });
  }
  for (const group of groups) {
    sections.push({
      key: group.key,
      title: group.group?.label ?? "Weiteres",
      size: group.items.length,
      rows: <MenuRows items={group.items} model={model} counters={counters} />,
    });
  }
  // Abmelden ist kein Ziel, sondern beendet die Sitzung: letzte Zeile, in
  // Warnfarbe. Runde 13: in der Karte „Konto“ statt als eigene Karte.
  const logoutRow = (
    <li>
      <ListRowLink
        onClick={() => setLogoutOpen(true)}
        className={ROW_HEIGHT}
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
  );

  if (model.profileUrl) {
    sections.push({
      key: "konto",
      title: "Konto",
      size: 3 + looseItems.length,
      rows: (
        <>
          <li>
            <ListRowLink
              href={model.tenantPath(model.profileUrl)}
              className={ROW_HEIGHT}
              icon={
                <MobileNavIcon
                  item={{ iconKey: "profile" }}
                  active={false}
                  className={ROW_ICON}
                />
              }
              title="Profil"
              subtitle={
                user?.name
                  ? userEmail
                    ? `${user.name} · ${userEmail}`
                    : user.name
                  : undefined
              }
            />
          </li>
          <MenuRows items={looseItems} model={model} counters={counters} />
          <li>
            <ListRowLink
              onClick={handleRefresh}
              className={ROW_HEIGHT}
              chevron={false}
              icon={<RotateCw className={ROW_ICON} aria-hidden="true" />}
              title="Daten aktualisieren"
              // Eine Aktion, kein Ziel (Runde 11): der Satz sagt, was sie tut.
              // Runde 21: ohne das Fachwort „Server“.
              subtitle="Holt alles neu, wenn etwas nicht stimmt"
              meta={
                refresh === "busy" ? (
                  <span role="status" className="inline-flex items-center">
                    <SpinnerIcon className="size-4" />
                    <span className="sr-only">Wird aktualisiert</span>
                  </span>
                ) : refresh === "done" ? (
                  <span role="status">Aktualisiert</span>
                ) : undefined
              }
            />
          </li>
          {logoutRow}
        </>
      ),
    });
  }

  // Ohne Profil (kein Konto-Abschnitt) steht Abmelden allein am Ende.
  const logout = model.profileUrl ? null : (
    <Collection label="Abmelden">
      <ul>{logoutRow}</ul>
    </Collection>
  );

  const group = (section: MoreSection, sticky = false) => (
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
      // Telefon (Runde 9): kein „…“ auf einer Seite, die selbst das Menü
      // ist; der Satz sagt dort nichts, was die Liste nicht zeigt.
      info={
        isApp
          ? undefined
          : "Hier stehen alle Bereiche, die nicht in der unteren Leiste sind, dazu dein Profil und Abmelden."
      }
      // Wiedererkennbar: „Überall suchen“ stand im heutigen Blatt „Mehr“
      // ganz oben; am Telefon trägt sonst keine Kopfkarte die Suche.
      searchSlot={<SchoolSearchSlot placement="moreSheet" />}
      // Runde 19: Wie auf den anderen Seiten schrumpft der Kopf beim Rollen
      // auf die schmale Titelzeile; das Suchfeld rollt mit weg, die Lupe
      // im schmalen Kopf öffnet dieselbe Suche.
      appToolbarScrollsAway
      appCompactActions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Überall suchen"
          // Der schmale Kopf ist für Vorleseprogramme ausgeblendet; dort
          // wirkt das Suchfeld oben.
          tabIndex={-1}
          tooltip="Öffnet die Suche über alle Bereiche."
          onClick={openSearch}
        >
          <Search className="size-5" aria-hidden="true" />
        </Button>
      }
      overlays={
        <LogoutModal isOpen={logoutOpen} onClose={() => setLogoutOpen(false)} />
      }
    >
      {columns === 1 ? (
        // 16 px zwischen den Karten wie auf jeder Seite der App.
        <div className="flex flex-col gap-4">
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
