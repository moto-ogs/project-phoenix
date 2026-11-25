"use client";

/**
 * App-Fassung der Zeiterfassung (#8070, Seitenmuster „Erfassen“).
 *
 * Die Stempeluhr steht als kompakter Zustand oben, die Hauptaktion
 * (Einstempeln, Pause, Ausstempeln) in der `ActionBar` über der Pill, die
 * Statuswahl und die Pausendauer in einem Blatt. Darunter Woche oder Monat
 * als Tagesliste in EINER Karte; ein Tipp auf einen Tag öffnet das
 * vorhandene Formular. Die Logik (Stempeln, Pausen-Countdown, Laden) bleibt
 * in der Seite; hier wird nur dargestellt.
 *
 * Desktop rendert nichts hiervon.
 */

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "~/components/ui/segmented-control";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { SectionCard } from "~/components/ui/section-card";
import { SpinnerIcon } from "~/components/ui/icons";
import { formatSignedDuration } from "~/components/staff/staff-time-views";
import type { LaborHint } from "~/lib/labor-time-hints";
import type { StaffShift } from "~/lib/shift-helpers";
import { toIsoDayOfWeek } from "~/lib/staff-metrics-helpers";
import { toISODate } from "~/lib/date-helpers";
import {
  absenceDisplayLabel,
  formatDuration,
  formatTime,
  type DayProjection,
  type StaffAbsence,
  type WorkSessionHistory,
} from "~/lib/time-tracking-helpers";
import { cn } from "~/lib/utils";

// ─── Stempeluhr ──────────────────────────────────────────────────────────────

export type AppClockState = "idle" | "working" | "break" | "done";
type CheckInMode = "present" | "home_office";

export interface AppClockPanelProps {
  readonly state: AppClockState;
  /** Ein Stempel ist unterwegs: der Zustand ist noch nicht bestätigt. */
  readonly saving: boolean;
  readonly sessionStatus: string | undefined;
  readonly checkInTime: string | null;
  readonly checkOutTime: string | null;
  /** Netto heute, live. */
  readonly todayMinutes: number;
  /** Pause des laufenden oder letzten Blocks, live. */
  readonly breakMinutes: number;
  readonly plannedShifts: readonly StaffShift[];
  readonly laborHints: readonly LaborHint[];
  /** Pause mit Ende: Sekunden bis zum Ende. */
  readonly breakCountdownSecs: number | null;
  readonly breakEndsAt: string | null;
  readonly breakElapsedSecs: number;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onCheckIn: (mode: CheckInMode) => void;
  readonly onCheckOut: () => void;
  readonly onStartBreak: () => void;
  readonly onEndBreak: () => void;
  readonly onAddAbsence: () => void;
  /** Die Pausendauer (Stepper der Seite). */
  readonly breakStepper: ReactNode;
  readonly breakSheetOpen: boolean;
  readonly onBreakSheetOpenChange: (open: boolean) => void;
}

