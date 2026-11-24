"use client";

// Tagesplan in der App (#8070, #7795): eine Tagesliste statt Spuren
// nebeneinander. Gleichzeitige Blöcke stehen untereinander in einer Gruppe
// „Gleichzeitig“; am iPad hoch dürfen sie nebeneinander stehen, wenn Platz
// ist. Ein Tipp auf einen Block öffnet seine Angaben mit den Aktionen, die
// der Tagesplan heute schon anbietet (Kinderliste öffnen, Aufsicht starten).
// Am iPad quer steht die Liste links (⅓), der gewählte Block rechts (⅔).
//
// Daten, Tageswechsel, Start und Öffnen kommen aus `TagesplanView`; dieser
// Baustein lädt nichts selbst.

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { blockStaffNames } from "~/components/timetable/block-row-parts";
import type { TagesplanGroup } from "~/components/timetable/tagesplan-groups";
import { Button } from "~/components/ui/button";
import { ColorBar } from "~/components/ui/color-bar";
import {
  Collection,
  CollectionGroup,
  CollectionList,
  CollectionRow,
} from "~/components/ui/collection";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import { PlanningDayChip } from "~/components/ui/planning/planning-context-bar";
import { SectionCard } from "~/components/ui/section-card";
import { SplitView, useSplitSelection } from "~/components/ui/split-view";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { blockChildrenLabel, blockTimeRange } from "~/lib/block-children";
import { parseISODate, toISODate } from "~/lib/date-helpers";
import { useDeviceContext } from "~/lib/device-context";
import { GROUP_ROOM_SHADES, LOCATION_COLORS } from "~/lib/location-helper";
import {
  formatDayHeader,
  getGermanWeekdayShort,
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

/** „Heute, Di 24.11.“, „Morgen, Mi 25.11.“ oder „Do 26.11.“ */
export function tagesplanAppTitle(day: string, today: string): string {
  const label = formatDayHeader(parseISODate(day));
  if (day === today) return `Heute, ${label}`;
  if (day === shiftISO(today, 1)) return `Morgen, ${label}`;
  if (day === shiftISO(today, -1)) return `Gestern, ${label}`;
  return label;
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
 * Klebende Tagesleiste: Pfeile für den vorigen und nächsten Betreuungstag,
 * dazwischen die Tage der Woche. „Heute“ erscheint, sobald heute nicht in
 * der Leiste steht.
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
  return (
    <div
      // Am iPad bleibt die Leiste so breit wie am Telefon gedacht, mittig.
      className="tablet:mx-auto tablet:max-w-xl flex items-center gap-1"
      data-tagesplan-day-bar=""
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Vorheriger Tag"
        tooltip="Zeigt den Plan des vorherigen Betreuungstags."
        // Abstand zum Rand der Leiste, sonst schneidet sie die 44-px-Fläche.
        className="ml-1"
        onClick={onPrevious}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Button>
      <div className="mx-1.5 flex min-w-0 flex-1 gap-0.5">
        {days.map((iso) => {
          const date = parseISODate(iso);
          const weekday = getGermanWeekdayShort(date);
          return (
            <PlanningDayChip
              key={iso}
              stacked
              weekdayLabel={weekday}
              dateLabel={`${String(date.getDate()).padStart(2, "0")}.`}
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
        onClick={onNext}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </Button>
      {todayInStrip ? null : (
        <Button
          type="button"
          variant="outline"
          size="compact"
          tooltip="Zeigt den Plan von heute."
          onClick={() => onSelect(today)}
        >
          Heute
        </Button>
      )}
    </div>
  );
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
}

interface Entry {
  instance: PlannedTimetableInstance;
  effectiveEndTime: string;
  state: BlockState;
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
  const { layout, isSplit } = useDeviceContext();
  const isToday = day === today;

  const entries = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const group of groups) {
      for (const cell of group.cells) {
        map.set(cell.instance.id, {
          instance: cell.instance,
          effectiveEndTime: cell.effectiveEndTime,
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
    if (top > window.innerHeight * 0.5) {
      marker.scrollIntoView({ block: "start" });
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
      />
    );
  };

  // iPad hoch: zwei gleichzeitige Blöcke stehen nebeneinander. Ab drei
  // würde jede Spalte so schmal, dass Raum und Titel umbrechen („OGS-
  // Raum 1“); dann, am Telefon und neben dem Detail untereinander.
  const sideBySide = layout === "tablet" && !isSplit;

  const nowLine = (
    <div ref={nowRef} style={NOW_SCROLL_MARGIN}>
      <NowLine nowHHMM={nowHHMM} />
    </div>
  );

  const list = (
    <Collection label="Blöcke des Tages">
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index === nowIndex ? nowLine : null}
          {group.cells.length === 1 ? (
            <div className="border-gray-100 [&:not(:first-child)]:border-t">
              <CollectionList>{renderRow(group.cells[0]!)}</CollectionList>
            </div>
          ) : (
            <div
              className={cn(
                "border-gray-100 [&:not(:first-child)]:border-t",
                sideBySide &&
                  group.laneCount === 2 &&
                  group.cells.length === 2 &&
                  "[&_ul]:grid [&_ul]:[grid-template-columns:repeat(var(--lanes),minmax(0,1fr))] [&_ul]:divide-x [&_ul]:divide-y-0",
              )}
              style={{ "--lanes": group.laneCount } as CSSProperties}
            >
              <CollectionGroup
                title={
                  <span className="tabular-nums">
                    Gleichzeitig ·{" "}
                    {group.openEnd
                      ? `ab ${group.startTime}`
                      : `${group.startTime}–${group.endTime}`}
                  </span>
                }
                count={group.cells.length}
              >
                {group.cells.map((cell) => renderRow(cell))}
              </CollectionGroup>
            </div>
          )}
        </Fragment>
      ))}
      {nowIndex === groups.length ? nowLine : null}
    </Collection>
  );

  const detailFor = (entry: Entry) => (
    <BlockDetail
      entry={entry}
      next={entry.instance.startTime === nextStart && !entry.state.over}
      mine={showMine && entry.instance.isAssigned}
    />
  );
  const actionFor = (entry: Entry, fullWidth: boolean) => (
    <BlockAction
      entry={entry}
      busy={startBusyId === entry.instance.id}
      fullWidth={fullWidth}
      onOpenSession={onOpenSession}
      onStart={onStart}
    />
  );

  if (isSplit) {
    return (
      <SplitView
        // Unten Platz, damit der letzte Block über die Pill scrollen kann.
        list={<div className="pb-24">{list}</div>}
        detail={
          splitEntry ? (
            <SectionCard
              title={splitEntry.instance.title}
              action={actionFor(splitEntry, false)}
            >
              {detailFor(splitEntry)}
            </SectionCard>
          ) : null
        }
        empty="Wähle links einen Block, um seine Angaben zu sehen."
      />
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
        footer={sheetEntry ? actionFor(sheetEntry, true) : undefined}
      >
        {sheetEntry ? detailFor(sheetEntry) : null}
      </OverlaySheet>
    </>
  );
}

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

function statusChip(state: BlockState, next: boolean): ReactNode {
  if (state.running) {
    return (
      <StatusColorBadge
        label="Läuft jetzt"
        color={LOCATION_COLORS.GROUP_ROOM}
        compact
      />
    );
  }
  if (state.cancelled) {
    return (
      <StatusColorBadge
        label="Fällt aus"
        color={LOCATION_COLORS.DANGER}
        compact
      />
    );
  }
  if (next) {
    return (
      <StatusColorBadge
        label="Als Nächstes"
        color={LOCATION_COLORS.OTHER_ROOM}
        compact
      />
    );
  }
  return null;
}

function BlockRow({
  entry,
  next,
  mine,
  selected,
  onOpen,
}: Readonly<{
  entry: Entry;
  next: boolean;
  mine: boolean;
  selected: boolean;
  onOpen: () => void;
}>) {
  const { instance, state } = entry;
  const quiet = state.over ? "text-gray-600" : "text-gray-900";
  // Unterzeile: Raum und Gruppe; vorbei oder abgesagt steht der Zustand
  // vorn. Kinderzahl und Personal stehen im Blatt.
  const sub = [
    state.over || state.cancelled ? state.label : null,
    state.isDuty && !state.over ? "Dienst" : null,
    state.room,
    instance.groupName,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <CollectionRow
      onClick={onOpen}
      selected={selected}
      // Beginnt mit dem sichtbaren Text des Ziels (Titel, „Mein Block“),
      // damit Sprachsteuerung den Block beim Namen findet.
      aria-label={`${instance.title}${mine ? " Mein Block" : ""}, ${blockTimeRange(
        instance,
      )}${state.label ? `, ${state.label}` : ""}${next ? ", als Nächstes" : ""}`}
      leading={
        <span className="flex items-center gap-2.5">
          <ColorBar
            color={
              state.over ? LOCATION_COLORS.UNKNOWN : blockEdgeOrRunning(entry)
            }
            size="lg"
          />
          <span className="w-11 text-sm leading-5 tabular-nums">
            <span
              className={cn(
                "block font-semibold",
                state.running ? "text-moto-green-strong" : quiet,
              )}
            >
              {instance.startTime}
            </span>
            <span className="block text-gray-600">
              {/* Ein spontaner Block hat noch kein Ende. */}
              {blockTimeRange(instance).startsWith("seit")
                ? "offen"
                : instance.endTime}
            </span>
          </span>
        </span>
      }
      title={
        // Kein Kürzen: der Titel bricht lieber um, als „Ran…“ zu zeigen.
        <span
          className={cn(
            "block whitespace-normal",
            state.over && "text-gray-600",
            state.running && "font-semibold",
          )}
        >
          {instance.title}
          {mine ? " " : null}
          {mine ? (
            <span className="ml-1 text-xs font-normal whitespace-nowrap text-gray-600">
              Mein Block
            </span>
          ) : null}
        </span>
      }
      subtitle={
        sub ? (
          <span
            className={cn(
              "block whitespace-normal",
              state.cancelled && !state.over && "text-moto-red-strong",
            )}
          >
            {sub}
          </span>
        ) : undefined
      }
      meta={statusChip(state, next)}
    />
  );
}

function blockEdgeOrRunning(entry: Entry): string {
  if (entry.state.cancelled) return LOCATION_COLORS.DANGER;
  if (entry.state.running) return LOCATION_COLORS.GROUP_ROOM;
  return entry.instance.planningTrackColor ?? LOCATION_COLORS.UNKNOWN;
}

function BlockDetail({
  entry,
  next,
  mine,
}: Readonly<{ entry: Entry; next: boolean; mine: boolean }>) {
  const { instance, state } = entry;
  const staff = blockStaffNames(instance);
  const chip = statusChip(state, next);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="font-semibold tabular-nums">
          {blockTimeRange(instance)} Uhr
        </span>
        {chip}
        {!state.running && !state.cancelled && state.label ? (
          <span className="text-gray-600">{state.label}</span>
        ) : null}
        {mine ? <span className="text-gray-600">Mein Block</span> : null}
      </div>
      {state.cancelled && instance.cancelReason ? (
        <p className="text-moto-red-strong text-sm">
          Fällt aus: {instance.cancelReason}
        </p>
      ) : null}
      <DataGrid>
        {state.room ? <DataField label="Raum">{state.room}</DataField> : null}
        {instance.groupName ? (
          <DataField label="Gruppe">{instance.groupName}</DataField>
        ) : null}
        {state.cancelled || state.isDuty ? null : (
          <DataField label="Kinder">{blockChildrenLabel(instance)}</DataField>
        )}
        {staff ? <DataField label="Personal">{staff}</DataField> : null}
        {instance.planningTrackName ? (
          <DataField label="Bereich">{instance.planningTrackName}</DataField>
        ) : null}
        {state.isDuty ? <DataField label="Art">Dienst</DataField> : null}
      </DataGrid>
    </div>
  );
}

/**
 * Nur die Aktionen, die der Tagesplan heute schon hat: einen laufenden
 * Block öffnen, einen eigenen, startbereiten Block starten.
 */
function BlockAction({
  entry,
  busy,
  fullWidth,
  onOpenSession,
  onStart,
}: Readonly<{
  entry: Entry;
  busy: boolean;
  fullWidth: boolean;
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
        className={fullWidth ? "w-full" : undefined}
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
        className={fullWidth ? "w-full" : undefined}
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
