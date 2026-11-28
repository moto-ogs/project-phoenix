"use client";

// Tagesplan in der App (#8070, #7795): eine Tagesliste statt Spuren
// nebeneinander. Gleichzeitige Blöcke stehen untereinander in einer
// eingefärbten Gruppe „Gleichzeitig“, die sichtbar endet; auf jedem Gerät
// gleich. Jede Zeile nennt Zeit, Raum, Gruppe, Kinderzahl und Personal. Ein
// Tipp auf einen Block öffnet seine Angaben mit den Aktionen, die der
// Tagesplan heute schon anbietet (Kinderliste öffnen, Aufsicht starten).
//
// Daten, Tageswechsel, Start und Öffnen kommen aus `TagesplanView`; dieser
// Baustein lädt nichts selbst.

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type BlockRowPart,
  blockStaffNames,
  blockStaffShort,
} from "~/components/timetable/block-row-parts";
import type { TagesplanGroup } from "~/components/timetable/tagesplan-groups";
import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { PlanningDayChip } from "~/components/ui/planning/planning-context-bar";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import {
  blockChildrenLabel,
  blockTimeRange,
  hasOpenEnd,
} from "~/lib/block-children";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import { useDeviceContext } from "~/lib/device-context";
import { MOTO_COLOR_PALETTE } from "~/lib/kit-palette";
import { GROUP_ROOM_SHADES, LOCATION_COLORS } from "~/lib/location-helper";
import {
  getGermanWeekdayShort,
  parseTimeToMinutes,
} from "~/lib/timetable-helpers";
import { canStartPlannedInstance } from "~/lib/timetable-lifecycle";
import type { PlannedTimetableInstance } from "~/lib/timetable-operations-types";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Tag

