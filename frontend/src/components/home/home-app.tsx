"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";

import {
  DayChangesList,
  DayDetail,
  GroupDetail,
  NoticeDetail,
} from "~/components/home/home-app-details";
import { childSummaryCounts } from "~/components/home/day-changes-text";
import { shownEntries } from "~/components/home/day-changes-block";
import { useNoticeAcknowledge } from "~/components/home/day-notice-row";
import { useBerlinClock } from "~/components/home/home-card-rows";
import { NowText, useHomeNow } from "~/components/home/now-strip";
import {
  useHomeStamp,
  type HomeStampState,
} from "~/components/home/use-home-stamp";
import { START_OWN_BLOCK_TOOLTIP } from "~/components/home/use-start-own-block";
import { ActionBar } from "~/components/ui/action-bar";
import { Button, ButtonLink } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
  type CollectionRowProps,
} from "~/components/ui/collection";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
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

/** Ein Kind der eigenen Gruppen, das heute anders ist (#7665). */
function isChildChange(entry: DayChange): boolean {
  return (
    !openNotice(entry) && entry.section === "you" && CHILD_KINDS.has(entry.kind)
  );
}

/** Alles Übrige aus „Heute anders“: Team, Räume, die Schule. */
function isTeamOrSchool(entry: DayChange): boolean {
  return !openNotice(entry) && !isChildChange(entry);
}

/** „1 krank, 2 mit anderer Abholzeit“: dieselben Wörter wie am Desktop. */
function childCounts(entries: readonly DayChange[]): string {
  const count = (kind: string, status?: string) =>
    entries.filter(
      (entry) =>
        entry.kind === kind &&
        (status === undefined || entry.child?.status === status),
    ).length;
  const absent = count("child_absent");
  const sick = count("child_absent", "sick");
  return childSummaryCounts({
    schoolClass: "",
    items: [],
    counts: {
      sick,
      excused: absent - sick,
      pickupChanged: count("child_pickup_changed"),
      goesAlone: count("child_goes_alone"),
      pickupNote: count("child_pickup_note"),
    },
  });
}

/**
 * Ein Eintrag der Startseite: eine Zeile in „Zu erledigen“ oder „Überblick“
 * und, wo es eins gibt, sein Detail. Das Detail steht am iPad quer rechts
 * neben der Liste, am Telefon und iPad hoch im Blatt (`sheet`). Ein Eintrag
 * mit `href` führt dort weiter statt ins Blatt.
 */
interface HomeEntry {
  readonly id: string;
  readonly row: Omit<CollectionRowProps, "href" | "onClick" | "selected">;
  readonly href?: string;
  readonly detail?: ReactNode;
  /** Blatt am Telefon und iPad hoch; ohne `href` öffnet die Zeile es. */
  readonly sheet?:
    | { readonly kind: "notice"; readonly notice: DayChangeNotice }
    | {
        readonly kind: "list";
        readonly title: string;
        readonly body: ReactNode;
      };
}

