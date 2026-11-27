"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import {
  dayLabel,
  dayMonthLabel,
  describeCelebration,
} from "~/components/dashboard/birthday-list";
import { useBirthdayWeek } from "~/components/home/birthdays-block";
import {
  BlockRowParts,
  blockStaffShort,
} from "~/components/timetable/block-row-parts";
import {
  BlockState,
  blockAheadLabel,
  blockStateLabel,
} from "~/components/home/day-flow-block";
import {
  LinkRowMeta,
  upcomingFirst,
  useBerlinClock,
  useHomeCardRows,
} from "~/components/home/home-card-rows";
import { AwayBadge } from "~/components/home/my-group-block";
import {
  START_OWN_BLOCK_TOOLTIP,
  useStartOwnBlock,
} from "~/components/home/use-start-own-block";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import type { BirthdayOverview } from "~/lib/birthdays-api";
import { blockChildrenLabel, hasOpenEnd } from "~/lib/block-children";
import { birthdaysConcept } from "~/lib/concepts/birthdays";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { groupsConcept } from "~/lib/concepts/groups";
import { requestsConcept } from "~/lib/concepts/requests";
import { useDayPlanHref, useDayPlanLabel } from "~/lib/hooks/use-day-plan-href";
import { useHomeGroup } from "~/lib/hooks/use-home-group";
import { useMinuteClock } from "~/lib/pickup-helpers";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import type { MotoConcept } from "~/lib/moto-concepts";
import { useSWRAuth } from "~/lib/swr";
import { homeKeys } from "~/lib/swr/portal-keys";
import { startableOwnBlock } from "~/lib/home-now";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { timetableOperationsApi } from "~/lib/timetable-operations-api";
import { canStartPlannedInstance } from "~/lib/timetable-lifecycle";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { cn } from "~/lib/utils";

/**
 * Die Bausteine der Startseite in der App (#8070) als Listen in EINER Karte:
 * dieselben Angaben und Aktionen wie die Karten des Desktops (`MyDayBlock`,
 * `MyGroupBlock`, `BirthdaysBlock`, `OpenRequestsBlock`), nur als Zeilen.
 * Am Handy darf nichts fehlen, was der Desktop auf der Startseite zeigt.
 */

/** Kopf einer Karte: Symbol und Name wie am Desktop. */
function Head({
  concept,
  children,
}: {
  readonly concept: MotoConcept;
  readonly children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <MotoConceptIcon concept={concept} size={18} />
      {children}
    </span>
  );
}

function LoadingRow() {
  return (
    <li className="space-y-2 px-4 py-3" aria-hidden="true">
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-4 w-2/5" />
    </li>
  );
}

// ─── Mein Tag ──────────────────────────────────────────────────────────────

/**
 * „Mein Tag“ wie am Desktop: die eigenen Einsätze mit Zeit, Raum, Gruppe,
 * Kindern und Kolleginnen, die Jetzt-Linie, „Starten“ am eigenen Block und
 * der Weg in den Tagesplan.
 */
