"use client";

// Tagesplan in der App (#8070, #7795): eine Tagesliste statt Spuren
// nebeneinander. Gleichzeitige Blöcke stehen untereinander in einer
// eingefärbten Gruppe „Gleichzeitig“, die sichtbar endet; auf jedem Gerät
// gleich. Jede Zeile nennt Zeit, Raum, Gruppe, Kinderzahl und Personal. Ein
// Tipp auf einen Block öffnet seine Angaben mit den Aktionen, die der
// Tagesplan heute schon anbietet (Kinderliste öffnen, Aufsicht starten).
// Am iPad quer steht die Liste samt Tagesleiste links (⅓), der gewählte
// Block rechts (⅔) mit der Aktion unten in Daumennähe.
//
// Daten, Tageswechsel, Start und Öffnen kommen aus `TagesplanView`; dieser
// Baustein lädt nichts selbst.

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { blockStaffNames } from "~/components/timetable/block-row-parts";
import type { TagesplanGroup } from "~/components/timetable/tagesplan-groups";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { Z_LAYER } from "~/components/ui/overlay-styles";
import { PlanningDayChip } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
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

/** Montag bis Freitag der Woche von `day`; ein Wochenendtag kommt dazu. */
function weekDays(day: string): string[] {
  const d = parseISODate(day);
  const weekday = d.getDay(); // 0 = So
  const monday = shiftISO(day, weekday === 0 ? -6 : 1 - weekday);
  const days = [0, 1, 2, 3, 4].map((offset) => shiftISO(monday, offset));
  if (weekday === 6 || weekday === 0) days.push(day);
  return days;
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
  // Mit Monat wie das Datum am Desktop („25.11.“), damit der Tag auch
  // über den Monatswechsel eindeutig bleibt. Nur in der schmalen
  // Listenspalte (iPad quer) reicht der Tag.
  const { isSplit } = useDeviceContext();
  const withMonth = !isSplit;
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
      <div className="mx-1 flex min-w-0 flex-1 gap-0.5">
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
  else if (ended) label = isDuty ? "Vorbei" : "Nicht gestartet";
  return {
    running,
    openable,
    startable,
    cancelled,
    over,
    isDuty,
    room,
    label,
  };
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
  /**
   * Die Tagesleiste. Am iPad quer steht sie über der Listenspalte statt
   * über der ganzen Breite, damit sie die Detailspalte nie verdeckt.
   */
  dayBar: ReactNode;
}