/**
 * Die Startseite in der App (#8070, Seitenmuster „Übersicht“, 4-staff-flows
 * „J. Startseite“): Was muss ich jetzt tun?
 *
 * 1. Jetzt: laufender oder nächster Block, Kinder da, Stempelzustand. Die
 *    eine passende Aktion (Aufsicht, Stempeln) steht in der ActionBar über
 *    der Pill, in Daumennähe.
 * 2. Zu erledigen: offene Kenntnisnahmen, offene Anfragen, die Kinder, die
 *    heute anders sind, und was sich im Team und in der Schule ändert.
 * 3. Überblick: Aufsicht, Gruppe, als Nächstes, Geburtstage.
 *
 * Telefon: eine Spalte, Details im Blatt. iPad hoch: links die Liste, rechts
 * die eigene Gruppe mit ihren Kindern und der Tag. iPad quer: Liste neben
 * Detail.
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
  const tenantPath = useTenantAwarePath();
  const dayPlanHref = useDayPlanHref();
  const clock = useBerlinClock();

  const dayChanges = useSWRAuth<DayChangesOverview>(
    has("section.day_changes") ? homeKeys.dayChanges(accountId) : null,
    fetchDayChanges,
    { revalidateOnFocus: true },
  );
  const retry = () => dayChanges.mutate();
  const loadError = useSwrLoadError(
    dayChanges.error,
    "die Übersicht „Heute anders“",
    () => retry(),
  );

  const now = useHomeNow(access, context);
  const hasOwnStaff = useHasOwnStaff();
  const stamp = useHomeStamp(
    hasOwnStaff &&
      access.has("time_tracking:own") &&
      isScopeBooked(PAGE_MODULES["/time-tracking"], context.bookedModules),
  );
  const showGroup = has("section.my_group");
  const group = useHomeGroup(showGroup, clock);
  const requests = useOpenRequestRows(has("section.open_requests"));

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

  // ── Zu erledigen ──
  const overview = dayChanges.data;
  const shown = overview ? shownEntries(overview) : [];
  const openNotices = shown.filter(openNotice);
  const children = shown.filter(isChildChange);
  const teamAndSchool = shown.filter(isTeamOrSchool);
  const teamMine = teamAndSchool.filter((entry) => entry.section === "you");
  const todo: HomeEntry[] = [];
  for (const entry of openNotices) {
    todo.push({
      id: `hinweis-${entry.notice.id}`,
      row: {
        leading: <Icon concept={announcementsConcept} />,
        title: entry.notice.title,
        subtitle: "Zur Kenntnis nehmen",
        meta: entry.notice.important ? (
          <StatusBadge label="Wichtig" tone="warning" size="xs" />
        ) : undefined,
      },
      detail: <NoticeDetail notice={entry.notice} onChanged={retry} />,
      sheet: { kind: "notice", notice: entry.notice },
    });
  }
  for (const request of requests) {
    todo.push({
      id: `anfrage-${request.key}`,
      row: {
        leading: <Icon concept={requestsConcept} />,
        title: request.label,
        subtitle: "Wartet auf Entscheidung",
        meta: (
          <StatusBadge
            tone="warning"
            label={`${request.count} offen`}
            size="xs"
          />
        ),
      },
      href: tenantPath(request.href),
    });
  }
  if (overview && children.length > 0) {
    // „Kinder heute anders“ und „Team und Schule“ teilen kein Wort: zwei
    // Zeilen mit „Heute anders“ hielt man für dasselbe.
    const list = (
      <DayChangesList
        overview={overview}
        include={isChildChange}
        label="Kinder heute anders"
        mineTitle="Aus deinen Gruppen"
      />
    );
    todo.push({
      id: "kinder",
      row: {
        leading: <Icon concept={childrenConcept} />,
        title: "Kinder heute anders",
        subtitle: childCounts(children),
        meta: <CountBadge count={children.length} />,
      },
      detail: list,
      sheet: { kind: "list", title: "Kinder heute anders", body: list },
    });
  }
  if (overview && teamAndSchool.length > 0) {
    const school = teamAndSchool.length - teamMine.length;
    const list = (
      <DayChangesList
        overview={overview}
        include={isTeamOrSchool}
        label="Team und Schule"
      />
    );
    todo.push({
      id: "team",
      row: {
        leading: <Icon concept={dayChangesConcept} />,
        title: "Team und Schule",
        subtitle: [
          teamMine.length > 0 ? `${teamMine.length} für dich` : null,
          school > 0 ? `${school} in der Schule` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        meta: <CountBadge count={teamAndSchool.length} />,
      },
      detail: list,
      sheet: { kind: "list", title: "Team und Schule", body: list },
    });
  }

  // ── Überblick ──
  const overviewEntries: HomeEntry[] = [];
  const running = (now.dayBlocks ?? []).find(
    (block) => block.isAssigned && block.status === "active",
  );
  if (running) {
    overviewEntries.push({
      id: "aufsicht",
      row: {
        leading: <Icon concept={supervisionConcept} />,
        title: `Aufsicht: ${running.title}`,
        subtitle: blockChildrenLabel(running),
      },
      href: now.ownSupervision
        ? tenantPath("/active-supervisions")
        : dayPlanHref,
    });
  }
  if (showGroup && group.group) {
    overviewEntries.push({
      id: "gruppe",
      row: {
        leading: <Icon concept={groupsConcept} />,
        title: `Meine Gruppe: ${group.present}/${group.total} da`,
        subtitle:
          group.missing.length > 0
            ? `${group.group.name} · ${group.missing.length} fehlen noch`
            : group.group.name,
      },
      href: tenantPath("/ogs-groups"),
      detail: <GroupDetail snapshot={group} />,
    });
  }
  const showDay = has("section.my_day") || has("section.day_flow");
  const mine = showDay
    ? (now.dayBlocks ?? [])
        .filter((block) => block.isAssigned && !block.isDuty)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];
  if (mine.length > 0) {
    const next = mine.find(
      (block) => block.status !== "active" && block.startTime > clock,
    );
    overviewEntries.push({
      id: "tag",
      row: {
        leading: <Icon concept={carePlanConcept} />,
        title: next
          ? `Als Nächstes: ${next.startTime} ${next.title}`
          : "Mein Tag",
        subtitle: next
          ? (next.roomName ?? undefined)
          : mine.length === 1
            ? "1 Einsatz heute, alle vorbei"
            : `${mine.length} Einsätze heute, alle vorbei`,
      },
      href: dayPlanHref,
      detail: <DayDetail blocks={mine} />,
    });
  }
  const todays = has("section.birthdays")
    ? (birthdays?.celebrations.filter((entry) => entry.isToday) ?? [])
    : [];
  if (todays.length > 0) {
    // Nur zur Information: Geburtstage haben keine eigene Seite.
    overviewEntries.push({
      id: "geburtstag",
      row: {
        leading: <Icon concept={birthdaysConcept} />,
        title: "Geburtstag heute",
        subtitle: todays.map((entry) => entry.name).join(", "),
      },
    });
  }

  const nowCard = <NowCard now={now} stamp={stamp} />;
  const actionBar = <HomeActionBar now={now} stamp={stamp} />;
  const extra =
    rest.length > 0 ? (
      <div className="space-y-4">
        {rest.map((key) => (
          <div key={key}>{renderBlock(key)}</div>
        ))}
      </div>
    ) : null;
  const todoLoading = has("section.day_changes") && !overview && !loadError;
  const listProps = {
    todo,
    overviewEntries,
    todoLoading,
    loadError,
    showTodo: has("section.day_changes") || has("section.open_requests"),
    onChanged: retry,
  };

  if (isSplit) {
    // iPad quer: links Jetzt, Zu erledigen und Überblick, rechts das Detail
    // des gewählten Eintrags. Ohne Wahl steht der erste Eintrag mit Detail.
    const fallback = (
      <HomeSplit
        {...listProps}
        nowCard={nowCard}
        notices={notices}
        extra={extra}
        selection={null}
      />
    );
    return (
      <>
        <Suspense fallback={fallback}>
          <HomeSplitWithSelection
            {...listProps}
            nowCard={nowCard}
            notices={notices}
            extra={extra}
          />
        </Suspense>
        {actionBar}
      </>
    );
  }

  const lists = <HomeLists {...listProps} />;
  if (layout === "tablet") {
    // iPad hoch: links Jetzt und die Liste, rechts die eigene Gruppe mit
    // ihren Kindern und der Tag – die Fläche trägt, was sonst erst ein
    // Tipp zeigt.
    const groupDetail =
      showGroup && group.group ? <GroupDetail snapshot={group} /> : null;
    const childList =
      !groupDetail && overview && children.length > 0 ? (
        <DayChangesList
          overview={overview}
          include={isChildChange}
          label="Kinder heute anders"
          mineTitle="Aus deinen Gruppen"
        />
      ) : null;
    return (
      <>
        <div className="grid grid-cols-2 items-start gap-4" data-home-app="">
          <div className="space-y-4">
            {nowCard}
            {notices}
            {lists}
            <DayDetail blocks={mine} />
          </div>
          <div className="space-y-4">
            {groupDetail}
            {childList}
            {extra}
          </div>
        </div>
        {actionBar}
      </>
    );
  }
  return (
    <>
      <div className="space-y-4" data-home-app="">
        {nowCard}
        {notices}
        {lists}
        {extra}
      </div>
      {actionBar}
    </>
  );
}

// ─── Listen ────────────────────────────────────────────────────────────────

interface ListProps {
  readonly todo: readonly HomeEntry[];
  readonly overviewEntries: readonly HomeEntry[];
  readonly todoLoading: boolean;
  readonly loadError: ReturnType<typeof useSwrLoadError>;
  readonly showTodo: boolean;
  /** Lädt „Heute anders“ neu, etwa nach einer Kenntnisnahme. */
  readonly onChanged: () => Promise<unknown>;
}