export function MyDayCard() {
  const dayPlanHref = useDayPlanHref();
  const dayPlanLabel = useDayPlanLabel();
  const tenantPath = useTenantAwarePath();
  const now = useBerlinClock();
  const clockNow = useMinuteClock();
  const { data, error, isLoading, mutate } = useSWRAuth<
    PlannedTimetableInstance[]
  >(
    homeKeys.dayFlow(),
    () =>
      timetableOperationsApi.plannedNow({
        scope: "day",
        includeRoster: false,
      }),
    { refreshInterval: 5 * 60 * 1000 },
  );
  const { start, busyId } = useStartOwnBlock({ onFailure: () => mutate() });
  // Den ersten startbereiten eigenen Block startet die Leiste über der Pill
  // („Aufsicht starten“); seine Zeile trägt dann den Zustand statt eines
  // Knopfs und behält die ganze Breite für ihre Angaben.
  const barStartId = startableOwnBlock(data ?? [], clockNow)?.id ?? null;
  const loadError = useSwrLoadError(error, "die Karte „Mein Tag“", () =>
    mutate(),
  );
  const mine = [...(data ?? [])]
    .filter((block) => block.isAssigned)
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime),
    );
  const { items: relevant, allPast } = upcomingFirst(
    mine,
    (block) => (block.status === "active" ? "24:00" : block.endTime),
    now,
  );
  const { shown, hidden } = useHomeCardRows(relevant, 6, {
    preferLatest: allPast,
  });
  const nowIndex =
    now === ""
      ? -1
      : (() => {
          const index = shown.findIndex((block) => block.endTime > now);
          return index === -1 ? shown.length : index;
        })();

  let rows: ReactNode;
  if (loadError) {
    rows = (
      <li className="p-4">
        <LoadErrorAlert error={loadError} />
      </li>
    );
  } else if ((isLoading && data === undefined) || error) {
    rows = <LoadingRow />;
  } else if (mine.length === 0) {
    rows = (
      <CollectionRow
        wrap
        title="Heute bist du für keinen Block eingeteilt"
        subtitle="Deine Einsätze aus dem Betreuungsplan erscheinen hier, mit Raum, Kindern und dem Starten-Knopf."
      />
    );
  } else {
    rows = (
      <>
        {shown.map((block, index) => (
          <MyDayRow
            key={block.id}
            block={block}
            now={now}
            nowLine={index === nowIndex}
            // „in 2 Std 5 Min“ nur am nächsten Block (wie „Als Nächstes“ im
            // Tagesplan): an jedem Block brach das Abzeichen lange Titel um.
            next={
              block.status === "planned" &&
              block.startTime > now &&
              shown.find(
                (other) => other.status === "planned" && other.startTime > now,
              )?.startTime === block.startTime
            }
            dayPlanHref={dayPlanHref}
            tenantPath={tenantPath}
            busy={busyId === block.id}
            onStart={start}
            startInBar={barStartId === block.id}
          />
        ))}
        {nowIndex === shown.length && hidden === 0 ? (
          <NowLineRow now={now} />
        ) : null}
      </>
    );
  }

  return (
    <Collection
      label="Mein Tag"
      // Beginn und Ende stehen auf Höhe des Titels wie im Tagesplan. Nur
      // die Zeitspalte: „Heute öffnen“ hat keine und bleibt mittig, sonst
      // stand unter dem Text ein leerer Streifen.
      className="[&_[data-collection-row]>span.shrink-0:first-child]:self-start"
    >
      <CollectionGroup
        title={<Head concept={carePlanConcept}>Mein Tag</Head>}
        count={mine.length > 0 ? mine.length : undefined}
      >
        {rows}
        <CollectionRow
          title={dayPlanLabel}
          meta={
            <LinkRowMeta>
              {hidden > 0
                ? `${hidden} ${hidden === 1 ? "weiterer Einsatz" : "weitere Einsätze"}`
                : null}
            </LinkRowMeta>
          }
          href={dayPlanHref}
        />
      </CollectionGroup>
    </Collection>
  );
}

function NowLineRow({ now }: { readonly now: string }) {
  return (
    <li
      className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-gray-500"
      aria-label={`Jetzt, ${now} Uhr`}
    >
      <span className="bg-moto-green h-px flex-1" aria-hidden="true"></span>
      Jetzt · {now} Uhr
      <span className="bg-moto-green h-px flex-1" aria-hidden="true"></span>
    </li>
  );
}

