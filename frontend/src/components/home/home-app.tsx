"use client";

import { useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";

import {
  DayChangesContent,
  shownEntries,
} from "~/components/home/day-changes-block";
import { useNoticeAcknowledge } from "~/components/home/day-notice-row";
import { useBerlinClock } from "~/components/home/home-card-rows";
import { NowText, useHomeNow } from "~/components/home/now-strip";
import {
  useHomeStamp,
  type HomeStampState,
} from "~/components/home/use-home-stamp";
import { START_OWN_BLOCK_TOOLTIP } from "~/components/home/use-start-own-block";
import { Button, ButtonLink } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import type { BirthdayOverview } from "~/lib/birthdays-api";
import { blockChildrenLabel } from "~/lib/block-children";
import { supervisionConcept } from "~/lib/concepts/supervision";
import { birthdaysConcept } from "~/lib/concepts/birthdays";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { childrenConcept } from "~/lib/concepts/children";
import { dayChangesConcept } from "~/lib/concepts/dayChanges";
import { groupsConcept } from "~/lib/concepts/groups";
import { announcementsConcept } from "~/lib/concepts/announcements";
import { requestsConcept } from "~/lib/concepts/requests";
import {
  fetchDayChanges,
  type DayChange,
  type DayChangeNotice,
  type DayChangesOverview,
} from "~/lib/day-changes";
import { useDeviceContext } from "~/lib/device-context";
import type {
  HomeBlockAccess,
  HomeBlockContext,
  HomeBlockKey,
} from "~/lib/home-blocks";
import { useCareWithdrawalsPending } from "~/lib/hooks/use-care-withdrawals-pending";
import { useChangeRequestsPending } from "~/lib/hooks/use-change-requests-pending";
import { useDayPlanHref } from "~/lib/hooks/use-day-plan-href";
import { useEnrollmentRequestsPending } from "~/lib/hooks/use-enrollment-requests-pending";
import { useEnrollmentsUnread } from "~/lib/hooks/use-enrollments-unread";
import { useHomeGroup } from "~/lib/hooks/use-home-group";
import { useStaffAbsencesPending } from "~/lib/hooks/use-staff-absences-pending";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useHasOwnStaff } from "~/lib/hooks/use-user-context";
import { isScopeBooked, PAGE_MODULES } from "~/lib/module-register";
import type { MotoConcept } from "~/lib/moto-concepts";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { useTenantAwarePath } from "~/lib/tenant-path";

/** Kinder-Arten von „Heute anders“, die „Zu erledigen“ zusammenfasst. */
const CHILD_KINDS = new Set([
  "child_absent",
  "child_goes_alone",
  "child_pickup_changed",
  "child_pickup_note",
]);

/** Ein Hinweis, dessen Kenntnisnahme verlangt ist und noch fehlt. */
function openNotice(entry: DayChange): entry is DayChange & {
  notice: DayChangeNotice;
} {
  return Boolean(
    entry.notice?.requiresAcknowledgement && !entry.notice.acknowledged,
  );
}

/**
 * Die Startseite in der App (#8070, Seitenmuster „Übersicht“, 4-staff-flows
 * „J. Startseite“): Was muss ich jetzt tun?
 *
 * 1. Jetzt-Leiste: laufender oder nächster Block mit der einen passenden
 *    Aktion, Kinder da, Stempelzustand.
 * 2. Zu erledigen: offene Kenntnisnahmen als Zeilen (der Hinweis öffnet im
 *    Blatt), offene Anfragen, „Heute anders“ zusammengefasst.
 * 3. Kurze Vorschauen mit Weg in den Reiter.
 *
 * Dieselben Abfragen und Schlüssel wie die Bausteine des Desktops; was die
 * Fläche zeigt, entscheiden weiter Modul-Register, Rechte und Anordnung
 * (`placed`). Bausteine ohne eigene Kurzform (Kennzahlen der Leitung …)
 * stehen unverändert darunter (`renderBlock`).
 */