interface Entry {
  instance: PlannedTimetableInstance;
  effectiveEndTime: string;
  state: BlockState;
  /** Die anderen Blöcke derselben Gruppe „Gleichzeitig“. */
  parallel: readonly PlannedTimetableInstance[];
  /** Die späteren Blöcke des Tages im selben Raum, nach Beginn. */
  sameRoom: readonly PlannedTimetableInstance[];
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
    dayBar,
  } = props;
  const { isSplit } = useDeviceContext();
  const isToday = day === today;

  const entries = useMemo(() => {
    const map = new Map<string, Entry>();
    const all = groups.flatMap((group) =>
      group.cells.map((cell) => cell.instance),
    );
    const roomOf = (instance: PlannedTimetableInstance) =>
      instance.roomId && instance.roomId !== "0" ? instance.roomId : null;
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
                    roomOf(other) === roomOf(cell.instance),
                )
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
            : [],
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

  // Auswahl: am iPad quer in der Adresse (Liste neben Detail), sonst ein
  // Blatt über der Liste.
  const { selected, select } = useSplitSelection("block");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheetEntry = sheetId ? entries.get(sheetId) : undefined;

  // Am iPad quer ist immer ein Block gewählt: der laufende, sonst der
  // nächste, sonst der erste des Tages.
  const defaultId = useMemo(() => {
    const all = [...entries.values()];
    return (
      all.find((entry) => entry.state.running)?.instance.id ??
      all.find((entry) => entry.instance.startTime === nextStart)?.instance
        .id ??
      all[0]?.instance.id ??
      null
    );
  }, [entries, nextStart]);
  const splitId = isSplit
    ? selected && entries.has(selected)
      ? selected
      : defaultId
    : null;
  const splitEntry = splitId ? entries.get(splitId) : undefined;

  // Beim Öffnen von heute zur Jetzt-Linie scrollen (einmal je Tag). Kommt
  // man aus einer Kinderliste zurück, stellt `TagesplanView` danach die
  // gemerkte Position wieder her.
  const nowRef = useRef<HTMLDivElement>(null);
  const scrolledForDay = useRef<string | null>(null);
  useEffect(() => {
    if (!isToday || scrolledForDay.current === day || isSplit) return;
    if (groups.length === 0) return;
    scrolledForDay.current = day;
    const marker = nowRef.current;
    if (!marker) return;
    const top = marker.getBoundingClientRect().top;
    // Nur scrollen, wenn die Linie unterhalb der ersten Bildschirmhälfte
    // steht; sonst bleibt der Kopf im Bild.
    // Mittig, damit über der Linie sichtbar bleibt, was gerade läuft.
    if (top > window.innerHeight * 0.5) {
      marker.scrollIntoView({ block: "center" });
    }
  }, [isToday, day, groups.length, isSplit]);

  // Am iPad quer steht die vorgewählte Zeile (meist der laufende Block)
  // im eigenen Scroll der Liste im Bild, einmal je Tag.
  const splitScrolledForDay = useRef<string | null>(null);
  useEffect(() => {
    if (!isSplit || splitId == null || splitScrolledForDay.current === day) {
      return;
    }
    splitScrolledForDay.current = day;
    const pane = document.querySelector<HTMLElement>("[data-split-list]");
    const row = pane?.querySelector<HTMLElement>(
      "[data-collection-row][data-selected]",
    );
    if (!pane || !row) return;
    const offset =
      row.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTop += offset - pane.clientHeight / 3;
  }, [isSplit, splitId, day]);

  const splitTop = useSplitTop(isSplit);

  const openEntry = (id: string) => {
    if (isSplit) select(id);
    else setSheetId(id);
  };

  const renderRow = (cell: { instance: PlannedTimetableInstance }) => {
    const entry = entries.get(cell.instance.id);
    if (!entry) return null;
    return (
      <BlockRow
        key={entry.instance.id}
        entry={entry}
        next={entry.instance.startTime === nextStart && !entry.state.over}
        mine={showMine && entry.instance.isAssigned}
        selected={splitId === entry.instance.id}
        onOpen={() => openEntry(entry.instance.id)}
        action={
          entry.state.startable && !isSplit ? (
            <Button
              type="button"
              variant="success"
              size="md"
              disabled={startBusyId === entry.instance.id}
              tooltip="Startet die Aufsicht für diesen Termin und öffnet sie."
              onClick={() => onStart(entry.instance)}
            >
              {startBusyId === entry.instance.id ? "Startet..." : "Starten"}
            </Button>
          ) : undefined
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

  const list = (
    <Collection
      label="Blöcke des Tages"
      // Beginn und Ende stehen auf Höhe des Titels, auch wenn die Angaben
      // darunter umbrechen.
      className="[&_[data-collection-row]>span:first-child]:self-start"
    >
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index === nowIndex && !lineInGroup ? nowLine : null}
          {group.cells.length === 1 ? (
            <div className="border-gray-100 [&:not(:first-child)]:border-t">
              <CollectionList>{renderRow(group.cells[0]!)}</CollectionList>
            </div>
          ) : (
            <div
              data-tagesplan-parallel=""
              className="relative border-gray-200 bg-gray-50 before:absolute before:top-10 before:bottom-3 before:left-1.5 before:w-1 before:rounded-full before:bg-gray-300 before:content-[''] [&_[data-collection-group]>div:first-child]:bg-gray-100 [&:not(:first-child)]:border-t [&:not(:last-child)]:border-b"
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
                    renderRow(cell)
                  ),
                )}
              </CollectionGroup>
            </div>
          )}
        </Fragment>
      ))}
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

  if (isSplit) {
    return (
      <div
        style={
          {
            "--tagesplan-split-top": splitTop,
            "--tagesplan-split-height": SPLIT_PANE_HEIGHT,
          } as CSSProperties
        }
      >
        <SplitView
          // Die Listenspalte endet wie die Detailspalte über der Pill.
          className="[&>[data-split-list]]:max-h-(--tagesplan-split-height)"
          list={<SplitListColumn dayBar={dayBar} list={list} />}
          detail={
            splitEntry ? (
              <SplitDetail
                entry={splitEntry}
                next={
                  splitEntry.instance.startTime === nextStart &&
                  !splitEntry.state.over
                }
                mine={showMine && splitEntry.instance.isAssigned}
                action={
                  splitEntry.state.openable || splitEntry.state.startable
                    ? actionFor(splitEntry)
                    : null
                }
              />
            ) : null
          }
          empty="Wähle links einen Block, um seine Angaben zu sehen."
        />
      </div>
    );
  }

  return (
    <>
      {list}
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

// ---------------------------------------------------------------------------
// iPad quer

/**
 * Höhe beider Spalten: vom Beginn der Spalten bis über die Pill (6,5 rem
 * samt Abstand). So passt die Seite ins Bild, nichts scrollt unter die Pill
 * und die Aktion unten in der Detailspalte bleibt frei.
 */
const SPLIT_PANE_HEIGHT = "calc(100dvh - var(--tagesplan-split-top) - 6.5rem)";

/** Abstand der Spalten vom Seitenanfang, als CSS-Variable am Split. */
function useSplitTop(active: boolean): string {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const split = document.querySelector<HTMLElement>("[data-split-view]");
      if (!split) return;
      setTop(Math.round(split.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    const head = document.querySelector("[data-app-page-head]");
    if (head) observer?.observe(head);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [active]);
  return `${top}px`;
}

/**
 * Linke Spalte: die Tagesleiste klebt oben in der Spalte, die Gruppenköpfe
 * der Liste kleben darunter. Unten bleibt Platz, damit der letzte Block über
 * die Pill scrollen kann.
 */
function SplitListColumn({
  dayBar,
  list,
}: Readonly<{ dayBar: ReactNode; list: ReactNode }>) {
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const update = () => setBarHeight(bar.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={barRef} className={`sticky top-0 ${Z_LAYER.nav}`}>
        <SectionCard padding="none" className="py-1.5">
          {dayBar}
        </SectionCard>
      </div>
      <div
        className="mt-2"
        style={{ "--app-sticky-offset": `${barHeight}px` } as CSSProperties}
      >
        {list}
      </div>
    </>
  );
}

/**
 * Rechte Spalte: der gewählte Block in einer Karte, höchstens so hoch wie
 * die Liste. Die Angaben scrollen, die Hauptaktion steht unter ihnen.
 */
function SplitDetail({
  entry,
  next,
  mine,
  action,
}: Readonly<{
  entry: Entry;
  next: boolean;
  mine: boolean;
  action: ReactNode;
}>) {
  return (
    <SectionCard
      title={entry.instance.title}
      namedRegion
      testId="tagesplan-detail"
      className="sticky flex flex-col"
      bodyClassName="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain"
      // So hoch wie die Angaben, höchstens so hoch wie die Liste: Die
      // Aktion steht direkt unter den Angaben statt unter einer leeren Fläche.
      style={{
        top: "var(--app-sticky-offset, 1rem)",
        maxHeight: "var(--tagesplan-split-height)",
      }}
      footer={action ?? undefined}
    >
      <BlockDetail entry={entry} next={next} mine={mine} />
    </SectionCard>
  );
}

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
 * Kennzeichnungen in Worten statt Farbcode: Zustand („Läuft jetzt“,
 * „Fällt aus“, „Als Nächstes“) und „Mit dir“ für die eigenen Blöcke.
 */
function blockChips(state: BlockState, next: boolean, mine: boolean) {
  const chips: ReactNode[] = [];
  if (state.running) {
    chips.push(
      <StatusColorBadge
        key="state"
        label="Läuft jetzt"
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

/** „19 Kinder“ bzw. „13 von 16 da“; ein Dienst und ein Ausfall ohne Zahl. */
function childrenPart(entry: Entry): string | null {
  if (entry.state.cancelled || entry.state.isDuty) return null;
  return blockChildrenLabel(entry.instance);
}

/**
 * Kinderzahl rechts in der Zeile, kurz: „19 Kinder“, laufend „13 da“. Ohne
 * Kinder (Teamsitzung) steht nichts; die volle Angabe steht im Blatt.
 */
function rowChildren(entry: Entry): string | null {
  if (entry.state.cancelled || entry.state.isDuty) return null;
  const { instance } = entry;
  // Laufend die ganze Angabe wie am Desktop („12 da · 4 nicht mehr im
  // Raum“): wer gegangen ist, sucht man gerade hier.
  if (instance.status === "active") return blockChildrenLabel(instance);
  const count =
    instance.status === "completed"
      ? instance.presentStudentsCount
      : instance.expectedStudentsCount;
  if (count <= 0) return null;
  return count === 1 ? "1 Kind" : `${count} Kinder`;
}

/**
 * Personal kurz für die Zeile: der erste Name, weitere als „+2“. Alle Namen
 * samt Vertretung stehen im Blatt.
 */
function rowStaff(instance: PlannedTimetableInstance): string | null {
  const names = instance.staffNames ?? [];
  const first = names[0];
  if (!first) return null;
  return names.length > 1
    ? `${first.displayName} +${names.length - 1}`
    : first.displayName;
}

/**
 * Eine Zeile, 56–64 px wie jede Liste der App: Beginn und Ende links, Titel,
 * darunter eine Zeile mit Zustand, Raum, Gruppe und Personal (am Telefon
 * gekürzt),
 * rechts die Kinderzahl. Alle Angaben stehen vollständig im Blatt.
 */
function BlockRow({
  entry,
  next,
  mine,
  selected,
  onOpen,
  action,
}: Readonly<{
  entry: Entry;
  next: boolean;
  mine: boolean;
  selected: boolean;
  onOpen: () => void;
  /** „Starten“ am eigenen Block wie am Desktop, ohne erst das Blatt. */
  action?: ReactNode;
}>) {
  const { instance, state } = entry;
  const quiet = state.over ? "text-gray-600" : "text-gray-900";
  const staff = blockStaffNames(instance);
  const chips = blockChips(state, next, mine);
  const children = childrenPart(entry);
  const openEnd = hasOpenEnd(instance);
  // Am iPad hoch ist die Zeile breit genug für alle Namen.
  const { layout, isSplit } = useDeviceContext();
  const wide = layout === "tablet" && !isSplit;
  // Unterzeile: Zustand (vorbei, Dienst), Raum, Kinder, Gruppe, Personal.
  // Sie bricht zwischen den Teilen um statt gekürzt zu werden: am Telefon
  // stand sonst „OGS-Ra…“ und „Anna Müll…“. Ein Ausfall nennt seinen Grund
  // rot wie am Desktop.
  const count = rowChildren(entry);
  const parts: { key: string; text: string; danger?: boolean }[] = [];
  const push = (
    key: string,
    text: string | null | undefined,
    danger?: boolean,
  ) => {
    if (text) parts.push({ key, text, danger });
  };
  // Ein Ausfall trägt immer den roten Chip „Fällt aus“; das Wort steht
  // nicht noch einmal daneben, wohl aber sein Grund.
  if (state.over && !state.cancelled) push("state", state.label);
  if (state.cancelled) push("reason", instance.cancelReason, true);
  if (state.isDuty && !state.over) push("duty", "Dienst");
  push("room", state.room);
  push("count", count);
  push("group", instance.groupName);
  if (!state.cancelled) push("staff", wide ? staff : rowStaff(instance));
  return (
    <CollectionRow
      onClick={onOpen}
      selected={selected}
      action={action}
      wrap
      // Beginnt mit dem sichtbaren Text des Ziels (Titel), damit
      // Sprachsteuerung den Block beim Namen findet.
      aria-label={[
        instance.title,
        blockTimeRange(instance),
        state.label,
        next ? "als Nächstes" : null,
        mine ? "mit dir" : null,
        state.cancelled ? instance.cancelReason : null,
        state.room,
        instance.groupName,
        children,
        state.cancelled ? null : staff,
      ]
        .filter(Boolean)
        .join(", ")}
      leading={
        <span className="tablet:text-[0.9375rem] w-11 self-start text-sm leading-5 tabular-nums">
          {openEnd ? (
            // Ein spontaner Block hat noch kein Ende: „seit 00:03“.
            <span className="block text-gray-600">seit</span>
          ) : null}
          <span
            className={cn(
              "block font-semibold",
              state.running ? "text-moto-green-strong" : quiet,
            )}
          >
            {instance.startTime}
          </span>
          {openEnd ? null : (
            <span className="block text-gray-600">{instance.endTime}</span>
          )}
        </span>
      }
      title={
        <span
          className={cn(
            state.over && "text-gray-600",
            state.running && "font-semibold",
            state.cancelled && "line-through decoration-gray-400",
          )}
        >
          {instance.title}
          {instance.planningTrackName ? (
            <span className="ml-1.5 inline-block text-xs font-normal text-gray-600">
              {instance.planningTrackName}
            </span>
          ) : null}
        </span>
      }
      subtitle={
        chips.length > 0 || parts.length > 0 ? (
          <span className="block">
            {chips.length > 0 ? (
              <span className="mr-1.5 inline-flex items-center gap-1 align-middle">
                {chips}
              </span>
            ) : null}
            {parts.map((part, index) => (
              <Fragment key={part.key}>
                {index > 0 ? " " : null}
                <span
                  className={cn(
                    "inline-block max-w-full",
                    part.danger && "text-moto-red-strong",
                  )}
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
          <DataField label={`Danach in ${state.room}`} fullWidth>
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