/** Ein eigener Block: dieselben Angaben wie die Zeile am Desktop. */
function MyDayRow({
  block,
  now,
  nowLine,
  dayPlanHref,
  tenantPath,
  busy,
  onStart,
  startInBar = false,
  next = false,
}: {
  /** Der nächste Block, der noch beginnt: nur er nennt „in …“. */
  readonly next?: boolean;
  readonly block: PlannedTimetableInstance;
  readonly now: string;
  readonly nowLine: boolean;
  readonly dayPlanHref: string;
  readonly tenantPath: (path: string) => string;
  readonly busy: boolean;
  readonly onStart: (block: PlannedTimetableInstance) => void;
  /** Die Leiste über der Pill startet diesen Block. */
  readonly startInBar?: boolean;
}) {
  const running = block.status === "active";
  const cancelled = block.status === "cancelled";
  const clock = useMinuteClock();
  const startable =
    !startInBar &&
    block.status === "planned" &&
    canStartPlannedInstance(block, clock);
  const isDuty = block.isDuty === true;
  const ended =
    block.status === "planned" && now !== "" && block.endTime <= now;
  const over = block.status === "completed" || ended;
  const href =
    running && block.activeGroupId
      ? tenantPath(`/active-supervisions?session=${block.activeGroupId}`)
      : dayPlanHref;
  const room =
    block.roomName ??
    (isDuty && block.roomId === "0" ? null : `Raum ${block.roomId}`);
  // Eine Angabenzeile, am Telefon nie mehr als eine Zeile: Raum, Kinder,
  // Gruppe, Personal kurz („Anna Müller +1“). Gekürzt wird hinten, also
  // zuerst das Personal (das bist meist du) und die Gruppe; alle Namen
  // samt Vertretung stehen im Tagesplan, wohin die Zeile führt.
  const parts = cancelled
    ? [block.cancelReason ? `Fällt aus · ${block.cancelReason}` : "Fällt aus"]
    : [
        room,
        isDuty ? "Dienst" : blockChildrenLabel(block),
        block.groupName,
        blockStaffShort(block),
      ].filter((part): part is string => Boolean(part));
  const overLabel =
    block.status === "completed"
      ? "Beendet"
      : ended
        ? // Kurz wie im Tagesplan; „nicht gestartet“ steht dort im Blatt.
          "Vorbei"
        : null;
  const tone = over ? "text-gray-600" : "text-gray-900";
  // Spätere Blöcke ohne „in …“: Beginn und Ende stehen links.
  const hiddenAhead =
    startable || block.isAbsent || overLabel || cancelled || next
      ? null
      : blockAheadLabel(block, now);
  const stateText =
    startable || hiddenAhead
      ? null
      : block.isAbsent
        ? "Du fehlst"
        : (overLabel ?? blockStateLabel(block, now));
  const state =
    startable || hiddenAhead ? null : block.isAbsent ? (
      <StatusBadge tone="gray" label="Du fehlst" size="xs" />
    ) : overLabel ? (
      <StatusBadge tone="gray" label={overLabel} size="xs" />
    ) : (
      <BlockState block={block} now={now} size="xs" />
    );
  return (
    <>
      {nowLine ? <NowLineRow now={now} /> : null}
      <CollectionRow
        wrap
        href={href}
        aria-label={`${block.title}${block.isSubstitute ? " Vertretung" : ""}${stateText ? ` ${stateText}` : ""}, ${hasOpenEnd(block) ? `seit ${block.startTime}` : `${block.startTime} bis ${block.endTime}`}: ${running ? "Kinderliste öffnen" : "unter Heute öffnen"}`}
        leading={
          <span className="w-11 self-start text-sm leading-5 tabular-nums">
            <span
              className={cn(
                "block font-semibold",
                running ? "text-moto-green-strong" : tone,
              )}
            >
              {block.startTime}
            </span>
            {/* Beginn und Ende wie jede Zeile; ein spontaner Block hat noch
                kein Ende („offen“). */}
            <span className="block text-gray-600">
              {hasOpenEnd(block) ? "offen" : block.endTime}
            </span>
          </span>
        }
        title={
          <span
            className={cn(
              over && "text-gray-600",
              running && "font-semibold",
              cancelled && "line-through decoration-gray-400",
            )}
          >
            {block.title}
            {block.isSubstitute ? (
              <span className="ml-1.5 text-xs font-normal text-gray-600">
                Vertretung
              </span>
            ) : null}
            {/* Der Zustand steht hinter dem Titel, nicht rechts daneben:
                so bleibt der Angabenzeile die ganze Breite. */}
            {state ? (
              <>
                {" "}
                <span className="ml-0.5 inline-flex align-[1px] font-normal no-underline">
                  {state}
                </span>
              </>
            ) : null}
          </span>
        }
        subtitle={
          parts.length > 0 ? (
            <BlockRowParts
              parts={parts.map((text, index) => ({
                key: String(index),
                text,
                danger: cancelled,
              }))}
            />
          ) : undefined
        }
        action={
          startable ? (
            <Button
              type="button"
              size="md"
              variant="success"
              disabled={busy}
              onClick={() => onStart(block)}
              tooltip={START_OWN_BLOCK_TOOLTIP}
            >
              {busy ? "Startet..." : "Starten"}
            </Button>
          ) : undefined
        }
      />
    </>
  );
}