/**
 * „Zu erledigen“ und „Überblick“. Ohne `selection` (Telefon, iPad hoch)
 * führt eine Zeile weiter oder öffnet ihr Blatt; mit `selection` (iPad quer)
 * wählt sie das Detail rechts.
 */
function HomeLists({
  todo,
  overviewEntries,
  todoLoading,
  loadError,
  showTodo,
  onChanged,
  selection,
}: ListProps & {
  readonly selection?: {
    readonly current: string | null;
    readonly select: (id: string) => void;
  };
}) {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const all = [...todo, ...overviewEntries];
  const sheetEntry = all.find((entry) => entry.id === sheetId);

  const row = (entry: HomeEntry) => {
    if (selection && entry.detail) {
      return (
        <CollectionRow
          key={entry.id}
          {...entry.row}
          selected={selection.current === entry.id}
          onClick={() => selection.select(entry.id)}
        />
      );
    }
    if (entry.href) {
      return <CollectionRow key={entry.id} {...entry.row} href={entry.href} />;
    }
    if (entry.sheet) {
      return (
        <CollectionRow
          key={entry.id}
          {...entry.row}
          onClick={() => setSheetId(entry.id)}
        />
      );
    }
    return <CollectionRow key={entry.id} {...entry.row} />;
  };

  let todoBlock: ReactNode = null;
  if (loadError) {
    todoBlock = <LoadErrorAlert error={loadError} />;
  } else if (todoLoading) {
    todoBlock = (
      <Collection label="Zu erledigen">
        <CollectionGroup title="Zu erledigen">
          <li className="space-y-2 p-4" aria-hidden="true">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
          </li>
        </CollectionGroup>
      </Collection>
    );
  } else if (showTodo) {
    todoBlock = (
      <Collection label="Zu erledigen">
        <CollectionGroup
          title="Zu erledigen"
          count={todo.length > 0 ? todo.length : undefined}
        >
          {todo.length > 0 ? (
            todo.map(row)
          ) : (
            <CollectionRow
              leading={<Icon concept={dayChangesConcept} />}
              title="Nichts offen"
              subtitle="Heute läuft alles wie geplant."
            />
          )}
        </CollectionGroup>
      </Collection>
    );
  }

  return (
    <>
      {todoBlock}
      {overviewEntries.length > 0 ? (
        <Collection label="Überblick">
          <CollectionGroup title="Überblick">
            {overviewEntries.map(row)}
          </CollectionGroup>
        </Collection>
      ) : null}
      {sheetEntry?.sheet?.kind === "notice" ? (
        <NoticeSheet
          key={sheetEntry.id}
          notice={sheetEntry.sheet.notice}
          onClose={() => setSheetId(null)}
          onChanged={onChanged}
        />
      ) : sheetEntry?.sheet?.kind === "list" ? (
        <ListSheet
          key={sheetEntry.id}
          title={sheetEntry.sheet.title}
          onClose={() => setSheetId(null)}
        >
          {sheetEntry.sheet.body}
        </ListSheet>
      ) : null}
    </>
  );
}