function formatClock(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function clockBadge(
  state: AppClockState,
  sessionStatus: string | undefined,
  saving: boolean,
): { label: string; tone: StatusBadgeTone } {
  if (saving) return { label: "Wird gespeichert", tone: "gray" };
  if (state === "break") return { label: "Pause", tone: "orange" };
  if (state === "working") {
    return sessionStatus === "home_office"
      ? { label: "Unterwegs", tone: "blue" }
      : { label: "In der OGS", tone: "green" };
  }
  if (state === "done") return { label: "Ausgestempelt", tone: "gray" };
  return { label: "Nicht eingestempelt", tone: "gray" };
}

function plannedLine(shifts: readonly StaffShift[]): string | null {
  if (shifts.length === 0) return null;
  const parts = shifts.map((s) => `${s.startTime}–${s.endTime}`);
  const pause = shifts.reduce((sum, s) => sum + s.breakMinutes, 0);
  return `Geplant ${parts.join(", ")}${pause > 0 ? ` · Pause ${pause} min` : ""}`;
}

export function AppClockPanel(props: AppClockPanelProps) {
  const {
    state,
    saving,
    sessionStatus,
    checkInTime,
    checkOutTime,
    todayMinutes,
    breakMinutes,
    plannedShifts,
    laborHints,
    breakCountdownSecs,
    breakEndsAt,
    breakElapsedSecs,
    disabled,
    busy,
  } = props;
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  // Nach dem Ausstempeln meldet der Server keinen laufenden Block mehr; die
  // Minuten von heute zeigen, dass schon gestempelt wurde.
  const badge = clockBadge(
    state === "idle" && todayMinutes > 0 ? "done" : state,
    sessionStatus,
    saving,
  );
  const planned = plannedLine(plannedShifts);

  let headline: string;
  let detail: string | null = planned;
  if (state === "working" && checkInTime) {
    headline = `Seit ${formatTime(checkInTime)}`;
    // Kurz, damit es auch am kleinen Telefon in die Zeile passt.
    const lastShift = plannedShifts[plannedShifts.length - 1];
    detail =
      breakMinutes > 0
        ? `Pause bisher ${breakMinutes} min`
        : lastShift
          ? `Dienst bis ${lastShift.endTime}`
          : null;
  } else if (state === "break") {
    headline =
      breakCountdownSecs === null
        ? `Pause seit ${formatClock(breakElapsedSecs)}`
        : `Pause noch ${formatClock(breakCountdownSecs)}`;
    detail = breakEndsAt
      ? `Automatisch weiter um ${formatTime(breakEndsAt)}`
      : checkInTime
        ? `Arbeit seit ${formatTime(checkInTime)}`
        : null;
  } else if (state === "done" && checkInTime && checkOutTime) {
    headline = `${formatTime(checkInTime)}–${formatTime(checkOutTime)}`;
    detail = breakMinutes > 0 ? `Pause ${breakMinutes} min` : null;
  } else {
    const first = plannedShifts[0];
    const last = plannedShifts[plannedShifts.length - 1];
    headline =
      first && last
        ? `Dienst ${first.startTime}–${last.endTime}`
        : "Heute kein Dienst geplant";
    const pause = plannedShifts.reduce((sum, s) => sum + s.breakMinutes, 0);
    detail = pause > 0 ? `Pause ${pause} min geplant` : null;
  }

  const pending = busy || saving;
  // Noch nichts gestempelt: der Zustand steht in der Aktionsleiste
  // („Dienst 08:00–16:30 · Einstempeln“), die Karte entfällt – auf jedem
  // Gerät gleich. Die Zeile von heute in der Liste nennt den Plan ebenfalls;
  // so passen mehr Tage ins erste Bild. Mit Hinweisen und beim Speichern
  // bleibt die Karte.
  const foldIntoBar =
    state === "idle" &&
    todayMinutes === 0 &&
    laborHints.length === 0 &&
    !saving;
  const spinner = pending ? <SpinnerIcon className="mr-1.5 h-4 w-4" /> : null;

  return (
    <>
      {/* Kompakt (#8070): Zustand und heutige Zeit in einer Zeile, Dienst
          und Pause in der zweiten. So bleibt am kleinen Telefon Platz für
          die Tage darunter. */}
      <SectionCard
        padding="none"
        className={cn("px-4 py-3", foldIntoBar && "hidden")}
      >
        <div data-setup-tour="time-clock" data-app-clock="">
          <div className="flex items-center justify-between gap-3">
            <span role="status" className="min-w-0">
              <StatusBadge label={badge.label} tone={badge.tone} />
            </span>
            <p className="shrink-0 text-sm leading-6 text-gray-500 tabular-nums">
              <span className="text-lg font-semibold text-gray-900">
                {/* Gleich nach dem Einstempeln: nicht „0min“, die Zeit
                    läuft schon (sie zählt alle 15 s weiter). */}
                {state === "working" && todayMinutes < 1
                  ? "<1min"
                  : formatDuration(todayMinutes)}
              </span>{" "}
              heute
            </p>
          </div>
          <p className="mt-1 truncate text-sm leading-5 tabular-nums">
            <span
              className={cn(
                "font-semibold",
                state === "break" ? "text-moto-orange-strong" : "text-gray-900",
              )}
            >
              {headline}
            </span>
            {detail ? <span className="text-gray-500"> · {detail}</span> : null}
          </p>
        </div>
        {laborHints.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {laborHints.map((hint) => (
              <li
                key={hint.key}
                className="text-moto-amber-strong text-sm font-medium"
              >
                {hint.text}
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      {state === "idle" ? (
        <ActionBar status={foldIntoBar ? headline : undefined}>
          <Button
            type="button"
            variant="success"
            size="md"
            disabled={disabled || pending}
            onClick={() => setStatusSheetOpen(true)}
            tooltip="Öffnet die Auswahl, wo du heute arbeitest."
            // Ohne Karte zeigt die Einführung auf den Knopf.
            data-setup-tour={foldIntoBar ? "time-clock" : undefined}
          >
            {spinner}
            Einstempeln
          </Button>
        </ActionBar>
      ) : null}
      {state === "working" ? (
        <ActionBar
          secondary={
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={disabled || pending}
              onClick={() => props.onBreakSheetOpenChange(true)}
              tooltip="Öffnet die Auswahl, wie lange die Pause dauert."
            >
              Pause
            </Button>
          }
        >
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={disabled || pending}
            onClick={props.onCheckOut}
            tooltip="Stempelt dich aus und beendet deine Arbeitszeit."
          >
            {spinner}
            Ausstempeln
          </Button>
        </ActionBar>
      ) : null}
      {state === "break" ? (
        <ActionBar status={headline}>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={disabled || pending}
            onClick={props.onEndBreak}
            tooltip="Beendet die Pause sofort, deine Arbeitszeit läuft weiter."
          >
            {spinner}
            Pause beenden
          </Button>
        </ActionBar>
      ) : null}

      <OverlaySheet
        open={statusSheetOpen}
        onOpenChange={setStatusSheetOpen}
        title="Wo arbeitest du heute?"
      >
        <div className="flex flex-col gap-3 pt-1">
          <Button
            type="button"
            variant="success"
            size="md"
            disabled={disabled || pending}
            onClick={() => {
              setStatusSheetOpen(false);
              props.onCheckIn("present");
            }}
            tooltip="Startet deine Arbeitszeit in der OGS."
          >
            In der OGS einstempeln
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={disabled || pending}
            onClick={() => {
              setStatusSheetOpen(false);
              props.onCheckIn("home_office");
            }}
            tooltip="Startet deine Arbeitszeit außerhalb der OGS."
          >
            Unterwegs einstempeln
          </Button>
          <p className="-mt-1 text-center text-sm text-gray-500">
            Unterwegs: zum Beispiel Ausflug, Fortbildung oder zu Hause.
          </p>
          <Button
            type="button"
            variant="outline_danger"
            size="md"
            disabled={disabled || pending}
            onClick={() => {
              setStatusSheetOpen(false);
              props.onAddAbsence();
            }}
            tooltip="Öffnet ein Fenster, um eine Abwesenheit einzutragen."
          >
            Abwesenheit melden
          </Button>
        </div>
      </OverlaySheet>

      <OverlaySheet
        open={props.breakSheetOpen}
        onOpenChange={props.onBreakSheetOpenChange}
        title="Pause stempeln"
        footer={
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1"
            disabled={disabled || pending}
            onClick={props.onStartBreak}
            tooltip="Startet die Pause; danach läuft deine Arbeitszeit von selbst weiter."
          >
            Pause starten
          </Button>
        }
      >
        <div className="py-4">{props.breakStepper}</div>
      </OverlaySheet>
    </>
  );
}

// ─── Zeitraum ────────────────────────────────────────────────────────────────

type RangeMode = "week" | "month";

const RANGE_ITEMS: readonly SegmentedControlItem<RangeMode>[] = [
  { value: "week", label: "Woche" },
  { value: "month", label: "Monat" },
];

/**
 * Eine Zeile in der klebenden Leiste: Pfeile, der Zeitraum (öffnet die Wahl
 * Woche/Monat im Blatt) und „Diese Woche“, solange eine andere gezeigt wird.
 */
export function AppRangeBar({
  label,
  viewMode,
  onViewModeChange,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  onToday,
  todayLabel,
}: Readonly<{
  label: string;
  viewMode: RangeMode;
  onViewModeChange: (mode: RangeMode) => void;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  onToday?: () => void;
  todayLabel: string;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <div
      // px-2: die 44-px-Trefferfläche der Pfeile ragt über den Knopf hinaus;
      // der Kartenrand würde sie sonst abschneiden.
      className="flex items-center gap-1.5 px-2"
      data-app-range-bar=""
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={previousLabel}
        tooltip={`Zeigt ${previousLabel === "Vorheriger Monat" ? "den vorherigen Monat" : "die vorherige Woche"}.`}
        onClick={onPrevious}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="min-w-0 flex-1 justify-center"
        onClick={() => setOpen(true)}
        tooltip="Öffnet die Wahl zwischen Woche und Monat."
        aria-haspopup="dialog"
      >
        <span className="truncate tabular-nums">{label}</span>
        <ChevronDown
          className="ml-1 size-4 shrink-0 text-gray-500"
          aria-hidden="true"
        />
      </Button>
      {onToday ? (
        <Button
          type="button"
          variant="chip"
          size="md"
          onClick={onToday}
          tooltip={`Springt zurück zu ${todayLabel === "Dieser Monat" ? "diesem Monat" : "dieser Woche"}.`}
        >
          {todayLabel}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={nextLabel}
        tooltip={`Zeigt ${nextLabel === "Nächster Monat" ? "den nächsten Monat" : "die nächste Woche"}.`}
        onClick={onNext}
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </Button>

      <OverlaySheet open={open} onOpenChange={setOpen} title="Zeitraum">
        <div className="space-y-4 pt-1">
          <SegmentedControl
            ariaLabel="Zeitraum"
            items={RANGE_ITEMS}
            value={viewMode}
            onChange={(mode) => {
              onViewModeChange(mode);
              setOpen(false);
            }}
            fullWidth
          />
          {onToday ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              className="w-full"
              onClick={() => {
                onToday();
                setOpen(false);
              }}
              tooltip={`Springt zurück zu ${todayLabel === "Dieser Monat" ? "diesem Monat" : "dieser Woche"}.`}
            >
              {todayLabel}
            </Button>
          ) : null}
        </div>
      </OverlaySheet>
    </div>
  );
}

// ─── Tagesliste ──────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function balanceClass(delta: number): string {
  if (delta > 0) return "text-moto-amber-strong";
  if (delta < -15) return "text-moto-red-strong";
  if (delta < 0) return "text-gray-500";
  return "text-moto-green-strong";
}

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

interface DayEntry {
  readonly key: string;
  readonly day: Date;
  readonly sessions: readonly WorkSessionHistory[];
  readonly absence: StaffAbsence | undefined;
  readonly shifts: readonly StaffShift[];
  readonly special: string | undefined;
  readonly projection: DayProjection | undefined;
}

export interface AppDayListProps {
  readonly from: Date;
  readonly to: Date;
  readonly today: Date;
  readonly sessions: readonly WorkSessionHistory[];
  readonly absences: readonly StaffAbsence[];
  readonly shifts: readonly StaffShift[];
  readonly projection: ReadonlyMap<string, DayProjection> | undefined;
  readonly holidays: ReadonlyMap<string, string> | undefined;
  readonly closingDays: ReadonlyMap<string, string> | undefined;
  /** Tag oder Block bearbeiten (das Formular der Seite). */
  readonly onEdit: (date: Date, session: WorkSessionHistory | null) => void;
  /** Kopf der Karte: die Wahl von Woche oder Monat. */
  readonly header?: ReactNode;
}

/**
 * Woche oder Monat als Tagesliste: Tagesköpfe als Wochengruppen, je Tag
 * oder Block eine Zeile mit Zeiten, Ist und Saldo rechts. Leere Wochenenden
 * bleiben weg (wie in der Tabelle des Desktops).
 */
export function AppDayList({
  from,
  to,
  today,
  sessions,
  absences,
  shifts,
  projection,
  holidays,
  closingDays,
  onEdit,
  header,
}: AppDayListProps) {
  const todayKey = toISODate(today);
  const weeks = useMemo(() => {
    const byDate = new Map<string, WorkSessionHistory[]>();
    for (const s of sessions) {
      const list = byDate.get(s.date) ?? [];
      list.push(s);
      byDate.set(s.date, list);
    }
    for (const list of byDate.values()) {
      list.sort((a, b) => a.checkInTime.localeCompare(b.checkInTime));
    }
    const shiftsByDate = new Map<string, StaffShift[]>();
    for (const s of shifts) {
      if (s.cancelled) continue;
      const list = shiftsByDate.get(s.date) ?? [];
      list.push(s);
      shiftsByDate.set(s.date, list);
    }
    const result: { week: number; days: DayEntry[] }[] = [];
    const toKey = toISODate(to);
    for (let offset = 0; offset < 42; offset++) {
      const day = new Date(from);
      day.setDate(day.getDate() + offset);
      if (toISODate(day) > toKey) break;
      const key = toISODate(day);
      const entry: DayEntry = {
        key,
        day,
        sessions: byDate.get(key) ?? [],
        absence: absences.find((a) => a.dateStart <= key && a.dateEnd >= key),
        shifts: shiftsByDate.get(key) ?? [],
        special: holidays?.get(key) ?? closingDays?.get(key),
        projection: projection?.get(key),
      };
      const weekend = toIsoDayOfWeek(day) >= 5;
      const hasContent =
        entry.sessions.length > 0 ||
        entry.absence !== undefined ||
        entry.shifts.length > 0 ||
        entry.special !== undefined ||
        (entry.projection?.targetMinutes ?? 0) > 0;
      if (weekend && !hasContent) continue;
      const week = isoWeek(day);
      const last = result[result.length - 1];
      if (last?.week === week) last.days.push(entry);
      else result.push({ week, days: [entry] });
    }
    return result;
  }, [from, to, sessions, absences, shifts, projection, holidays, closingDays]);

  return (
    <Collection label="Erfasste Zeiten" className="app-time-days">
      {header ? (
        <div className="border-b border-gray-100 py-1">{header}</div>
      ) : null}
      {weeks.map(({ week, days }) => {
        const ist = days.reduce(
          (sum, d) => sum + (d.projection?.actualMinutes ?? 0),
          0,
        );
        // Ein laufender oder noch nicht begonnener Tag zählt erst mit, wenn
        // er abgeschlossen ist: sonst stünde die Woche schon morgens mit dem
        // ganzen Soll von heute im Minus.
        const counted = days.filter(
          (d) => d.key < todayKey || (d.key === todayKey && dayClosed(d)),
        );
        const partial =
          counted.length < days.filter((d) => d.key <= todayKey).length;
        const balance = counted.reduce(
          (sum, d) => sum + (d.projection?.balanceMinutes ?? 0),
          0,
        );
        // Wochenansicht: der Zeitraum steht schon im Kopf der Karte und die
        // Stunden der Woche in der Kopfkarte; die Gruppe nennt nur den Saldo.
        const single = weeks.length === 1 && header !== undefined;
        const saldoLabel = partial ? "Saldo bis gestern" : "Wochensaldo";
        if (single) {
          return (
            <CollectionGroup
              key={week}
              title={
                counted.length === 0
                  ? `${formatDuration(ist)} gearbeitet`
                  : saldoLabel
              }
              meta={
                counted.length === 0 ? null : (
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      balanceClass(balance),
                    )}
                  >
                    {formatSignedDuration(balance)}
                  </span>
                )
              }
            >
              {days.flatMap((d) => dayRows(d, todayKey, onEdit))}
            </CollectionGroup>
          );
        }
        return (
          <CollectionGroup
            key={week}
            title={`KW ${week}`}
            meta={
              counted.length === 0 ? (
                <span className="tabular-nums">{formatDuration(ist)}</span>
              ) : (
                // Der Saldo dieser Woche, beschriftet: er ist nicht das
                // Stundenkonto im Kopf (das zählt alle Wochen zusammen).
                <span className="tabular-nums">
                  {formatDuration(ist)} · {saldoLabel}{" "}
                  <span className={balanceClass(balance)}>
                    {formatSignedDuration(balance)}
                  </span>
                </span>
              )
            }
          >
            {days.flatMap((d) => dayRows(d, todayKey, onEdit))}
          </CollectionGroup>
        );
      })}
    </Collection>
  );
}

/** Heute ist abgeschlossen: gestempelt und kein Block läuft mehr. */
function dayClosed(d: DayEntry): boolean {
  return (
    d.sessions.length > 0 && d.sessions.every((s) => s.checkOutTime !== null)
  );
}

function DayBadge({ day, isToday }: { day: Date; isToday: boolean }) {
  return (
    <span
      className={cn(
        "flex w-9 flex-col items-center leading-tight",
        isToday ? "text-gray-900" : "text-gray-600",
      )}
    >
      <span className="text-xs font-medium">
        {WEEKDAY_SHORT[toIsoDayOfWeek(day)]}
      </span>
      <span
        className={cn(
          "text-base font-semibold tabular-nums",
          isToday &&
            "bg-moto-green-fill flex size-7 items-center justify-center rounded-full text-sm text-white",
        )}
      >
        {day.getDate()}
      </span>
    </span>
  );
}

function dayRows(
  d: DayEntry,
  todayKey: string,
  onEdit: (date: Date, session: WorkSessionHistory | null) => void,
): ReactNode[] {
  const isToday = d.key === todayKey;
  const isFuture = d.key > todayKey;
  const leading = <DayBadge day={d.day} isToday={isToday} />;
  const balance = d.projection?.balanceMinutes;
  // Heute zeigt den Saldo erst, wenn der Tag abgeschlossen ist; vorher
  // stünde schon morgens das ganze Soll als Minus da.
  const hasBalance =
    d.projection !== undefined &&
    (d.sessions.length > 0 ||
      d.projection.targetMinutes > 0 ||
      d.projection.creditMinutes > 0) &&
    !isFuture &&
    (!isToday || dayClosed(d));
  const plannedText =
    d.shifts.length > 0
      ? `Geplant ${d.shifts.map((s) => `${s.startTime}–${s.endTime}`).join(", ")}`
      : null;

  const meta = (ist: number | null, showBalance: boolean) => (
    <span className="flex flex-col items-end leading-5">
      <span className="font-medium text-gray-900">
        {ist === null ? "–" : formatDuration(ist)}
      </span>
      {showBalance && balance !== undefined ? (
        <span className={cn("text-sm", balanceClass(balance))}>
          {formatSignedDuration(balance)}
        </span>
      ) : null}
    </span>
  );

  if (d.sessions.length === 0) {
    let title: string;
    let subtitle: string | undefined;
    if (d.absence) {
      title = absenceDisplayLabel(d.absence);
      subtitle = d.absence.status === "requested" ? "Beantragt" : undefined;
    } else if (d.special) {
      title = d.special;
      subtitle = "Kein Dienst";
    } else if (isFuture) {
      title = plannedText ?? "Nichts geplant";
    } else if (isToday) {
      title = "Noch nicht gestempelt";
      subtitle = plannedText ?? undefined;
    } else {
      title = "Nicht erfasst";
      subtitle = plannedText ?? undefined;
    }
    const credit = d.projection?.creditMinutes ?? 0;
    return [
      <CollectionRow
        key={d.key}
        leading={leading}
        title={title}
        subtitle={subtitle}
        meta={
          isFuture || (isToday && !d.absence && !d.special)
            ? d.projection && d.projection.targetMinutes > 0
              ? `Soll ${formatDuration(d.projection.targetMinutes)}`
              : undefined
            : meta(credit > 0 ? credit : null, hasBalance)
        }
        // Nur, wo das Formular etwas zeigt: eine Abwesenheit oder ein
        // vergangener Arbeitstag ohne Eintrag (dort erklärt es, wer
        // nachträgt). Feiertag, Schließtag und heute bleiben Anzeige.
        {...(isFuture || isToday || (d.special && !d.absence)
          ? {}
          : {
              onClick: () => onEdit(d.day, null),
              "aria-label": `${WEEKDAY_SHORT[toIsoDayOfWeek(d.day)]} ${d.day.getDate()}.: ${title}`,
            })}
      />,
    ];
  }

  return d.sessions.map((s, index) => {
    const open = s.checkOutTime === null;
    const times = `${formatTime(s.checkInTime)}–${open ? "läuft" : formatTime(s.checkOutTime)}`;
    const parts: string[] = [];
    if (s.status === "home_office") parts.push("Unterwegs");
    if (s.breakMinutes > 0) parts.push(`Pause ${s.breakMinutes} min`);
    if (d.absence) parts.push(absenceDisplayLabel(d.absence));
    if (d.sessions.length > 1) parts.push(`Block ${index + 1}`);
    const last = index === d.sessions.length - 1;
    const dayIst =
      d.projection?.actualMinutes ??
      d.sessions.reduce((sum, x) => sum + x.netMinutes, 0);
    return (
      <CollectionRow
        key={s.id}
        leading={
          index === 0 ? leading : <span className="w-9" aria-hidden="true" />
        }
        title={times}
        subtitle={parts.length > 0 ? parts.join(" · ") : "In der OGS"}
        meta={
          d.sessions.length > 1 && !last
            ? meta(s.netMinutes, false)
            : meta(d.sessions.length > 1 ? dayIst : s.netMinutes, hasBalance)
        }
        onClick={() => onEdit(d.day, s)}
        aria-label={`${WEEKDAY_SHORT[toIsoDayOfWeek(d.day)]} ${d.day.getDate()}.: ${times} bearbeiten`}
      />
    );
  });
}

// ─── Aufbau ──────────────────────────────────────────────────────────────────

/**
 * Telefon und iPad hoch: Stempeluhr, die Tage, dann Heute geplant, Urlaub
 * und Kontingente. iPad quer (`split`): links der Tag (Stempeluhr, Heute
 * geplant, Urlaub) als eigene Spalte, die bis über die Pill reicht und für
 * sich scrollt; die Aktionsleiste steht unten in dieser Spalte, in
 * Daumennähe, statt mittig über beiden Spalten zu schweben. Rechts die Tage
 * und Kontingente; sie scrollen mit der Seite.
 */
export function AppTimeTrackingLayout({
  split,
  errors,
  clock,
  days,
  today,
  leave,
  allowances,
}: Readonly<{
  split: boolean;
  errors: ReactNode;
  clock: ReactNode;
  days: ReactNode;
  today: ReactNode;
  leave: ReactNode;
  allowances: ReactNode;
}>) {
  if (split) {
    return (
      <div className="space-y-4" data-app-time-tracking="split">
        {errors}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-start gap-4">
          <SplitDayColumn>
            {clock}
            {today}
            {leave}
          </SplitDayColumn>
          <div className="flex min-w-0 flex-col gap-4 [&>*]:shrink-0 [&>section]:h-auto">
            {days}
            {allowances}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      // Das Polster der ActionBar gehört ans Seitenende, nicht unter die
      // Stempeluhr.
      className="flex flex-col gap-4 [&>*]:shrink-0 [&>[aria-hidden=true]:has(+[data-action-bar])]:order-last [&>section]:h-auto"
      data-app-time-tracking=""
    >
      {errors}
      {clock}
      {days}
      {today}
      {leave}
      {allowances}
    </div>
  );
}

/** Abstand der Spalte vom unteren Rand: Pill samt Safe Area (wie die ActionBar). */
const COLUMN_BOTTOM = "calc(env(safe-area-inset-bottom) + 6.5rem)";

/**
 * Linke Spalte am iPad quer: klebt an ihrer Startposition und reicht bis über
 * die Pill. Ihr Inhalt scrollt für sich; die Aktionsleiste klebt unten in ihr.
 */
function SplitDayColumn({ children }: Readonly<{ children: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = () => {
      // Abstand zum Dokumentanfang: so weit unten beginnt die Spalte, und
      // dort bleibt sie auch beim Scrollen der rechten Spalte stehen.
      const sticky = el.style.position;
      el.style.position = "static";
      const offset = el.getBoundingClientRect().top + window.scrollY;
      el.style.position = sticky;
      setTop(Math.max(Math.round(offset), 0));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return (
    <div
      ref={ref}
      data-app-time-day-column=""
      className={cn(
        "sticky flex min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl",
        "[&>*]:shrink-0 [&>section]:h-auto",
        // Die Leiste im Fluss der Spalte, unten klebend: kein Schweben,
        // keine eigene Deckzone.
        "[&>[aria-hidden=true]:has(+[data-action-bar])]:hidden",
        "[&>[data-action-bar]]:sticky [&>[data-action-bar]]:bottom-0! [&>[data-action-bar]]:order-last [&>[data-action-bar]]:mx-0 [&>[data-action-bar]]:mt-auto [&>[data-action-bar]]:max-w-none [&>[data-action-bar]]:translate-y-0",
      )}
      style={
        top === null
          ? undefined
          : {
              top,
              height: `calc(100dvh - ${top}px - ${COLUMN_BOTTOM})`,
            }
      }
    >
      {children}
    </div>
  );
}