/**
 * Angaben mit „ · “ dazwischen, die nur zwischen den Teilen umbrechen: kein
 * „+3“ oder „7“ allein in der nächsten Zeile.
 */
function NoOrphanParts({ parts }: { readonly parts: readonly string[] }) {
  return parts.map((part, index) => (
    <Fragment key={`${index}-${part}`}>
      {index > 0 ? " " : null}
      <span className="inline-block max-w-full">
        {part}
        {index < parts.length - 1 ? (
          <span className="text-gray-500"> ·</span>
        ) : null}
      </span>
    </Fragment>
  ));
}

// ─── Meine Gruppe ──────────────────────────────────────────────────────────

/**
 * „Meine Gruppe heute“ wie am Desktop: Stand der Gruppe, wer fehlt noch,
 * wer wird wann abgeholt (mit Notiz der Eltern), wer ist nicht da, und der
 * Weg zur Gruppe.
 */
export function MyGroupCard() {
  const tenantPath = useTenantAwarePath();
  const now = useBerlinClock();
  const snapshot = useHomeGroup(true, now);
  const { group, present, total, away, missing, pickups, isLoading, error } =
    snapshot;
  const loadError = useSwrLoadError(
    error,
    "die Karte „Meine Gruppe heute“",
    snapshot.retry,
  );
  const href = tenantPath("/ogs-groups");
  const missingIds = new Set(missing.map((entry) => entry.student.id));
  type Row =
    | { kind: "missing"; entry: (typeof missing)[number] }
    | { kind: "pickup"; entry: (typeof pickups)[number] }
    | { kind: "away"; student: (typeof away)[number] };
  const all: Row[] = [
    ...missing.map((entry): Row => ({ kind: "missing", entry })),
    ...pickups.map((entry): Row => ({ kind: "pickup", entry })),
    ...away
      .filter((student) => !missingIds.has(student.id))
      .map((student): Row => ({ kind: "away", student })),
  ];
  const { shown, hidden } = useHomeCardRows(all, 6);
  const label = group
    ? group.viaSubstitution
      ? `${group.name} (Vertretung)`
      : group.name
    : null;

  // Die Notiz ist der Grund der Ausnahme: sie bricht zwischen Klasse und
  // Notiz in die nächste Zeile um, statt gekürzt zu werden
  // („Sporttermin, Freit…“).
  const subtitle = (
    schoolClass: string | null | undefined,
    note: string | null | undefined,
  ) => {
    const parts = [schoolClass, note].filter((part): part is string =>
      Boolean(part),
    );
    return parts.length > 0 ? <NoOrphanParts parts={parts} /> : undefined;
  };

  let rows: ReactNode;
  if (loadError) {
    rows = (
      <li className="p-4">
        <LoadErrorAlert error={loadError} />
      </li>
    );
  } else if ((isLoading && !group) || error) {
    rows = <LoadingRow />;
  } else if (!group) {
    rows = (
      <CollectionRow
        wrap
        title="Dir ist heute keine Gruppe zugeteilt"
        subtitle="Sobald du eine Gruppe betreust, steht ihr Stand hier."
      />
    );
  } else {
    rows = (
      <>
        {all.length === 0 ? (
          <CollectionRow title="Alle da, keine Abholung mehr heute" />
        ) : null}
        {shown.map((row) => {
          if (row.kind === "missing") {
            const { student, expected, note } = row.entry;
            return (
              <CollectionRow
                key={`missing-${student.id}`}
                wrap
                title={`${student.first_name} ${student.last_name}`}
                subtitle={subtitle(student.school_class, note)}
                meta={<TimeMeta time={expected} label="Fehlt noch" danger />}
                href={href}
              />
            );
          }
          if (row.kind === "pickup") {
            const { student, time, note, isException } = row.entry;
            return (
              <CollectionRow
                key={`pickup-${student.id}`}
                wrap
                title={`${student.first_name} ${student.last_name}`}
                subtitle={subtitle(student.school_class, note)}
                meta={
                  <TimeMeta
                    time={time}
                    label={
                      isException ? (
                        <StatusBadge
                          tone="warning"
                          label="Ausnahme"
                          size="xs"
                        />
                      ) : (
                        "Abholung"
                      )
                    }
                  />
                }
                href={href}
              />
            );
          }
          const { student } = row;
          return (
            <CollectionRow
              key={`away-${student.id}`}
              wrap
              title={`${student.first_name} ${student.last_name}`}
              subtitle={subtitle(
                student.school_class,
                student.arrival_notes || undefined,
              )}
              meta={
                <AwayBadge
                  student={student}
                  onlyIfLessonCancelled={snapshot.onlyIfLessonCancelled.has(
                    student.id,
                  )}
                />
              }
              href={href}
            />
          );
        })}
      </>
    );
  }

  return (
    <Collection label="Meine Gruppe heute">
      <CollectionGroup
        title={<Head concept={groupsConcept}>Meine Gruppe heute</Head>}
        meta={group ? `${present} von ${total} da` : undefined}
      >
        {rows}
        <CollectionRow
          title="Zur Gruppe"
          subtitle={label ?? undefined}
          meta={
            <LinkRowMeta>
              {hidden > 0
                ? `${hidden} ${hidden === 1 ? "weiteres Kind" : "weitere Kinder"}`
                : null}
            </LinkRowMeta>
          }
          href={href}
        />
      </CollectionGroup>
    </Collection>
  );
}