/** Eine Liste im Blatt, so hoch wie ihr Inhalt. */
function ListSheet({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <OverlaySheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      size="fit"
    >
      {children}
    </OverlaySheet>
  );
}

/** Vorwahl am iPad quer, in dieser Reihenfolge. */
const DEFAULT_ORDER = ["gruppe", "kinder", "team", "tag"];

type SplitProps = ListProps & {
  readonly nowCard: ReactNode;
  readonly notices: ReactNode;
  readonly extra: ReactNode;
};

function HomeSplitWithSelection(props: SplitProps) {
  const { selected, select } = useSplitSelection("eintrag");
  return <HomeSplit {...props} selection={{ selected, select }} />;
}

function HomeSplit({
  nowCard,
  notices,
  extra,
  selection,
  ...listProps
}: SplitProps & {
  readonly selection: {
    readonly selected: string | null;
    readonly select: (id: string | null) => void;
  } | null;
}) {
  const withDetail = [...listProps.todo, ...listProps.overviewEntries].filter(
    (entry) => entry.detail,
  );
  // Ohne Wahl: die Liste, die die Fläche am besten füllt (die eigene
  // Gruppe mit ihren Kindern), sonst der erste Eintrag mit Detail.
  const current =
    withDetail.find((entry) => entry.id === selection?.selected) ??
    DEFAULT_ORDER.map((id) => withDetail.find((entry) => entry.id === id)).find(
      Boolean,
    ) ??
    withDetail[0];
  return (
    <div data-home-app="">
      <SplitView
        list={
          <div className="space-y-4">
            {nowCard}
            {notices}
            <HomeLists
              {...listProps}
              selection={{
                current: current?.id ?? null,
                select: (id) => selection?.select(id),
              }}
            />
            {extra}
          </div>
        }
        detail={current?.detail ?? null}
        empty="Heute ist nichts offen."
      />
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

/** Was gerade läuft: nur Information, die Aktionen stehen in der ActionBar. */
function NowCard({
  now,
  stamp,
}: {
  readonly now: ReturnType<typeof useHomeNow>;
  readonly stamp: ReturnType<typeof useHomeStamp>;
}) {
  const stampText = stampLabel(stamp.state);
  return (
    <SectionCard testId="home-now" padding="none">
      <div className="space-y-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <time
            dateTime={`${now.today}T${now.now}`}
            className="shrink-0 text-2xl leading-8 font-semibold text-gray-900 tabular-nums"
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
              wrap
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
                tone={stamp.state.kind === "in" ? "green" : "gray"}
                label={stampText}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

/**
 * Die eine Aktion für jetzt in Daumennähe: die Aufsicht öffnen oder starten,
 * daneben Ein- oder Ausstempeln. Ohne Aufsicht ist Stempeln die Hauptaktion.
 */
function HomeActionBar({
  now,
  stamp,
}: {
  readonly now: ReturnType<typeof useHomeNow>;
  readonly stamp: ReturnType<typeof useHomeStamp>;
}) {
  // „Alle Kinder“ hat in der Pill ihren Reiter (Suche).
  const action = now.actions.find(
    (entry) => entry.kind === "start" || entry.label === "Zur Aufsicht",
  );
  const canStampIn = stamp.state.kind === "out" || stamp.state.kind === "done";
  const canStampOut = stamp.state.kind === "in";

  const primary =
    action?.kind === "start" ? (
      <Button
        type="button"
        variant="primary"
        size="md"
        className="whitespace-nowrap"
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
        className="whitespace-nowrap"
        tooltip="Öffnet deine laufende Aufsicht."
      >
        Aufsicht öffnen
      </ButtonLink>
    ) : null;
  /* VORSCHLAG zu Produktentscheid 4 (Epic #8070): Stempeln als neuer
     Einstieg auf der Startseite; Logik in `useHomeStamp`. */
  const stampButton = canStampIn ? (
    <Button
      type="button"
      variant={primary ? "outline" : "primary"}
      size="md"
      className="whitespace-nowrap"
      disabled={stamp.disabled}
      onClick={stamp.checkIn}
      tooltip="Stempelt dich vor Ort ein. Homeoffice wählst du in der Zeiterfassung."
    >
      Einstempeln
    </Button>
  ) : canStampOut ? (
    <Button
      type="button"
      variant="outline"
      size="md"
      className="whitespace-nowrap"
      disabled={stamp.disabled}
      onClick={stamp.checkOut}
      tooltip="Stempelt dich aus und beendet deine Arbeitszeit."
    >
      Ausstempeln
    </Button>
  ) : null;

  if (!primary && !stampButton) return null;
  return (
    <ActionBar secondary={primary && stampButton ? stampButton : undefined}>
      {primary ?? stampButton}
    </ActionBar>
  );
}

// ─── Blätter und Anfragen ───────────────────────────────────────────────

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
      size="fit"
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
function useOpenRequestRows(enabled: boolean): {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly href: string;
}[] {
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
  ].filter((row) => row.count > 0);
}

// ─── Bausteine ─────────────────────────────────────────────────────────────

function Icon({ concept }: { readonly concept: MotoConcept }) {
  return <MotoConceptIcon concept={concept} size={20} />;
}

/** Die Zahl einer Zeile, rechts: wie viele Einträge das Detail zeigt. */
function CountBadge({ count }: { readonly count: number }) {
  return <StatusBadge tone="gray" label={String(count)} size="xs" />;
}
