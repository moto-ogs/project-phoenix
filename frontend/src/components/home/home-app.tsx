"use client";

import { Suspense, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";

import {
  DayChangesList,
  DayChangesPreview,
  DayDetail,
  GroupDetail,
  NoticeDetail,
} from "~/components/home/home-app-details";
import {
  BirthdaysCard,
  MyDayCard,
  MyGroupCard,
  OpenRequestsCard,
  type OpenRequestRow,
} from "~/components/home/home-app-cards";
import { shownEntries } from "~/components/home/day-changes-block";
import { useNoticeAcknowledge } from "~/components/home/day-notice-row";
import { useBerlinClock } from "~/components/home/home-card-rows";
import { STUDENT_SEARCH_LINK_TOOLTIP } from "~/components/home/home-link-tooltips";
import {
  NowRunningText,
  NowText,
  useHomeNow,
} from "~/components/home/now-strip";
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
import { presentConcept } from "~/lib/concepts/present";
import { supervisionConcept } from "~/lib/concepts/supervision";
import { birthdaysConcept } from "~/lib/concepts/birthdays";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { groupsConcept } from "~/lib/concepts/groups";
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
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { cn } from "~/lib/utils";

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

/** Alles aus „Heute anders“ außer offenen Hinweisen (die stehen einzeln). */
function isDayChange(entry: DayChange): boolean {
  return !openNotice(entry);
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
  birthdaysState,
  notices,
  renderBlock,
}: {
  readonly access: HomeBlockAccess;
  readonly context: HomeBlockContext;
  /** Was auf der Fläche steht, in Lesereihenfolge. */
  readonly placed: readonly HomeBlockKey[];
  readonly birthdays: BirthdayOverview | undefined;
  /** Ladezustand der laufenden Woche für die Karte „Geburtstage“. */
  readonly birthdaysState?: {
    readonly loading: boolean;
    readonly error?: unknown;
    readonly retry?: () => unknown;
  };
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
  // „Ablauf des Tages“ hat keine Kurzform: am Handy steht die Karte des
  // Desktops, damit kein Block der anderen fehlt.
  const SHORT: readonly HomeBlockKey[] = [
    "section.day_changes",
    "section.my_day",
    "section.my_group",
    "section.open_requests",
    "section.birthdays",
  ];
  const rest = placed.filter((key) => !SHORT.includes(key));

  // ── Zu erledigen ──
  const overview = dayChanges.data;
  const shown = overview ? shownEntries(overview) : [];
  const openNotices = shown.filter(openNotice);
  const children = shown.filter(isChildChange);
  const todo: HomeEntry[] = [];
  for (const entry of openNotices) {
    todo.push({
      id: `hinweis-${entry.notice.id}`,
      // Ohne eigenes Symbol: die Zeile steht bündig mit den übrigen
      // Einträgen von „Heute anders“, deren Kopf das Symbol trägt.
      // Wie am Desktop unter „Betrifft dich“, dahinter, dass die Bestätigung
      // offen ist. Die Zeile öffnet den Text mit dem Knopf „Zur Kenntnis
      // nehmen“: bestätigt wird erst nach dem Lesen. In der Zeile steht kein
      // Knopf-ähnlicher Chip, die Zeile hat genau eine Trefferfläche.
      row: {
        title: entry.notice.title,
        subtitle: (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {entry.notice.important ? (
              <StatusBadge label="Wichtig" tone="warning" size="xs" />
            ) : null}
            Betrifft dich · noch nicht bestätigt
          </span>
        ),
        // Der Titel bricht um statt „Neuer Notfallplan …“ am SE.
        wrap: true,
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
  // „Heute anders“ steht wie am Desktop als eigene Karte mit den ersten
  // Änderungen als ganze Sätze; alle stehen im Blatt.
  const dayChangesEntry: HomeEntry | null =
    overview && has("section.day_changes")
      ? {
          id: "heute-anders",
          row: { title: "Heute anders" },
          sheet: {
            kind: "list",
            title: "Heute anders",
            body: (
              <DayChangesList
                overview={overview}
                include={isDayChange}
                label="Heute anders"
              />
            ),
          },
        }
      : null;

  // ── Überblick ──
  // iPad hoch zeigt Gruppe und Tag daneben als ganze Liste; die
  // Kurzzeilen im Überblick wiederholten sie nur.
  const inlineDetails = layout === "tablet" && !isSplit;
  const overviewEntries: HomeEntry[] = [];
  const running = (now.dayBlocks ?? []).find(
    (block) => block.isAssigned && block.status === "active",
  );
  // Am Telefon trägt die Jetzt-Karte den laufenden Block mit „Zur
  // Aufsicht“; die Zeile im Überblick wiederholte ihn nur.
  const nowShowsSupervision =
    layout === "phone" &&
    now.actions.some(
      (action) =>
        action.kind === "link" &&
        action.href === tenantPath("/active-supervisions"),
    );
  if (running && !nowShowsSupervision) {
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
  // Am Telefon stehen Gruppe, Tag und Geburtstage als eigene Karten wie am
  // Desktop (`placedCards`); die Kurzzeilen brauchen nur iPad-Ansichten.
  if (showGroup && group.group && !inlineDetails && layout !== "phone") {
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
  if (mine.length > 0 && !inlineDetails && layout !== "phone") {
    // Der nächste Block steht schon in der Jetzt-Karte; die Zeile nennt
    // den ganzen Tag.
    const coming = mine.filter(
      (block) =>
        block.status !== "active" &&
        block.status !== "completed" &&
        block.startTime > clock,
    ).length;
    const total =
      mine.length === 1 ? "1 Einsatz heute" : `${mine.length} Einsätze heute`;
    overviewEntries.push({
      id: "tag",
      row: {
        leading: <Icon concept={carePlanConcept} />,
        title: "Mein Tag",
        subtitle:
          coming === 0
            ? `${total}, alle vorbei`
            : `${total}, ${coming === 1 ? "1 kommt" : `${coming} kommen`} noch`,
      },
      href: dayPlanHref,
      detail: <DayDetail blocks={mine} />,
    });
  }
  const todays = has("section.birthdays")
    ? (birthdays?.celebrations.filter((entry) => entry.isToday) ?? [])
    : [];
  if (todays.length > 0 && layout !== "phone") {
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

  // Am Telefon wandert „Zur Aufsicht“ in die Leiste, solange der eigene
  // Block läuft: das ist dann die häufigste Aktion der Seite.
  const supervisionHref =
    layout === "phone" && nowShowsSupervision
      ? tenantPath("/active-supervisions")
      : null;
  const nowCard = (
    <NowCard
      now={now}
      stamp={stamp}
      running={layout === "phone" ? running : undefined}
      // Am Telefon trägt die Pill „Alle Kinder“ (Lupe) und die Leiste „Zur
      // Aufsicht“: die Karte wiederholt sie nicht und bleibt zwei Zeilen
      // hoch, damit am SE „Heute anders“ im ersten Bild steht.
      withoutHrefs={
        layout === "phone"
          ? [tenantPath("/students/search"), supervisionHref ?? ""]
          : []
      }
      withoutStart={layout === "phone"}
    />
  );
  // Steht ein eigener Block zum Start an, ist „Aufsicht starten“ die
  // Hauptaktion der Leiste (wie in der Jetzt-Zone des Desktops), auch wenn
  // daneben schon eine Aufsicht läuft: Die Jetzt-Karte nennt dann diesen
  // Block als „Nicht gestartet“, und zur laufenden Aufsicht führt die Pill.
  const startInBar = layout === "phone" ? now.startable : null;
  const actionBar = (
    <HomeActionBar
      stamp={stamp}
      // Am Telefon gibt es keine Jetzt-Karte mehr: Ausstempeln steht in
      // der Leiste, wo am Morgen Einstempeln stand.
      withCheckOut={layout === "phone"}
      supervisionHref={supervisionHref}
      start={
        startInBar
          ? {
              busy: now.busyId === startInBar.id,
              disabled: now.busyId !== null,
              onStart: () => void now.start(startInBar),
            }
          : null
      }
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
  const todoLoading = has("section.day_changes") && !overview && !loadError;
  const listProps = {
    todo,
    dayChanges:
      overview && dayChangesEntry ? { overview, entry: dayChangesEntry } : null,
    overviewEntries,
    todoLoading,
    loadError,
    showTodo: has("section.day_changes") || has("section.open_requests"),
    onChanged: retry,
    // Am Telefon eine Zeile statt vier (Hinweise zur Kenntnisnahme stehen
    // immer), auf jedem Telefon gleich (die Kürzung hängt nicht an der
    // Bildhöhe): „Mein Tag“ steht am SE mit mehr Blöcken im ersten Bild;
    // alle Änderungen stehen hinter „Alle anzeigen · N weitere“.
    previewLimit: layout === "phone" ? 1 : undefined,
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
          include={isDayChange}
          label="Heute anders"
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
  // Telefon: jeder Baustein des Desktops in seiner Reihenfolge, als Liste
  // in einer Karte. „Heute anders“ steht schon oben in `lists`.
  const placedCards = placed.map((key) => {
    switch (key) {
      case "section.day_changes":
        return null;
      case "section.my_day":
        return <MyDayCard key={key} />;
      case "section.my_group":
        return <MyGroupCard key={key} />;
      case "section.birthdays":
        return (
          <BirthdaysCard
            key={key}
            current={birthdays}
            currentLoading={birthdaysState?.loading ?? false}
            currentError={birthdaysState?.error}
            onRetryCurrent={birthdaysState?.retry}
          />
        );
      case "section.open_requests":
        return <OpenRequestsCard key={key} rows={requests} />;
      default:
        return <div key={key}>{renderBlock(key)}</div>;
    }
  });
  return (
    <>
      <div className="space-y-4" data-home-app="">
        {/* Das Jetzt steht in der Kopfkarte (`HomeHeadStatus`). */}
        {notices}
        <HomeLists {...listProps} withoutRequests />
        {placedCards}
      </div>
      {actionBar}
    </>
  );
}

// ─── Listen ────────────────────────────────────────────────────────────────

interface ListProps {
  readonly todo: readonly HomeEntry[];
  /** „Heute anders“ als eigene Karte unter „Zu erledigen“. */
  readonly dayChanges: {
    readonly overview: DayChangesOverview;
    readonly entry: HomeEntry;
  } | null;
  readonly overviewEntries: readonly HomeEntry[];
  readonly todoLoading: boolean;
  readonly loadError: ReturnType<typeof useSwrLoadError>;
  readonly showTodo: boolean;
  /** Lädt „Heute anders“ neu, etwa nach einer Kenntnisnahme. */
  readonly onChanged: () => Promise<unknown>;
  /** So viele Änderungen zeigt die Vorschau von „Heute anders“. */
  readonly previewLimit?: number;
}

/**
 * „Zu erledigen“ und „Überblick“. Ohne `selection` (Telefon, iPad hoch)
 * führt eine Zeile weiter oder öffnet ihr Blatt; mit `selection` (iPad quer)
 * wählt sie das Detail rechts.
 */
function HomeLists({
  todo,
  dayChanges,
  overviewEntries,
  todoLoading,
  loadError,
  showTodo,
  onChanged,
  previewLimit,
  selection,
  withoutRequests = false,
}: ListProps & {
  /** Telefon: „Offene Anfragen“ steht als eigene Karte an ihrem Platz. */
  readonly withoutRequests?: boolean;
  readonly selection?: {
    readonly current: string | null;
    readonly select: (id: string) => void;
  };
}) {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const all = [
    ...todo,
    ...(dayChanges ? [dayChanges.entry] : []),
    ...overviewEntries,
  ];
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

  // Wie am Desktop: Hinweise zur Kenntnisnahme stehen oben in „Heute
  // anders“, offene Anfragen als eigene Karte. Kein „Zu erledigen“.
  const notices = todo.filter((entry) => entry.sheet?.kind === "notice");
  const requestRows = todo.filter((entry) => entry.sheet?.kind !== "notice");
  let requestBlock: ReactNode = null;
  if (showTodo && requestRows.length > 0 && !withoutRequests) {
    requestBlock = (
      <Collection label="Offene Anfragen">
        <CollectionGroup title="Offene Anfragen" count={requestRows.length}>
          {requestRows.map(row)}
        </CollectionGroup>
      </Collection>
    );
  }

  return (
    <>
      {loadError ? <LoadErrorAlert error={loadError} /> : null}
      {todoLoading && !loadError ? (
        <Collection label="Heute anders">
          <CollectionGroup title="Heute anders">
            <li className="space-y-2 p-4" aria-hidden="true">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-2/5" />
            </li>
          </CollectionGroup>
        </Collection>
      ) : null}
      {dayChanges && !loadError ? (
        <DayChangesPreview
          overview={dayChanges.overview}
          include={isDayChange}
          // Die Grenze gilt für die ganze Vorschau: Hinweise zur Kenntnisnahme
          // stehen immer (sie sind nicht im Blatt), Änderungen füllen auf.
          limit={
            previewLimit == null
              ? undefined
              : Math.max(0, previewLimit - notices.length)
          }
          lead={notices.length > 0 ? notices.map(row) : undefined}
          leadCount={notices.length}
          onShowAll={() => setSheetId(dayChanges.entry.id)}
        />
      ) : null}
      {requestBlock}
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

/**
 * Telefon (#8070): Datum und Jetzt stehen in der Kopfkarte unter dem Gruß
 * statt in einer zweiten Karte darunter. Oben das Datum, die Kinder da und
 * der Stempelzustand, darunter was gerade läuft oder als Nächstes kommt.
 * So beginnt am SE die erste Liste bei rund 20 % der Höhe. Dieselben
 * Abfragen wie die Seite (SWR teilt sie).
 */
export function HomeHeadStatus({
  access,
  context,
  date,
}: {
  readonly access: HomeBlockAccess;
  readonly context: HomeBlockContext;
  readonly date: string;
}) {
  const now = useHomeNow(access, context);
  const hasOwnStaff = useHasOwnStaff();
  const stamp = useHomeStamp(
    hasOwnStaff &&
      access.has("time_tracking:own") &&
      isScopeBooked(PAGE_MODULES["/time-tracking"], context.bookedModules),
  );
  const stamped = stamp.state.kind === "in" || stamp.state.kind === "done";
  const stampText = stamped ? stampLabel(stamp.state) : null;
  const running = (now.dayBlocks ?? []).find(
    (block) => block.isAssigned && block.status === "active",
  );
  const runningOverride =
    running && now.state.kind !== "own_running" ? running : null;
  // Läuft ein eigener Block, steht er als erste Zeile von „Mein Tag“ direkt
  // unter dem Kopf („seit 01:20 Basteln Läuft“). Der Kopf wiederholte ihn
  // nur und bleibt dann zweizeilig: Gruß, Datum mit Kindern und Stempel.
  // „Nicht gestartet“ und „Als Nächstes“ nennt er weiter.
  const ownActive =
    runningOverride != null ||
    (now.state.kind === "own_running" && now.state.block.status === "active");
  const firstLine = [
    date,
    now.presentCount === undefined
      ? null
      : now.presentCount === 1
        ? "1 Kind da"
        : `${now.presentCount} Kinder da`,
    stampText,
  ].filter(Boolean);
  return (
    <div data-home-head-status="" className="min-w-0 pr-2">
      <p className="leading-6">{firstLine.join(" · ")}</p>
      {now.loading ? (
        <div className="py-1" aria-hidden="true">
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : ownActive ? null : runningOverride ? (
        <NowRunningText
          head
          block={runningOverride}
          next={now.state.kind === "own_next" ? now.state.block : null}
        />
      ) : (
        <NowText
          head
          state={now.state}
          analytics={now.analytics.data}
          today={now.today}
          withoutDate
        />
      )}
    </div>
  );
}

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

const NO_HREFS: readonly string[] = [];

/**
 * Die Jetzt-Karte wie am Desktop (#2180): die Uhr groß links als Anker, daneben
 * was gerade läuft oder als Nächstes kommt, darunter wie viele Kinder da
 * sind. Wer die Startseite von heute kennt, erkennt sie wieder. Knöpfe nur
 * für das, was die Pill nicht schon trägt: den eigenen Block starten und
 * Ausstempeln (selten, deshalb hier statt in der Leiste).
 */
function NowCard({
  now,
  stamp,
  running,
  withoutHrefs = NO_HREFS,
  withoutStart = false,
}: {
  readonly now: ReturnType<typeof useHomeNow>;
  readonly stamp: ReturnType<typeof useHomeStamp>;
  /** Der eigene Block, der laut Tagesplan gerade läuft (nur Telefon). */
  readonly running?: PlannedTimetableInstance;
  /** Wege, die Leiste oder Pill schon tragen (nur Telefon). */
  readonly withoutHrefs?: readonly string[];
  /** Die Leiste startet den eigenen Block (nur Telefon). */
  readonly withoutStart?: boolean;
}) {
  const tenantPath = useTenantAwarePath();
  const stamped = stamp.state.kind === "in" || stamp.state.kind === "done";
  const stampText = stamped ? stampLabel(stamp.state) : null;
  const checkOut = stamp.state.kind === "in";
  // Wie am Desktop: die Wege des Moments („Zur Aufsicht“ bzw. „Aufsicht
  // starten“, „Alle Kinder“) stehen in der Karte, Ausstempeln daneben.
  const actions = now.actions.filter((action) =>
    action.kind === "link"
      ? !withoutHrefs.includes(action.href)
      : !withoutStart,
  );
  const footer = !now.loading && (actions.length > 0 || checkOut);
  // Zwei Zeilen: Uhrzeit klein vor dem Blocktitel, darunter Zustand, Raum,
  // Ende und die Kinder da. Keine eigene Zeile je Angabe.
  const time = (
    <time
      dateTime={`${now.today}T${now.now}`}
      className="shrink-0 font-semibold text-gray-900 tabular-nums"
    >
      {now.now}
    </time>
  );
  const present =
    now.presentCount !== undefined ? (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <MotoConceptIcon concept={presentConcept} size={14} />
        <span className="font-semibold text-gray-700 tabular-nums">
          {now.presentCount}
        </span>
        {now.presentCount === 1 ? "Kind da" : "Kinder da"}
      </span>
    ) : null;
  // Die Kinder da stehen rechts in der Titelzeile, der Stempelzustand am
  // Ende der Angabenzeile.
  const extra = stampText ? (
    <StatusBadge
      tone={stamp.state.kind === "in" ? "green" : "gray"}
      label={stampText}
    />
  ) : undefined;
  // Läuft ein eigener Block, der in den Einsätzen fehlt (spontan gestartet),
  // nennt die Karte ihn statt „alles erledigt“ oder „Als Nächstes“.
  const runningOverride =
    running && now.state.kind !== "own_running" ? running : null;
  const buttons = [
    ...actions.map((action, index) =>
      action.kind === "start" ? (
        <Button
          key={`start-${action.block.id}`}
          type="button"
          variant={index === 0 ? "primary" : "outline"}
          size="md"
          className="w-full whitespace-nowrap"
          disabled={now.busyId !== null}
          onClick={() => void now.start(action.block)}
          tooltip={START_OWN_BLOCK_TOOLTIP}
        >
          {now.busyId === action.block.id ? "Startet..." : action.label}
        </Button>
      ) : (
        <ButtonLink
          key={action.href}
          href={action.href}
          variant={index === 0 ? "primary" : "outline"}
          size="md"
          className="w-full gap-2 whitespace-nowrap"
          tooltip={
            action.href === tenantPath("/active-supervisions")
              ? "Öffnet deine laufende Aufsicht."
              : STUDENT_SEARCH_LINK_TOOLTIP
          }
        >
          {action.label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </ButtonLink>
      ),
    ),
    checkOut ? (
      // Stempel-Knöpfe sind überall grün (Kit-Ausnahme der Zeiterfassung).
      <Button
        key="ausstempeln"
        type="button"
        variant="success"
        size="md"
        className="w-full whitespace-nowrap"
        disabled={stamp.disabled}
        onClick={stamp.checkOut}
        tooltip="Stempelt dich sofort aus und beendet deine Arbeitszeit."
      >
        Ausstempeln
      </Button>
    ) : null,
  ].filter(Boolean);
  return (
    <SectionCard testId="home-now" padding="none">
      <div className="px-4 py-3">
        {now.loading ? (
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : runningOverride ? (
          <NowRunningText
            block={runningOverride}
            next={now.state.kind === "own_next" ? now.state.block : null}
            lead={time}
            extra={extra}
            aside={present}
          />
        ) : (
          <NowText
            state={now.state}
            analytics={now.analytics.data}
            today={now.today}
            wrap
            withoutDate
            lead={time}
            extra={extra}
            aside={present}
          />
        )}
        {footer ? (
          <div
            className={cn(
              "mt-3 grid gap-2",
              buttons.length > 1 ? "grid-cols-2" : "grid-cols-1",
              // Drei Knöpfe: der dritte (Ausstempeln) über die ganze Breite.
              buttons.length === 3 && "[&>*:last-child]:col-span-2",
            )}
          >
            {buttons}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

/**
 * Die Leiste über der Pill trägt, was man auf der Startseite gerade am
 * häufigsten braucht. Steht der eigene Block zum Start an: „Aufsicht
 * starten“. Sonst, solange der eigene Block läuft: „Zur Aufsicht“.
 * Daneben Einstempeln, falls man es heute noch nicht ist; sonst nur
 * Einstempeln. Ausstempeln steht in der Jetzt-Karte, am Telefon in der
 * Leiste.
 */
function HomeActionBar({
  stamp,
  withCheckOut = false,
  supervisionHref,
  start,
}: {
  readonly stamp: ReturnType<typeof useHomeStamp>;
  /** Telefon: Ausstempeln steht in der Leiste statt in der Jetzt-Karte. */
  readonly withCheckOut?: boolean;
  readonly supervisionHref: string | null;
  readonly start: {
    readonly busy: boolean;
    readonly disabled: boolean;
    readonly onStart: () => void;
  } | null;
}) {
  const checkIn = stamp.state.kind === "out";
  const checkOut = withCheckOut && stamp.state.kind === "in";
  if (!checkIn && !checkOut && !supervisionHref && !start) return null;
  /* VORSCHLAG zu Produktentscheid 4 (Epic #8070): Stempeln als neuer
     Einstieg auf der Startseite; Logik in `useHomeStamp`. */
  const checkInButton = checkIn ? (
    <Button
      type="button"
      // Stempel-Knöpfe sind überall grün (Kit-Ausnahme der Zeiterfassung).
      variant="success"
      size="md"
      className="whitespace-nowrap"
      disabled={stamp.disabled}
      onClick={stamp.checkIn}
      tooltip="Stempelt dich vor Ort ein. Homeoffice wählst du in der Zeiterfassung."
    >
      Einstempeln
    </Button>
  ) : checkOut ? (
    // Stempel-Knöpfe sind überall grün (Kit-Ausnahme der Zeiterfassung).
    <Button
      type="button"
      variant="success"
      size="md"
      className="whitespace-nowrap"
      disabled={stamp.disabled}
      onClick={stamp.checkOut}
      tooltip="Stempelt dich sofort aus und beendet deine Arbeitszeit."
    >
      Ausstempeln
    </Button>
  ) : null;
  if (start) {
    return (
      <ActionBar secondary={checkInButton ?? undefined}>
        <Button
          type="button"
          variant="primary"
          size="md"
          className="flex-1 whitespace-nowrap"
          disabled={start.disabled}
          onClick={start.onStart}
          tooltip={START_OWN_BLOCK_TOOLTIP}
        >
          {start.busy ? "Startet..." : "Aufsicht starten"}
        </Button>
      </ActionBar>
    );
  }
  if (!supervisionHref) return <ActionBar>{checkInButton}</ActionBar>;
  return (
    <ActionBar secondary={checkInButton ?? undefined}>
      <ButtonLink
        href={supervisionHref}
        variant="primary"
        size="md"
        className="flex-1 gap-2 whitespace-nowrap"
        tooltip="Öffnet deine laufende Aufsicht."
      >
        Zur Aufsicht
        <ArrowRight className="size-4" aria-hidden="true" />
      </ButtonLink>
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
function useOpenRequestRows(enabled: boolean): OpenRequestRow[] {
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
      hint: "Stammdaten, Betreuungszeiten, Krankmeldungen",
      count: changeRequests.unreadCount,
      href: "/anfragen",
    },
    {
      key: "unread-enrollment",
      label: "Neue Anmeldungen",
      hint: "Noch nicht gelesene Anmeldungen von Eltern",
      badge: "ungelesen",
      count: unreadEnrollments.unreadCount,
      href: "/admin/enrollments",
    },
    {
      key: "enrollment",
      label: "Änderungen an Anmeldungen",
      hint: "Eingereichte Änderungen zu laufenden Anmeldungen",
      count: enrollmentRequests.unreadCount,
      href: "/anfragen",
    },
    {
      key: "withdrawal",
      label: "Abmeldungen aus der Betreuung",
      hint: "Angekündigte Komplett-Abmeldungen",
      count: careWithdrawals.unreadCount,
      href: "/anfragen",
    },
    {
      key: "staff",
      label: "Anträge des Teams",
      hint: "Urlaub und Abwesenheiten von Mitarbeitenden",
      count: staffAbsences.unreadCount,
      href: "/anfragen",
    },
  ].filter((row) => row.count > 0);
}

// ─── Bausteine ─────────────────────────────────────────────────────────────

function Icon({ concept }: { readonly concept: MotoConcept }) {
  return <MotoConceptIcon concept={concept} size={20} />;
}