/** Rechts in der Zeile: Uhrzeit und was sie bedeutet, untereinander. */
function TimeMeta({
  time,
  label,
  danger = false,
}: {
  readonly time: string;
  readonly label: ReactNode;
  readonly danger?: boolean;
}) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="font-semibold text-gray-900 tabular-nums">{time}</span>
      <span
        className={cn(
          "text-xs",
          danger ? "text-moto-red-strong" : "text-gray-600",
        )}
      >
        {label}
      </span>
    </span>
  );
}

// ─── Geburtstage ───────────────────────────────────────────────────────────

/**
 * „Geburtstage“ wie am Desktop: die ganze Woche mit Tag, Gruppe, Klasse und
 * Alter, heute grün markiert, und Blättern in die Wochen davor und danach.
 */
export function BirthdaysCard({
  current,
  currentLoading,
  currentError,
  onRetryCurrent,
}: {
  readonly current: BirthdayOverview | undefined;
  readonly currentLoading: boolean;
  readonly currentError?: unknown;
  readonly onRetryCurrent?: () => unknown;
}) {
  const week = useBirthdayWeek({
    current,
    currentLoading,
    currentError,
    onRetryCurrent,
  });
  const celebrations = week.shown?.celebrations ?? [];
  const today = week.shown?.today ?? "";

  let rows: ReactNode;
  if (week.loadError) {
    rows = (
      <li className="p-4">
        <LoadErrorAlert error={week.loadError} />
      </li>
    );
  } else if (week.isLoading) {
    rows = <LoadingRow />;
  } else if (celebrations.length === 0) {
    rows = <CollectionRow title="Keine Geburtstage in dieser Woche" />;
  } else {
    rows = celebrations.map((entry) => (
      <CollectionRow
        key={`${entry.kind}-${entry.id}`}
        leading={
          // Wochentag über dem Datum wie die Zeitspalte in „Mein Tag“: die
          // Spalte bleibt schmal, die Angaben daneben brechen nicht um.
          <span className="w-11 self-start text-sm leading-5 whitespace-nowrap text-gray-600 tabular-nums">
            {entry.isToday ? (
              <StatusBadge
                label="Heute"
                tone="green"
                size="xs"
                accessibleLabel={`Heute, ${dayLabel(entry.date)}`}
              />
            ) : (
              <>
                <span className="block font-semibold text-gray-900">
                  {dayLabel(entry.date).split(",")[0]}
                </span>
                <span className="block">{dayMonthLabel(entry.date)}</span>
              </>
            )}
          </span>
        }
        wrap
        title={entry.name}
        subtitle={
          describeCelebration(entry, today) ? (
            <NoOrphanParts
              parts={describeCelebration(entry, today).split(" · ")}
            />
          ) : undefined
        }
      />
    ));
  }

  const hasBar = week.hasWeek || !week.isCurrentWeek;
  return (
    <Collection label="Geburtstage">
      <CollectionGroup
        title={<Head concept={birthdaysConcept}>Geburtstage</Head>}
      >
        {hasBar ? (
          <li className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 text-[0.9375rem] leading-5 font-medium text-gray-900">
              {week.weekLabel}
            </span>
            {week.isCurrentWeek ? null : (
              <Button
                type="button"
                variant="ghost"
                size="compact"
                onClick={week.showCurrent}
                tooltip="Zeigt die Geburtstage dieser Woche."
              >
                Diese Woche
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Vorherige Woche"
              tooltip="Zeigt die Geburtstage der Woche davor."
              disabled={!week.previous}
              onClick={week.previous}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Nächste Woche"
              tooltip="Zeigt die Geburtstage der Woche danach."
              disabled={!week.next}
              onClick={week.next}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ) : null}
        {rows}
      </CollectionGroup>
    </Collection>
  );
}

// ─── Offene Anfragen ───────────────────────────────────────────────────────

export interface OpenRequestRow {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly count: number;
  readonly badge?: string;
  readonly href: string;
}

/**
 * „Offene Anfragen“ wie am Desktop: je Art mit Erklärung und Zahl, der Weg
 * zu allen Anfragen und ein Leertext, wenn nichts wartet.
 */
export function OpenRequestsCard({
  rows,
}: {
  readonly rows: readonly OpenRequestRow[];
}) {
  const tenantPath = useTenantAwarePath();
  return (
    <Collection label="Offene Anfragen">
      <CollectionGroup
        title={<Head concept={requestsConcept}>Offene Anfragen</Head>}
        count={rows.length > 0 ? rows.length : undefined}
      >
        {rows.length === 0 ? (
          <CollectionRow
            wrap
            title="Nichts wartet auf eine Entscheidung"
            subtitle="Neue Anfragen von Eltern und aus dem Team erscheinen hier."
          />
        ) : (
          rows.map((row) => (
            <CollectionRow
              key={row.key}
              title={row.label}
              subtitle={row.hint}
              meta={
                <StatusBadge
                  tone="warning"
                  label={`${row.count} ${row.badge ?? "offen"}`}
                  size="xs"
                />
              }
              href={tenantPath(row.href)}
            />
          ))
        )}
        <CollectionRow
          title="Alle ansehen"
          meta={<LinkRowMeta />}
          href={tenantPath("/anfragen")}
        />
      </CollectionGroup>
    </Collection>
  );
}