function shiftISO(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * Titel des Kopfs: „Heute“, „Morgen“, „Gestern“, sonst „Tagesplan“. Das
 * Datum steht nur in der Tagesleiste, nicht doppelt im Titel.
 */
export function tagesplanAppTitle(day: string, today: string): string {
  if (day === today) return "Heute";
  if (day === shiftISO(today, 1)) return "Morgen";
  if (day === shiftISO(today, -1)) return "Gestern";
  return "Tagesplan";
}

/** Tag im schmalen Kopf: „Do, 26.11.“ (die Wochenleiste ist eingeklappt). */
export function tagesplanCompactDate(day: string): string {
  const [, month, date] = day.split("-");
  return `${getGermanWeekdayShort(parseISODate(day))}, ${date}.${month}.`;
}

const MAX_STRIP_DAYS = 5;

/**
 * Montag bis Freitag der Woche von `day`; an einem Wochenendtag Dienstag
 * bis Freitag und dieser Tag.
 */
function weekDays(day: string): string[] {
  const d = parseISODate(day);
  const weekday = d.getDay(); // 0 = So
  const monday = shiftISO(day, weekday === 0 ? -6 : 1 - weekday);
  const days = [0, 1, 2, 3, 4].map((offset) => shiftISO(monday, offset));
  if (weekday === 6 || weekday === 0) days.push(day);
  // Höchstens fünf Tage: Mit einem sechsten Chip am Wochenende wurde jeder
  // am iPhone SE schmaler als die 44-px-Trefferfläche. Am Wochenende endet
  // die Leiste beim gewählten Tag; den Montag erreicht der Pfeil.
  return days.slice(-MAX_STRIP_DAYS);
}

/**
 * Tagesleiste: Pfeile für den vorigen und nächsten Betreuungstag,
 * dazwischen die Tage der Woche mit Datum. „Heute“ erscheint, sobald heute
 * nicht in der Leiste steht.
 */
export function TagesplanDayBar({
  day,
  today,
  onSelect,
  onPrevious,
  onNext,
}: Readonly<{
  day: string;
  today: string;
  onSelect: (iso: string) => void;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  const days = weekDays(day);
  const todayInStrip = days.includes(today);
  // Die Tageschips tragen am Telefon nur den Tag („26.“), auf jedem Gerät
  // gleich: Mit Monat passte die Leiste am iPhone SE nicht. Das volle Datum
  // des gewählten Tags steht im Kopf („Fr, 27.11.“), auch über einen
  // Monatswechsel hinweg eindeutig. Nur die breite Fassung außerhalb der
  // Telefon-Ansicht zeigt in anderen Wochen den Monat mit.
  const { isApp } = useDeviceContext();
  const withMonth = !isApp && !todayInStrip;
  return (
    <div className="flex items-center gap-1" data-tagesplan-day-bar="">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Vorheriger Tag"
        tooltip="Zeigt den Plan des vorherigen Betreuungstags."
        // Abstand zum Rand der Leiste, sonst schneidet sie die 44-px-Fläche.
        className="ml-1 shrink-0"
        onClick={onPrevious}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Button>
      <div className="mx-1 flex min-w-0 flex-1 gap-1.5">
        {days.map((iso) => {
          const date = parseISODate(iso);
          const weekday = getGermanWeekdayShort(date);
          return (
            <PlanningDayChip
              key={iso}
              stacked
              weekdayLabel={weekday}
              dateLabel={`${String(date.getDate()).padStart(2, "0")}.${
                withMonth
                  ? `${String(date.getMonth() + 1).padStart(2, "0")}.`
                  : ""
              }`}
              selected={iso === day}
              today={iso === today}
              onClick={() => onSelect(iso)}
            />
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Nächster Tag"
        tooltip="Zeigt den Plan des nächsten Betreuungstags."
        className="shrink-0"
        onClick={onNext}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </Button>
      {todayInStrip ? null : (
        <Button
          type="button"
          variant="outline"
          size="compact"
          className="mr-1 shrink-0"
          tooltip="Zeigt den Plan von heute."
          onClick={() => onSelect(today)}
        >
          Heute
        </Button>
      )}
    </div>
  );
}

/**
 * Kennzahlen des Tages für die Chip-Leiste im Kopf: Blöcke, davon deine,
 * und was gerade läuft. Höchstens drei.
 */
export function tagesplanAppStats(
  instances: readonly PlannedTimetableInstance[],
  showMine: boolean,
  scopeHint: string | null,
): { value?: number; label: string }[] {
  const blocks = instances.length;
  const items: { value?: number; label: string }[] = [];
  if (blocks > 0) {
    items.push({ value: blocks, label: blocks === 1 ? "Block" : "Blöcke" });
  }
  if (scopeHint) {
    items.push({ label: scopeHint });
  } else if (showMine) {
    const mine = instances.filter((instance) => instance.isAssigned).length;
    if (mine > 0) items.push({ value: mine, label: "mit dir" });
  }
  const running = instances.filter(
    (instance) => instance.status === "active",
  ).length;
  if (running > 0) {
    items.push({ value: running, label: running === 1 ? "läuft" : "laufen" });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Zustand eines Blocks (dieselben Regeln wie die Zeile am Desktop)

interface BlockState {
  running: boolean;
  openable: boolean;
  startable: boolean;
  /** Startbar und der Beginn ist schon vorbei („Nicht gestartet“). */
  startOverdue: boolean;
  cancelled: boolean;
  over: boolean;
  isDuty: boolean;
  room: string | null;
  /** Kurzer Zustand in Worten, `null` für „kommt noch“ ohne Besonderheit. */
  label: string | null;
}

function blockState(
  instance: PlannedTimetableInstance,
  effectiveEndTime: string,
  ctx: Readonly<{
    isToday: boolean;
    dayIsPast: boolean;
    nowHHMM: string;
    /** Minutentakt der Seite (`useMinuteClock`). */
    now: Date;
  }>,
): BlockState {
  const isDuty = instance.isDuty === true;
  const room =
    instance.roomName ??
    (isDuty && instance.roomId === "0" ? null : `Raum ${instance.roomId}`);
  const running = instance.status === "active";
  const cancelled = instance.status === "cancelled";
  const openable = running && instance.activeGroupId != null;
  const startable =
    !isDuty &&
    ctx.isToday &&
    instance.status === "planned" &&
    canStartPlannedInstance(instance, ctx.now);
  const endedByClock =
    ctx.dayIsPast || (ctx.isToday && effectiveEndTime <= ctx.nowHHMM);
  const ended = instance.status === "planned" && endedByClock;
  const over =
    instance.status === "completed" || ended || (cancelled && endedByClock);
  let label: string | null = null;
  if (cancelled) label = "Fällt aus";
  else if (running) label = "Läuft";
  else if (instance.status === "completed") label = "Beendet";
  else if (ended) label = isDuty ? "Vorbei" : "Vorbei, nicht gestartet";
  return {
    running,
    openable,
    startable,
    startOverdue: startable && ctx.isToday && instance.startTime <= ctx.nowHHMM,
    cancelled,
    over,
    isDuty,
    room,
    label,
  };
}

/**
 * Wie viele Gruppen am Anfang des Tages ganz vorbei sind (kein Block läuft,
 * startet noch oder kommt noch). Sie klappen am Telefon zu einer Zeile ein.
 */
function countPastGroups(
  groups: readonly TagesplanGroup[],
  entries: ReadonlyMap<string, { state: BlockState }>,
): number {
  let count = 0;
  for (const group of groups) {
    const over = group.cells.every((cell) => {
      const state = entries.get(cell.instance.id)?.state;
      return state != null && state.over && !state.running && !state.startable;
    });
    if (!over) break;
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Liste

export interface TagesplanAppProps {
  day: string;
  today: string;
  nowHHMM: string;
  /** Minutentakt der Seite, für „startbereit“. */
  now: Date;
  groups: readonly TagesplanGroup[];
  /** Index der ersten Gruppe, die noch nicht vorbei ist; -1 außer heute. */
  nowIndex: number;
  showMine: boolean;
  startBusyId: string | null;
  onOpenSession: (activeGroupId: string) => void;
  onStart: (instance: PlannedTimetableInstance) => void;
}

interface Entry {
  instance: PlannedTimetableInstance;
  effectiveEndTime: string;
  state: BlockState;
  /** Die anderen Blöcke derselben Gruppe „Gleichzeitig“. */
  parallel: readonly PlannedTimetableInstance[];
  /** Die späteren Blöcke des Tages im selben Raum, nach Beginn. */
  sameRoom: readonly PlannedTimetableInstance[];
  /** Der nächste eigene Block nach diesem, der noch kommt oder läuft. */
  nextOwn: PlannedTimetableInstance | null;
}

export function TagesplanApp(props: TagesplanAppProps) {
  const {
    day,
    today,
    nowHHMM,
    now,
    groups,
    nowIndex,
    showMine,
    startBusyId,
    onOpenSession,
    onStart,
  } = props;
  const isToday = day === today;

  const entries = useMemo(() => {
    const map = new Map<string, Entry>();
    const all = groups.flatMap((group) =>
      group.cells.map((cell) => cell.instance),
    );
    const roomOf = (instance: PlannedTimetableInstance) =>
      instance.roomId && instance.roomId !== "0" ? instance.roomId : null;
    // „Danach“ heißt heute: was noch kommt oder läuft. Abends standen sonst
    // längst vergangene Blöcke da.
    const stillToCome = (other: PlannedTimetableInstance) =>
      !isToday ||
      other.status === "active" ||
      hasOpenEnd(other) ||
      other.endTime > nowHHMM;
    for (const group of groups) {
      for (const cell of group.cells) {
        map.set(cell.instance.id, {
          instance: cell.instance,
          effectiveEndTime: cell.effectiveEndTime,
          parallel: group.cells
            .filter((other) => other.instance.id !== cell.instance.id)
            .map((other) => other.instance),
          sameRoom: roomOf(cell.instance)
            ? all
                .filter(
                  (other) =>
                    other.id !== cell.instance.id &&
                    other.startTime > cell.instance.startTime &&
                    roomOf(other) === roomOf(cell.instance) &&
                    stillToCome(other),
                )
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
            : [],
          nextOwn:
            all
              .filter(
                (other) =>
                  other.id !== cell.instance.id &&
                  other.isAssigned &&
                  other.isDuty !== true &&
                  other.status !== "cancelled" &&
                  other.startTime > cell.instance.startTime &&
                  stillToCome(other),
              )
              .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ??
            null,
          state: blockState(cell.instance, cell.effectiveEndTime, {
            isToday,
            dayIsPast: day < today,
            nowHHMM,
            now,
          }),
        });
      }
    }
    return map;
  }, [groups, isToday, day, today, nowHHMM, now]);

  // „Als Nächstes“: der früheste Beginn nach jetzt, nur heute.
  const nextStart = useMemo(() => {
    if (!isToday) return null;
    let earliest: string | null = null;
    for (const { instance, state } of entries.values()) {
      if (state.cancelled || state.over || state.running) continue;
      if (instance.startTime <= nowHHMM) continue;
      if (earliest == null || instance.startTime < earliest) {
        earliest = instance.startTime;
      }
    }
    return earliest;
  }, [entries, isToday, nowHHMM]);

  // Auswahl: ein Blatt über der Liste.
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheetEntry = sheetId ? entries.get(sheetId) : undefined;

  // Beim Öffnen von heute zur Jetzt-Linie scrollen (einmal je Tag). Kommt
  // man aus einer Kinderliste zurück, stellt `TagesplanView` danach die
  // gemerkte Position wieder her.
  const nowRef = useRef<HTMLDivElement>(null);
  const scrolledForDay = useRef<string | null>(null);
  // Ziel sind der laufende und der eigene startbereite Block (den startet
  // die Leiste über der Pill); gibt es keinen, der nächste; erst wenn keiner
  // mehr kommt, die Jetzt-Linie. Sonst öffnete die Seite abends am
  // Listenende, während ein spontaner Block („seit 00:03“) oben läuft.
  const scrollTargetIds = useMemo(() => {
    const all = [...entries.values()];
    const startable = all
      .filter(
        (entry) =>
          entry.state.startable && (!showMine || entry.instance.isAssigned),
      )
      .sort((a, b) =>
        a.instance.startTime.localeCompare(b.instance.startTime),
      )[0]?.instance.id;
    const running = all.find((entry) => entry.state.running)?.instance.id;
    const ids = [startable, running].filter((id): id is string => !!id);
    if (ids.length > 0) return ids;
    const next = all.find(
      (entry) => entry.instance.startTime === nextStart && !entry.state.over,
    )?.instance.id;
    return next ? [next] : [];
  }, [entries, nextStart, showMine]);
  const scrollTargetKey = scrollTargetIds.join(",");
  useEffect(() => {
    if (!isToday || scrolledForDay.current === day) return;
    if (groups.length === 0) return;
    scrolledForDay.current = day;
    const rows = scrollTargetKey
      .split(",")
      .filter(Boolean)
      .map((id) =>
        document
          .querySelector(`[data-tagesplan-row="${id}"]`)
          ?.closest<HTMLElement>("[data-collection-row]"),
      )
      .filter((row): row is HTMLElement => row != null);
    const limit = window.innerHeight - BOTTOM_BARS_PX;
    // Das Ziel reicht bis zur Jetzt-Linie, wenn sie direkt darunter steht.
    const bottomOf = (element: HTMLElement) => {
      const line = nowRef.current;
      const bottom = element.getBoundingClientRect().bottom;
      if (!line) return bottom;
      const lineRect = line.getBoundingClientRect();
      return lineRect.top >= bottom && lineRect.top - bottom < 8
        ? lineRect.bottom
        : bottom;
    };
    if (rows.length === 0) {
      const marker = nowRef.current;
      if (!marker || marker.getBoundingClientRect().bottom <= limit) return;
      // Mittig, damit über der Linie sichtbar bleibt, was zuletzt lief.
      marker.scrollIntoView({ block: "center" });
      return;
    }
    // Nur scrollen, wenn ein Ziel nicht ganz über Aktionsleiste und Pill
    // steht; sonst bleibt der Kopf mit der Tagesleiste im Bild.
    if (rows.every((row) => bottomOf(row) <= limit)) return;
    // Der obere der Blöcke steht unter der klebenden Kopfkarte. Reicht die
    // Höhe nicht für beide, gewinnt der startbereite (erstes Ziel).
    const sorted = [...rows].sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
    );
    const top = sorted[0]!;
    const span = bottomOf(sorted.at(-1)!) - top.getBoundingClientRect().top;
    const anchor = span > limit - STICKY_HEAD_PX ? rows[0]! : top;
    anchor.style.scrollMarginTop = NOW_SCROLL_MARGIN.scrollMarginTop as string;
    anchor.scrollIntoView({ block: "start" });
  }, [isToday, day, groups.length, scrollTargetKey]);

  // Der früheste eigene startbereite Block: ihn startet die Leiste über
  // der Pill (Telefon).
  const ownStart = [...entries.values()]
    .filter(
      (entry) =>
        entry.state.startable && (!showMine || entry.instance.isAssigned),
    )
    .sort((a, b) =>
      a.instance.startTime.localeCompare(b.instance.startTime),
    )[0];

  const renderRow = (
    cell: { instance: PlannedTimetableInstance },
    inPast = false,
  ) => {
    const entry = entries.get(cell.instance.id);
    if (!entry) return null;
    // Erreichbarkeit (#8070): Ist ein weiterer eigener Block startbereit,
    // steht „Starten“ wie am Desktop und auf der Startseite in seiner Zeile;
    // die Leiste startet nur den frühesten.
    const rowStart =
      entry.state.startable &&
      entry.instance.isAssigned &&
      entry.instance.id !== ownStart?.instance.id;
    return (
      <BlockRow
        key={entry.instance.id}
        entry={entry}
        next={entry.instance.startTime === nextStart && !entry.state.over}
        mine={showMine && entry.instance.isAssigned}
        inPast={inPast}
        onOpen={() => setSheetId(entry.instance.id)}
        start={
          rowStart
            ? {
                busy: startBusyId === entry.instance.id,
                onStart: () => onStart(entry.instance),
              }
            : null
        }
      />
    );
  };

  const nowLine = (
    <div ref={nowRef} style={NOW_SCROLL_MARGIN}>
      <NowLine nowHHMM={nowHHMM} />
    </div>
  );

  // Gleichzeitige Blöcke stehen auf jedem Gerät untereinander in einer
  // eingefärbten Gruppe mit Klammer links. Die Gruppe endet sichtbar: der
  // nächste Block steht wieder auf Weiß. Ihr Kopf klebt, solange Blöcke der
  // Gruppe im Bild sind: Er bleibt in seiner Gruppe (Sticky endet an ihrem
  // Rand) und steht so nie über einem fremden Block.
  // Eine Gruppe „Gleichzeitig“, die schon begonnen hat, kann Blöcke
  // enthalten, die erst nach jetzt beginnen (15:00–17:00 mit der
  // Busaufsicht um 16:00). Dann steht die Jetzt-Linie in der Gruppe vor
  // dem ersten dieser Blöcke statt unter der ganzen Gruppe.
  const splitAt = (group: TagesplanGroup) =>
    nowIndex === -1 || group.cells.length < 2
      ? -1
      : group.cells.findIndex((cell) => cell.instance.startTime > nowHHMM);
  const lineInGroup =
    nowIndex > 0 && groups[nowIndex - 1]
      ? splitAt(groups[nowIndex - 1]!) > 0
      : false;

  // Telefon, heute: Was schon vorbei ist, steht eingeklappt als eine Zeile
  // „8 Blöcke vorbei“ oben. So öffnet die Seite ohne Scrollen mit dem Kopf
  // samt Tagesleiste, und der laufende Block steht im ersten Bild.
  const pastGroups = isToday ? countPastGroups(groups, entries) : 0;
  const pastBlocks = groups
    .slice(0, pastGroups)
    .reduce((sum, group) => sum + group.cells.length, 0);
  const collapsible = pastBlocks >= 2;
  const [pastOpen, setPastOpen] = useState(false);
  const hidePast = collapsible && !pastOpen;
  const pastToggle = collapsible ? (
    <div>
      <CollectionList>
        <CollectionRow
          title={`${pastBlocks} Blöcke vorbei`}
          subtitle={`${groups[0]!.startTime}–${groups
            .slice(0, pastGroups)
            .reduce(
              (latest, group) =>
                group.endTime > latest ? group.endTime : latest,
              groups[0]!.endTime,
            )}`}
          aria-label={`${pastBlocks} Blöcke vorbei, ${pastOpen ? "ausblenden" : "anzeigen"}`}
          meta={
            <span className="inline-flex items-center gap-1.5">
              {pastOpen ? "Ausblenden" : "Anzeigen"}
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-gray-500 transition-transform",
                  pastOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </span>
          }
          onClick={() => setPastOpen((open) => !open)}
        />
      </CollectionList>
    </div>
  ) : null;

  const list = (
    <Collection
      label="Blöcke des Tages"
      // Beginn und Ende stehen auf Höhe des Titels, auch wenn die Angaben
      // darunter umbrechen. Am SE 54 statt 58 px je Zeile (erlaubt sind
      // 44–55 px, die ganze Zeile bleibt Trefferfläche): so stehen mehr
      // Blöcke im ersten Bild.
      className="max-[389px]:[&_[data-collection-row]]:min-h-12 max-[389px]:[&_[data-collection-row]]:py-1.5 [&_[data-collection-row]>span:first-child]:self-start"
    >
      {pastToggle}
      {groups.map((group, index) =>
        hidePast && index < pastGroups ? null : (
          <Fragment key={group.key}>
            {index === nowIndex && !lineInGroup ? nowLine : null}
            {group.cells.length === 1 ? (
              <div className="border-gray-100 [&:not(:first-child)]:border-t">
                <CollectionList>
                  {renderRow(
                    group.cells[0]!,
                    collapsible && index < pastGroups,
                  )}
                </CollectionList>
              </div>
            ) : (
              <div
                data-tagesplan-parallel=""
                className="relative border-gray-200 before:absolute before:top-10 before:bottom-3 before:left-1.5 before:w-1 before:rounded-full before:bg-gray-300 before:content-[''] [&_[data-collection-group]>div:first-child]:bg-gray-100 [&:not(:first-child)]:border-t [&:not(:last-child)]:border-b"
              >
                <CollectionGroup
                  title={
                    <span className="tabular-nums">
                      Gleichzeitig ·{" "}
                      {group.openEnd && group.endTime <= group.startTime
                        ? `ab ${group.startTime}`
                        : `${group.startTime}–${group.endTime}`}
                    </span>
                  }
                  meta={`${group.cells.length} Blöcke`}
                >
                  {group.cells.map((cell, cellIndex) =>
                    index === nowIndex - 1 &&
                    lineInGroup &&
                    cellIndex === splitAt(group) ? (
                      <Fragment key={`jetzt-${cell.instance.id}`}>
                        <li className="list-none">{nowLine}</li>
                        {renderRow(cell)}
                      </Fragment>
                    ) : (
                      renderRow(cell, collapsible && index < pastGroups)
                    ),
                  )}
                </CollectionGroup>
              </div>
            )}
          </Fragment>
        ),
      )}
      {nowIndex === groups.length && !lineInGroup ? nowLine : null}
    </Collection>
  );

  const actionFor = (entry: Entry) => (
    <BlockAction
      entry={entry}
      busy={startBusyId === entry.instance.id}
      onOpenSession={onOpenSession}
      onStart={onStart}
    />
  );

  // Am Telefon steht „Starten“ nicht als Knopf in der Zeile (die Zeile
  // brach dadurch auf vier Zeilen um): Die Zeile trägt „Nicht gestartet“
  // bzw. „Startbereit“, ihr Blatt den Knopf. Der eigene startbereite Block
  // ist die häufigste Aktion der Seite und steht in der Leiste über der
  // Pill. Blöcke anderer startet man wie am Desktop, über ihr Blatt.

  return (
    <>
      {list}
      {ownStart && sheetEntry == null ? (
        <ActionBar>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="min-w-0 flex-1"
            disabled={startBusyId === ownStart.instance.id}
            tooltip="Startet die Aufsicht für diesen Termin und öffnet sie."
            onClick={() => onStart(ownStart.instance)}
          >
            <span className="truncate">
              {startBusyId === ownStart.instance.id
                ? "Startet..."
                : `${ownStart.instance.title} starten`}
            </span>
          </Button>
        </ActionBar>
      ) : null}
      <OverlaySheet
        open={sheetEntry != null}
        onOpenChange={(open) => {
          if (!open) setSheetId(null);
        }}
        title={sheetEntry?.instance.title ?? ""}
        footer={
          sheetEntry &&
          (sheetEntry.state.openable || sheetEntry.state.startable)
            ? actionFor(sheetEntry)
            : undefined
        }
      >
        {sheetEntry ? (
          <BlockDetail
            entry={sheetEntry}
            next={
              sheetEntry.instance.startTime === nextStart &&
              !sheetEntry.state.over
            }
            mine={showMine && sheetEntry.instance.isAssigned}
          />
        ) : null}
      </OverlaySheet>
    </>
  );
}

/** Höhe von schwebender Aktionsleiste und Pill samt Abständen, in px. */
const BOTTOM_BARS_PX = 170;
/** Schmale Kopfkarte samt Abstand, unter der ein Ziel beim Öffnen steht. */
const STICKY_HEAD_PX = 80;

// ---------------------------------------------------------------------------
// Zeile und Angaben

// Die Jetzt-Linie bleibt beim Hinscrollen unter der klebenden Tagesleiste.
const NOW_SCROLL_MARGIN: CSSProperties = {
  scrollMarginTop: "calc(var(--app-sticky-offset, 0px) + 0.5rem)",
};

function NowLine({ nowHHMM }: Readonly<{ nowHHMM: string }>) {
  return (
    <div
      className="flex items-center gap-2 border-t border-gray-100 px-4 py-1.5 first:border-t-0"
      data-tagesplan-now=""
    >
      <span
        className="h-px flex-1"
        style={{ backgroundColor: LOCATION_COLORS.GROUP_ROOM }}
        aria-hidden="true"
      />
      <span
        className="text-xs font-semibold tabular-nums"
        style={{ color: GROUP_ROOM_SHADES.text }}
      >
        Jetzt · {nowHHMM} Uhr
      </span>
      <span
        className="h-px flex-1"
        style={{ backgroundColor: LOCATION_COLORS.GROUP_ROOM }}
        aria-hidden="true"
      />
    </div>
  );
}

/** Farbe der Kennzeichnung „Mit dir“: eigene Farbe, kein Zustand. */
const MINE_COLOR = MOTO_COLOR_PALETTE.indigo.base;

/**
 * Kennzeichnungen in Worten statt Farbcode: Zustand („Läuft“ wie auf der
 * Startseite,
 * „Fällt aus“, „Als Nächstes“) und „Mit dir“ für die eigenen Blöcke.
 */
function blockChips(state: BlockState, next: boolean, mine: boolean) {
  const chips: ReactNode[] = [];
  if (state.running) {
    chips.push(
      <StatusColorBadge
        key="state"
        label="Läuft"
        color={LOCATION_COLORS.GROUP_ROOM}
        compact
      />,
    );
  } else if (state.cancelled) {
    chips.push(
      <StatusColorBadge
        key="state"
        label="Fällt aus"
        color={LOCATION_COLORS.DANGER}
        compact
      />,
    );
  } else if (state.startable) {
    chips.push(
      <StatusColorBadge
        key="state"
        label={startChipLabel(state)}
        color={
          state.startOverdue
            ? LOCATION_COLORS.WARNING
            : LOCATION_COLORS.GROUP_ROOM
        }
        compact
      />,
    );
  } else if (next) {
    chips.push(
      <StatusColorBadge
        key="state"
        label="Als Nächstes"
        color={LOCATION_COLORS.OTHER_ROOM}
        compact
      />,
    );
  }
  if (mine) {
    chips.push(
      <StatusColorBadge
        key="mine"
        label="Mit dir"
        color={MINE_COLOR}
        compact
      />,
    );
  }
  return chips;
}

/** Vorbei ohne gelaufen zu sein (ein gelaufener Block heißt „Beendet“). */
function pastLabel(state: BlockState): boolean {
  return (
    state.over && !state.cancelled && state.label?.startsWith("Vorbei") === true
  );
}

/** Startbar: schon über den Beginn „Nicht gestartet“, sonst „Startbereit“. */
function startChipLabel(state: BlockState): string {
  return state.startOverdue ? "Nicht gestartet" : "Startbereit";
}

/** Die Wörter der Abzeichen von `blockChips`, in derselben Reihenfolge. */
function chipLabels(state: BlockState, next: boolean, mine: boolean) {
  return [
    state.running
      ? "Läuft"
      : state.cancelled
        ? "Fällt aus"
        : state.startable
          ? startChipLabel(state)
          : next
            ? "Als Nächstes"
            : null,
    mine ? "Mit dir" : null,
  ];
}

/**
 * Kinderzahl in der Angabenzeile wie am Desktop: „19 Kinder“, laufend
 * „13 da · 4 nicht mehr im Raum“ (wer gegangen ist, sucht man gerade hier).
 * Auch „0 Kinder“ steht da: Ein Angebot ohne Anmeldung sagt das am Desktop
 * ebenso. Dienste und Ausfälle nennen keine Kinder.
 */
function childrenPart(entry: Entry): string | null {
  if (entry.state.cancelled || entry.state.isDuty) return null;
  return blockChildrenLabel(entry.instance);
}

/**
 * Eine Zeile, 56–64 px wie jede Liste der App: Beginn und Ende links, Titel,
 * darunter eine Angabenzeile mit Zustand, Raum und Kinderzahl. Gruppe,
 * Personal und alle übrigen Angaben stehen vollständig im Blatt.
 */
function BlockRow({
  entry,
  next,
  mine,
  inPast = false,
  onOpen,
  start = null,
}: Readonly<{
  entry: Entry;
  next: boolean;
  mine: boolean;
  /** Steht unter „N Blöcke vorbei“: das Wort „Vorbei“ entfällt. */
  inPast?: boolean;
  onOpen: () => void;
  /** „Starten“ in der Zeile (ein weiterer eigener startbereiter Block). */
  start?: { busy: boolean; onStart: () => void } | null;
}>) {
  const { instance, state } = entry;
  const quiet = state.over ? "text-gray-600" : "text-gray-900";
  const staff = blockStaffNames(instance);
  // Höchstens ein Abzeichen hinter dem Titel (#8070 R21): der Zustand
  // („Läuft“, „Fällt aus“, „Als Nächstes“ …), sonst „Mit dir“. Zwei
  // Abzeichen brachen am Telefon auf eine eigene Zeile um. Was nicht mehr
  // hinter den Titel passt („Mit dir“ neben einem Zustand), steht als Wort
  // in der Angabenzeile; im Blatt stehen alle Abzeichen.
  const chips = blockChips(state, next, mine);
  // Mit „Starten“ in der Zeile entfällt „Startbereit“ (der Knopf sagt es);
  // „Nicht gestartet“ bleibt als Warnung stehen.
  const startHidesChip = start != null && !state.startOverdue;
  const rowChip = startHidesChip ? chips[1] : chips[0];
  const labels = chipLabels(state, next, mine);
  const rowChipLabel = startHidesChip ? labels[1] : (labels[0] ?? labels[1]);
  const mineInMeta = mine && labels[0] != null && !startHidesChip;
  const children = childrenPart(entry);
  const openEnd = hasOpenEnd(instance);
  // Unterzeile: Zustand (vorbei, Dienst), Raum, Kinder, Gruppe, Personal.
  // Sie bricht zwischen den Teilen um statt gekürzt zu werden: am Telefon
  // stand sonst „OGS-Ra…“ und „Anna Müll…“. Ein Ausfall nennt seinen Grund
  // rot wie am Desktop.
  const parts: (BlockRowPart & { mine?: boolean })[] = [];
  const push = (
    key: string,
    text: string | null | undefined,
    danger?: boolean,
    shrink?: BlockRowPart["shrink"],
  ) => {
    if (text) parts.push({ key, text, danger, shrink });
  };
  if (mineInMeta) parts.push({ key: "mine", text: "Mit dir", mine: true });
  // Ein Ausfall trägt immer den roten Chip „Fällt aus“; das Wort steht
  // nicht noch einmal daneben, wohl aber sein Grund.
  // Vorbei: die Zeile ist grau, steht über der Jetzt-Linie und beginnt mit
  // „Beendet“ (lief), „Nicht gestartet“ (lief nie) bzw. „Vorbei“ (Dienst).
  if (state.over && !state.cancelled && instance.status === "completed") {
    push("state", state.label);
  } else if (pastLabel(state) && !state.isDuty) {
    // Wie die Desktop-Metazeile: Ein vergangener Block, der nie lief, heißt
    // „Nicht gestartet“ – auch unter „N Blöcke vorbei“ und an anderen
    // Tagen, nicht nur im Blatt.
    push("state", "Nicht gestartet");
  } else if (pastLabel(state) && !inPast) {
    // Vorbei wie auf der Startseite („Mittagessen Vorbei“), als erstes
    // Wort der Angabenzeile: ein Abzeichen brach die Zeile am SE um.
    // „nicht gestartet“ steht im Blatt.
    push("state", "Vorbei");
  }

  if (state.cancelled) push("reason", instance.cancelReason, true);
  if (state.isDuty) push("duty", "Dienst");
  // Reicht die Zeile nicht (SE), bricht sie zwischen den Teilen um: kein
  // Wort-Stumpf wie „OGS-R…“ und keine Angabe entfällt still.
  push("room", state.room, false, "room");
  push("count", children, false, "count");
  // Erreichbarkeit (#8070): Die Gruppe steht wie am Desktop in der Zeile.
  // Personal kurz („Julia K. +1“, Vertretung benannt): wer betreut, sucht
  // man im Plan. Alle Namen stehen im Blatt.
  push("group", instance.groupName);
  if (!state.cancelled) {
    push("staff", blockStaffShort(instance), false, "staff");
  }
  // Der Bereich („Randzeiten“) steht im Blatt („Bereich“), nicht in der
  // Zeile: als Abzeichen brach er die Titelzeile um, als Wort die
  // Angabenzeile (am SE fast jede Zeile dreizeilig).
  return (
    <CollectionRow
      onClick={onOpen}
      wrap
      action={
        start ? (
          <Button
            type="button"
            size="md"
            variant="success"
            disabled={start.busy}
            onClick={start.onStart}
            tooltip="Startet die Aufsicht für diesen Termin und öffnet sie."
          >
            {start.busy ? "Startet..." : "Starten"}
          </Button>
        ) : undefined
      }
      // Beginnt mit dem sichtbaren Text des Ziels (Titel), damit
      // Sprachsteuerung den Block beim Namen findet (WCAG 2.5.3); das
      // Abzeichen hinter dem Titel gehört zum sichtbaren Namen.
      aria-label={[
        [instance.title, rowChipLabel].filter(Boolean).join(" "),
        blockTimeRange(instance),
        mineInMeta ? "Mit dir" : null,
        state.running || state.cancelled ? null : state.label,
        state.cancelled ? instance.cancelReason : null,
        state.room,
        instance.groupName,
        children,
        state.cancelled ? null : staff,
        instance.planningTrackName,
      ]
        .filter(Boolean)
        .join(", ")}
      leading={
        <span
          data-tagesplan-row={instance.id}
          className="w-11 self-start text-sm leading-5 tabular-nums"
        >
          <span
            className={cn(
              "block font-semibold",
              state.running ? "text-moto-green-strong" : quiet,
            )}
          >
            {instance.startTime}
          </span>
          {/* Beginn und Ende wie jede Zeile; ein spontaner Block hat noch
              kein Ende („offen“, wie auf der Startseite). */}
          <span className="block text-gray-600">
            {openEnd ? "offen" : instance.endTime}
          </span>
        </span>
      }
      title={
        <span
          className={cn(
            state.over && "text-gray-600",
            state.running && "font-semibold",
          )}
        >
          <span
            className={cn(
              state.cancelled && "line-through decoration-gray-400",
            )}
          >
            {instance.title}
          </span>
          {rowChip ? (
            <>
              {" "}
              <span className="inline-flex align-[1px] font-normal">
                {rowChip}
              </span>
            </>
          ) : null}
        </span>
      }
      subtitle={
        parts.length > 0 ? (
          <span className="block">
            {parts.map((part, index) => (
              <Fragment key={part.key}>
                {index > 0 ? " " : null}
                <span
                  className={cn(
                    "inline-block max-w-full",
                    part.danger && "text-moto-red-strong",
                    part.mine && "font-medium",
                  )}
                  style={
                    part.mine
                      ? { color: MOTO_COLOR_PALETTE.indigo.strong }
                      : undefined
                  }
                >
                  {part.text}
                  {index < parts.length - 1 ? (
                    <span className="text-gray-500"> ·</span>
                  ) : null}
                </span>
              </Fragment>
            ))}
          </span>
        ) : undefined
      }
    />
  );
}

/** „1 Std. 30 Min.“, „45 Min.“; `null` ohne festes Ende. */
function durationLabel(instance: PlannedTimetableInstance): string | null {
  if (hasOpenEnd(instance)) return null;
  const end =
    instance.endTime === "00:00"
      ? 24 * 60
      : parseTimeToMinutes(instance.endTime);
  const minutes = end - parseTimeToMinutes(instance.startTime);
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

/** Ab wann ein geplanter Block startbar ist: „ab 06:45 Uhr“. */
function startWindowLabel(instance: PlannedTimetableInstance): string | null {
  if (instance.status !== "planned" || !instance.startAvailableAt) return null;
  const at = new Date(instance.startAvailableAt);
  if (Number.isNaN(at.getTime())) return null;
  const hhmm = at.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  return `ab ${hhmm} Uhr`;
}

function BlockDetail({
  entry,
  next,
  mine,
}: Readonly<{ entry: Entry; next: boolean; mine: boolean }>) {
  const { instance, state, parallel, sameRoom } = entry;
  const staff = instance.staffNames ?? [];
  const chips = blockChips(state, next, mine);
  const duration = durationLabel(instance);
  const startWindow = state.isDuty ? null : startWindowLabel(instance);
  const children = childrenPart(entry);
  // Am Telefon als Liste (Label links, Wert rechts), sonst zwei Spalten.
  return (
    <div className="space-y-4">
      {chips.length > 0 ||
      (!state.running && !state.cancelled && state.label) ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          {chips}
          {!state.running && !state.cancelled && state.label ? (
            <span className="text-gray-600">{state.label}</span>
          ) : null}
        </div>
      ) : null}
      {state.cancelled && instance.cancelReason ? (
        <p className="text-moto-red-strong text-sm">
          Grund: {instance.cancelReason}
        </p>
      ) : null}
      <DataGrid columns={2} appRows>
        <DataField label="Zeit">
          <span className="tabular-nums">
            {blockTimeRange(instance)} Uhr
            {duration ? (
              <span className="font-normal text-gray-600"> · {duration}</span>
            ) : null}
          </span>
        </DataField>
        {state.room ? <DataField label="Raum">{state.room}</DataField> : null}
        {children ? (
          <DataField label="Kinder">
            {children}
            {instance.notScheduledStudentsCount > 0 &&
            instance.status !== "active" ? (
              <span className="block text-xs font-normal text-gray-600">
                {instance.notScheduledStudentsCount} heute nicht eingeplant
              </span>
            ) : null}
          </DataField>
        ) : null}
        {instance.groupName ? (
          <DataField label="Gruppe">{instance.groupName}</DataField>
        ) : null}
        {staff.length > 0 ? (
          <DataField label="Personal">
            <ul>
              {staff.map((person) => (
                <li key={person.staffId}>
                  {person.displayName}
                  {person.isSubstitute ? (
                    <span className="font-normal text-gray-600">
                      {" "}
                      (Vertretung)
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </DataField>
        ) : null}
        {instance.planningTrackName ? (
          <DataField label="Bereich">{instance.planningTrackName}</DataField>
        ) : null}
        {state.isDuty ? <DataField label="Art">Dienst</DataField> : null}
        {startWindow && !state.startable && !state.over ? (
          <DataField label="Starten">{startWindow}</DataField>
        ) : null}
        {parallel.length > 0 ? (
          <DataField label="Gleichzeitig" fullWidth>
            <ul>
              {parallel.map((other) => (
                <li key={other.id}>
                  {other.title}
                  <span className="font-normal text-gray-600">
                    {" · "}
                    {[other.roomName, blockTimeRange(other)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </DataField>
        ) : null}
        {sameRoom.length > 0 && state.room ? (
          // Ein Folgeblock steht einzeilig wie die Felder darüber; der Raum
          // steht direkt darüber. Mehrere stehen als Liste darunter.
          <DataField
            // „im Raum“: gemeint ist der nächste Block in diesem Raum, nicht
            // dein nächster Block (der steht darunter, wenn es deiner ist).
            label="Danach im Raum"
            fullWidth={sameRoom.length > 1}
          >
            <ul>
              {sameRoom.map((other) => (
                <li key={other.id} className="tabular-nums">
                  {blockTimeRange(other)}
                  <span className="font-normal text-gray-600">
                    {" · "}
                    {other.title}
                  </span>
                </li>
              ))}
            </ul>
          </DataField>
        ) : null}
        {mine && entry.nextOwn ? (
          <DataField label="Dein nächster Block">
            <span className="tabular-nums">
              {blockTimeRange(entry.nextOwn)}
              <span className="font-normal text-gray-600">
                {" · "}
                {entry.nextOwn.title}
              </span>
            </span>
          </DataField>
        ) : null}
      </DataGrid>
    </div>
  );
}

/**
 * Nur die Aktionen, die der Tagesplan heute schon hat: einen laufenden
 * Block öffnen, einen eigenen, startbereiten Block starten. Volle Breite.
 */
function BlockAction({
  entry,
  busy,
  onOpenSession,
  onStart,
}: Readonly<{
  entry: Entry;
  busy: boolean;
  onOpenSession: (activeGroupId: string) => void;
  onStart: (instance: PlannedTimetableInstance) => void;
}>) {
  const { instance, state } = entry;
  if (state.openable) {
    return (
      <Button
        type="button"
        variant="primary"
        size="md"
        className="w-full"
        tooltip="Öffnet die Kinderliste dieser Aufsicht."
        onClick={() => onOpenSession(instance.activeGroupId as string)}
      >
        Kinderliste öffnen
      </Button>
    );
  }
  if (state.startable) {
    return (
      <Button
        type="button"
        variant="success"
        size="md"
        className="w-full"
        disabled={busy}
        tooltip="Startet die Aufsicht für diesen Termin und öffnet sie."
        onClick={() => onStart(instance)}
      >
        {busy ? "Startet..." : "Aufsicht starten"}
      </Button>
    );
  }
  return null;
}