export function HomeApp({
  access,
  context,
  placed,
  birthdays,
  notices,
  renderBlock,
}: {
  readonly access: HomeBlockAccess;
  readonly context: HomeBlockContext;
  /** Was auf der Fläche steht, in Lesereihenfolge. */
  readonly placed: readonly HomeBlockKey[];
  readonly birthdays: BirthdayOverview | undefined;
  /** Feste Hinweise der Leitung (Phasenende, Geräte-PIN, Planungsaufgaben). */
  readonly notices: ReactNode;
  readonly renderBlock: (key: HomeBlockKey) => ReactNode;
}) {
  const { layout, isSplit } = useDeviceContext();
  const has = (key: HomeBlockKey) => placed.includes(key);
  const { data: session } = useSession();
  const accountId = session?.user?.id ?? "";

  const dayChanges = useSWRAuth<DayChangesOverview>(
    has("section.day_changes") ? homeKeys.dayChanges(accountId) : null,
    fetchDayChanges,
    { revalidateOnFocus: true },
  );

  const now = useHomeNow(access, context);
  const hasOwnStaff = useHasOwnStaff();
  const stamp = useHomeStamp(
    hasOwnStaff &&
      access.has("time_tracking:own") &&
      isScopeBooked(PAGE_MODULES["/time-tracking"], context.bookedModules),
  );

  // Kurzformen ersetzen diese Bausteine; alles andere bleibt als Karte.
  const SHORT: readonly HomeBlockKey[] = [
    "section.day_changes",
    "section.my_day",
    "section.my_group",
    "section.open_requests",
    "section.birthdays",
    "section.day_flow",
  ];
  const rest = placed.filter((key) => !SHORT.includes(key));

  const nowCard = <NowCard now={now} stamp={stamp} />;
  const todo = (
    <TodoList
      overview={dayChanges.data}
      error={dayChanges.error}
      retry={() => dayChanges.mutate()}
      showDayChanges={has("section.day_changes")}
      showRequests={has("section.open_requests")}
    />
  );
  const previews = (
    <Previews
      now={now}
      showGroup={has("section.my_group")}
      showDay={has("section.my_day") || has("section.day_flow")}
      birthdays={has("section.birthdays") ? birthdays : undefined}
    />
  );
  const extra =
    rest.length > 0 ? (
      <div className="space-y-4">
        {rest.map((key) => (
          <div key={key}>{renderBlock(key)}</div>
        ))}
      </div>
    ) : null;

  if (isSplit) {
    // iPad quer: drei ruhige Spalten statt gestreckter Einzelkarten.
    return (
      <div className="grid grid-cols-3 items-start gap-4" data-home-app="">
        <div className="space-y-4">
          {nowCard}
          {notices}
        </div>
        <div className="space-y-4">{todo}</div>
        <div className="space-y-4">
          {previews}
          {extra}
        </div>
      </div>
    );
  }
  if (layout === "tablet") {
    // iPad hoch: Jetzt und Zu erledigen links, Vorschauen rechts.
    return (
      <div className="grid grid-cols-2 items-start gap-4" data-home-app="">
        <div className="space-y-4">
          {nowCard}
          {notices}
          {todo}
        </div>
        <div className="space-y-4">
          {previews}
          {extra}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-home-app="">
      {nowCard}
      {notices}
      {todo}
      {previews}
      {extra}
    </div>
  );
}

// ─── Jetzt ─────────────────────────────────────────────────────────────────

function stampLabel(state: HomeStampState): string | null {
  switch (state.kind) {
    case "in":
      return state.homeOffice
        ? `Homeoffice seit ${state.since}`
        : `Eingestempelt seit ${state.since}`;
    case "done":
      return `Ausgestempelt um ${state.until}`;
    case "out":
      return "Nicht eingestempelt";
    default:
      return null;
  }
}

function NowCard({
  now,
  stamp,
}: {
  readonly now: ReturnType<typeof useHomeNow>;
  readonly stamp: ReturnType<typeof useHomeStamp>;
}) {
  // Nur die eine Aktion für jetzt: „Alle Kinder“ hat in der Pill ihren
  // Reiter (Suche).
  const action = now.actions.find(
    (entry) => entry.kind === "start" || entry.label === "Zur Aufsicht",
  );
  const stampText = stampLabel(stamp.state);
  const canStampIn = stamp.state.kind === "out" || stamp.state.kind === "done";
  const canStampOut = stamp.state.kind === "in";

  return (
    <SectionCard testId="home-now" padding="none">
      <div className="space-y-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <time
            dateTime={`${now.today}T${now.now}`}
            className="shrink-0 text-2xl font-semibold text-gray-900 tabular-nums"
          >
            {now.now}
          </time>
          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-gray-200" />
          {now.loading ? (
            <div className="min-w-0 flex-1 space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          ) : (
            <NowText
              state={now.state}
              analytics={now.analytics.data}
              today={now.today}
            />
          )}
        </div>
        {now.presentCount !== undefined || stampText ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {now.presentCount !== undefined ? (
              <StatusBadge
                tone="gray"
                label={
                  now.presentCount === 1
                    ? "1 Kind da"
                    : `${now.presentCount} Kinder da`
                }
              />
            ) : null}
            {stampText ? (
              <StatusBadge
                tone={canStampOut ? "green" : "gray"}
                label={stampText}
              />
            ) : null}
          </div>
        ) : null}
        {action || canStampIn || canStampOut ? (
          <div className="flex gap-2">
            {action?.kind === "start" ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                className="flex-1 whitespace-nowrap"
                disabled={now.busyId !== null}
                onClick={() => void now.start(action.block)}
                tooltip={START_OWN_BLOCK_TOOLTIP}
              >
                {now.busyId === action.block.id ? "Startet..." : action.label}
              </Button>
            ) : action?.kind === "link" ? (
              <ButtonLink
                href={action.href}
                variant="primary"
                size="md"
                className="flex-1 whitespace-nowrap"
                tooltip="Öffnet deine laufende Aufsicht."
              >
                Aufsicht öffnen
              </ButtonLink>
            ) : null}
            {/* VORSCHLAG zu Produktentscheid 4 (Epic #8070): Stempeln als
                neuer Einstieg auf der Startseite; Logik in `useHomeStamp`. */}
            {canStampIn ? (
              <Button
                type="button"
                variant={action ? "outline" : "primary"}
                size="md"
                className="flex-1 whitespace-nowrap"
                disabled={stamp.disabled}
                onClick={stamp.checkIn}
                tooltip="Stempelt dich vor Ort ein. Homeoffice wählst du in der Zeiterfassung."
              >
                Einstempeln
              </Button>
            ) : null}
            {canStampOut ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="flex-1 whitespace-nowrap"
                disabled={stamp.disabled}
                onClick={stamp.checkOut}
                tooltip="Stempelt dich aus und beendet deine Arbeitszeit."
              >
                Ausstempeln
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

// ─── Zu erledigen ──────────────────────────────────────────────────────────

function Icon({ concept }: { readonly concept: MotoConcept }) {
  return <MotoConceptIcon concept={concept} size={20} />;
}

function TodoList({
  overview,
  error,
  retry,
  showDayChanges,
  showRequests,
}: {
  readonly overview: DayChangesOverview | undefined;
  readonly error: unknown;
  readonly retry: () => Promise<unknown>;
  readonly showDayChanges: boolean;
  readonly showRequests: boolean;
}) {
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const loadError = useSwrLoadError(error, "die Übersicht „Heute anders“", () =>
    retry(),
  );
  const requests = useOpenRequestRows(showRequests);

  const entries = overview ? shownEntries(overview) : [];
  const notices = entries.filter(openNotice);
  const rest = entries.filter((entry) => !openNotice(entry));
  const mine = rest.filter((entry) => entry.section === "you");
  const children = mine.filter((entry) => CHILD_KINDS.has(entry.kind));
  const otherMine = mine.length - children.length;
  const school = rest.length - mine.length;
  const notice = notices.find((entry) => entry.notice.id === noticeId)?.notice;

  const rows: ReactNode[] = [];
  for (const entry of notices) {
    rows.push(
      <CollectionRow
        key={`notice-${entry.notice.id}`}
        leading={<Icon concept={announcementsConcept} />}
        title={entry.notice.title}
        subtitle="Zur Kenntnis nehmen"
        meta={
          entry.notice.important ? (
            <StatusBadge label="Wichtig" tone="warning" size="xs" />
          ) : undefined
        }
        onClick={() => setNoticeId(entry.notice.id)}
      />,
    );
  }
  rows.push(...requests);
  if (showDayChanges && children.length > 0) {
    rows.push(
      <CollectionRow
        key="children"
        leading={<Icon concept={childrenConcept} />}
        title={
          children.length === 1
            ? "1 Kind heute anders"
            : `${children.length} Kinder heute anders`
        }
        subtitle="Krank, Abholung, allein nach Hause"
        onClick={() => setChangesOpen(true)}
      />,
    );
  }
  if (showDayChanges && (otherMine > 0 || school > 0)) {
    rows.push(
      <CollectionRow
        key="changes"
        leading={<Icon concept={dayChangesConcept} />}
        title="Heute anders"
        subtitle={[
          otherMine > 0 ? `${otherMine} für dich` : null,
          school > 0 ? `${school} in der Schule` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        onClick={() => setChangesOpen(true)}
      />,
    );
  }

  if (loadError) return <LoadErrorAlert error={loadError} />;
  if (showDayChanges && !overview) {
    return (
      <Collection label="Zu erledigen">
        <CollectionGroup title="Zu erledigen">
          <li className="space-y-2 p-4" aria-hidden="true">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
          </li>
        </CollectionGroup>
      </Collection>
    );
  }
  if (rows.length === 0) {
    return (
      <Collection label="Zu erledigen">
        <CollectionGroup title="Zu erledigen">
          <CollectionRow
            leading={<Icon concept={dayChangesConcept} />}
            title="Nichts offen"
            subtitle="Heute läuft alles wie geplant."
          />
        </CollectionGroup>
      </Collection>
    );
  }

  return (
    <>
      <Collection label="Zu erledigen">
        <CollectionGroup title="Zu erledigen" count={rows.length}>
          {rows}
        </CollectionGroup>
      </Collection>
      {notice ? (
        <NoticeSheet
          notice={notice}
          onClose={() => setNoticeId(null)}
          onChanged={retry}
        />
      ) : null}
      {overview ? (
        <OverlaySheet
          open={changesOpen}
          onOpenChange={setChangesOpen}
          title="Heute anders"
          size="full"
        >
          <DayChangesContent
            overview={overview}
            onChanged={retry}
            omit={openNotice}
            capSchool={false}
          />
        </OverlaySheet>
      ) : null}
    </>
  );
}

function NoticeSheet({
  notice,
  onClose,
  onChanged,
}: {
  readonly notice: DayChangeNotice;
  readonly onClose: () => void;
  readonly onChanged: () => Promise<unknown>;
}) {
  const { confirm, pending, error } = useNoticeAcknowledge(
    notice,
    onChanged,
    onClose,
  );
  return (
    <OverlaySheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={notice.title}
      description={
        notice.important ? (
          <StatusBadge label="Wichtig" tone="warning" size="xs" />
        ) : undefined
      }
      footer={
        <Button
          type="button"
          variant="primary"
          size="md"
          className="w-full"
          disabled={pending}
          aria-label={`${notice.title}: zur Kenntnis nehmen`}
          tooltip="Bestätigt sofort, dass du den Hinweis gelesen hast."
          onClick={() => void confirm()}
        >
          {pending ? "Wird gespeichert …" : "Zur Kenntnis nehmen"}
        </Button>
      }
    >
      {notice.body ? (
        <p className="text-base whitespace-pre-line text-gray-800">
          {notice.body}
        </p>
      ) : null}
      <LoadErrorAlert error={error} className="mt-2" />
    </OverlaySheet>
  );
}

/**
 * Dieselben Zähler wie „Offene Anfragen“ und die Seitenleiste; eine Zeile je
 * Art, die etwas offen hat.
 */
function useOpenRequestRows(enabled: boolean): ReactNode[] {
  const changeRequests = useChangeRequestsPending();
  const enrollmentRequests = useEnrollmentRequestsPending();
  const careWithdrawals = useCareWithdrawalsPending();
  const staffAbsences = useStaffAbsencesPending();
  const unreadEnrollments = useEnrollmentsUnread();
  if (!enabled) return [];
  return [
    {
      key: "parent",
      label: "Wünsche von Eltern",
      count: changeRequests.unreadCount,
      href: "/anfragen",
    },
    {
      key: "unread-enrollment",
      label: "Neue Anmeldungen",
      count: unreadEnrollments.unreadCount,
      href: "/admin/enrollments",
    },
    {
      key: "enrollment",
      label: "Änderungen an Anmeldungen",
      count: enrollmentRequests.unreadCount,
      href: "/anfragen",
    },
    {
      key: "withdrawal",
      label: "Abmeldungen aus der Betreuung",
      count: careWithdrawals.unreadCount,
      href: "/anfragen",
    },
    {
      key: "staff",
      label: "Anträge des Teams",
      count: staffAbsences.unreadCount,
      href: "/anfragen",
    },
  ]
    .filter((row) => row.count > 0)
    .map((row) => (
      <RequestRow
        key={row.key}
        label={row.label}
        count={row.count}
        href={row.href}
      />
    ));
}

function RequestRow({
  label,
  count,
  href,
}: {
  readonly label: string;
  readonly count: number;
  readonly href: string;
}) {
  const tenantPath = useTenantAwarePath();
  return (
    <CollectionRow
      leading={<Icon concept={requestsConcept} />}
      title={label}
      subtitle="Wartet auf Entscheidung"
      meta={<StatusBadge tone="warning" label={`${count} offen`} size="xs" />}
      href={tenantPath(href)}
    />
  );
}

// ─── Vorschauen ────────────────────────────────────────────────────────────

function Previews({
  now,
  showGroup,
  showDay,
  birthdays,
}: {
  readonly now: ReturnType<typeof useHomeNow>;
  readonly showGroup: boolean;
  readonly showDay: boolean;
  readonly birthdays: BirthdayOverview | undefined;
}) {
  const tenantPath = useTenantAwarePath();
  const dayPlanHref = useDayPlanHref();
  const clock = useBerlinClock();
  const group = useHomeGroup(showGroup, clock);
  const rows: ReactNode[] = [];

  // Aufsicht: der eigene Block, der gerade läuft, mit seiner Kinderzahl.
  const running = (now.dayBlocks ?? []).find(
    (block) => block.isAssigned && block.status === "active",
  );
  if (running) {
    rows.push(
      <CollectionRow
        key="supervision"
        leading={<Icon concept={supervisionConcept} />}
        title={`Aufsicht: ${running.title}`}
        subtitle={blockChildrenLabel(running)}
        href={
          now.ownSupervision ? tenantPath("/active-supervisions") : dayPlanHref
        }
      />,
    );
  }
  if (showGroup && group.group) {
    rows.push(
      <CollectionRow
        key="group"
        leading={<Icon concept={groupsConcept} />}
        title={`Meine Gruppe: ${group.present}/${group.total} da`}
        subtitle={
          group.missing.length > 0
            ? `${group.group.name} · ${group.missing.length} fehlen noch`
            : group.group.name
        }
        href={tenantPath("/ogs-groups")}
      />,
    );
  } else if (showGroup && group.isLoading) {
    rows.push(
      <li key="group-loading" className="p-4" aria-hidden="true">
        <Skeleton className="h-4 w-3/5" />
      </li>,
    );
  }
  if (showDay) {
    const mine = (now.dayBlocks ?? [])
      .filter((block) => block.isAssigned && !block.isDuty)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const next = mine.find(
      (block) => block.status !== "active" && block.startTime > clock,
    );
    if (mine.length > 0) {
      rows.push(
        <CollectionRow
          key="day"
          leading={<Icon concept={carePlanConcept} />}
          title={
            next ? `Als Nächstes: ${next.startTime} ${next.title}` : "Mein Tag"
          }
          subtitle={
            next
              ? (next.roomName ?? undefined)
              : mine.length === 1
                ? "1 Einsatz heute, alle vorbei"
                : `${mine.length} Einsätze heute, alle vorbei`
          }
          href={dayPlanHref}
        />,
      );
    }
  }
  const todays = birthdays?.celebrations.filter((entry) => entry.isToday) ?? [];
  if (todays.length > 0) {
    // Nur zur Information: Geburtstage haben keine eigene Seite.
    rows.push(
      <CollectionRow
        key="birthdays"
        leading={<Icon concept={birthdaysConcept} />}
        title="Geburtstag heute"
        subtitle={todays.map((entry) => entry.name).join(", ")}
      />,
    );
  }
  if (rows.length === 0) return null;
  return (
    <Collection label="Überblick">
      <CollectionGroup title="Überblick">{rows}</CollectionGroup>
    </Collection>
  );
}
