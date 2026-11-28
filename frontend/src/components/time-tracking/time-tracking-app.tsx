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

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ActionBar } from "~/components/ui/action-bar";
import { Button } from "~/components/ui/button";
import {
  Collection,
  CollectionGroup,
  CollectionRow,
} from "~/components/ui/collection";
import { ListRow } from "~/components/ui/list-row";
import { OverlaySheet } from "~/components/ui/overlay-sheet";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { DataField } from "~/components/ui/data-field";
import { SectionCard } from "~/components/ui/section-card";
import { SpinnerIcon } from "~/components/ui/icons";
import { formatSignedDuration } from "~/components/staff/staff-time-views";
import type { LaborHint } from "~/lib/labor-time-hints";
import type {
  OwnAbsence,
  OwnBlock,
  PlanShift,
} from "~/lib/own-time-tracking-view";
import { toIsoDayOfWeek } from "~/lib/staff-metrics-helpers";
import { toISODate } from "~/lib/date-helpers";
import {
  absenceDisplayLabel,
  formatDuration,
  formatTime,
  type DayProjection,
} from "~/lib/time-tracking-helpers";
import { cn } from "~/lib/utils";

// ─── Stempeluhr ──────────────────────────────────────────────────────────────

type AppClockState = "idle" | "working" | "break" | "done";
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
  readonly plannedShifts: readonly PlanShift[];
  /**
   * Der heutige Dienst wie auf dem Desktop (Schichtart, Zeit, Pause,
   * entfallene Schichten); steht, solange noch nicht gestempelt ist.
   */
  readonly plannedInfo?: ReactNode;
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
  /**
   * Telefon (Runde 17): Die Stempeluhr steht als Zeile in der Kopfkarte
   * statt als zweite Karte darunter. `null`, solange der Platz im Kopf noch
   * nicht gerendert ist.
   */
  readonly headSlot?: HTMLElement | null;
  /**
   * Telefon (Runde 21): Platz im schmalen Kopf beim Rollen; dort steht der
   * Zustand der Stempeluhr als Kurzstatus.
   */
  readonly compactSlot?: HTMLElement | null;
  /** Schulzeit jetzt („HH:MM“, Berlin): ob der Dienst schon begonnen hat. */
  readonly nowClock?: string;
  /**
   * Die Schule lässt diese Person nur am NFC-Terminal stempeln (#8024): wie
   * am Desktop ein Hinweis statt der Stempelknöpfe; die Leiste trägt dann
   * nur „Abwesenheit melden“.
   */
  readonly terminalOnly?: boolean;
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

/** Erster Teil einer zusammengesetzten Schichtart („Betreuung / Zeit am Kind“). */
function shortShiftTypeName(name: string): string {
  return name.split(/\s+[/–-]\s+/)[0]?.trim() || name;
}

function plannedLine(shifts: readonly PlanShift[]): string | null {
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
    plannedInfo,
    laborHints,
    breakCountdownSecs,
    breakEndsAt,
    breakElapsedSecs,
    disabled,
    busy,
    headSlot,
    compactSlot,
    nowClock,
    terminalOnly = false,
  } = props;
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  // Nach dem Ausstempeln meldet der Server keinen laufenden Block mehr; die
  // Minuten von heute zeigen, dass schon gestempelt wurde.
  const baseBadge = clockBadge(
    state === "idle" && todayMinutes > 0 ? "done" : state,
    sessionStatus,
    saving,
  );
  // Runde 17: Hat der Dienst schon begonnen, ist „Nicht eingestempelt“ der
  // wichtigste Zustand der Seite und steht orange statt grau.
  const shiftStarted =
    nowClock !== undefined &&
    plannedShifts[0] !== undefined &&
    plannedShifts[0].startTime <= nowClock;
  const badge =
    baseBadge.label === "Nicht eingestempelt" && shiftStarted
      ? { ...baseBadge, tone: "orange" as const }
      : baseBadge;
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
  const sheetPlanLine =
    plannedShifts.length === 0
      ? null
      : [
          `Dienst heute ${plannedShifts.map((s) => `${s.startTime}–${s.endTime}`).join(", ")}`,
          ...new Set(
            plannedShifts.flatMap((s) =>
              s.shiftTypeName ? [s.shiftTypeName] : [],
            ),
          ),
        ].join(" · ");
  const spinner = pending ? <SpinnerIcon className="mr-1.5 h-4 w-4" /> : null;
  // Noch nichts gestempelt: die Karte nennt den Dienst wie heute auf dem
  // Desktop („Geplant: Schichtart 08:00–16:30 · Pause 30 min“), die Leiste
  // trägt nur den Knopf – wie auf allen übrigen Seiten.
  const idleBeforeWork = state === "idle" && todayMinutes === 0 && !saving;
  const showToday = !idleBeforeWork;

  // Wie am Desktop (#8024): vor dem Stempeln, wo stattdessen gestempelt
  // wird; danach, dass Pause und Ausstempeln am Tablet geschehen.
  const terminalHint = !terminalOnly
    ? null
    : state === "idle" || state === "done"
      ? "Du stempelst am NFC-Tablet. Halte dein Armband an das Tablet."
      : "Pause und Ausstempeln machst du am NFC-Tablet.";

  const todayText =
    state === "working" && todayMinutes < 1
      ? "<1min"
      : formatDuration(todayMinutes);
  // Telefon (Runde 17): eine Zeile im Kopf. Der Zustand vorn als Chip, dann
  // der Dienst bzw. die laufende Zeit. Die geplante Pause und die
  // Schichtart stehen in der Zeile von heute in der Woche darunter.
  const headLine =
    headSlot === undefined ? null : (
      <div
        data-setup-tour="time-clock"
        data-app-clock=""
        className="pb-1 text-sm leading-6 text-gray-600"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span role="status" className="inline-flex shrink-0">
            <StatusBadge label={badge.label} tone={badge.tone} />
          </span>
          {/* Runde 21: Vor dem ersten Stempeln steht der Dienst in der
              Zeile von heute direkt darunter („Geplant 08:00–16:30“); im
              Kopf bleibt so Platz für den Saldo in derselben Zeile. */}
          {idleBeforeWork && planned !== null ? null : (
            <span className="tabular-nums">
              <span
                className={cn(
                  "font-semibold",
                  state === "break"
                    ? "text-moto-orange-strong"
                    : "text-gray-900",
                )}
              >
                {headline}
              </span>
              {detail && !idleBeforeWork ? (
                <span className="text-gray-500"> · {detail}</span>
              ) : null}
            </span>
          )}
          {showToday ? (
            <span className="whitespace-nowrap tabular-nums">
              <span className="font-semibold text-gray-900">{todayText}</span>{" "}
              heute
            </span>
          ) : null}
        </div>
        {laborHints.length > 0 ? (
          <ul className="space-y-0.5">
            {laborHints.map((hint) => (
              <li key={hint.key} className="text-moto-amber-strong font-medium">
                {hint.text}
              </li>
            ))}
          </ul>
        ) : null}
        {terminalHint ? <p className="text-gray-500">{terminalHint}</p> : null}
      </div>
    );

  // Runde 21: Beim Rollen bleibt der Zustand als Kurzstatus im schmalen
  // Kopf stehen, wie Uhrzeit oder Raum auf den anderen Seiten.
  const compactBadge = compactSlot
    ? createPortal(
        <StatusBadge label={badge.label} tone={badge.tone} compact />,
        compactSlot,
      )
    : null;

  return (
    <>
      {compactBadge}
      {/* Wiedererkennbar (#8070): dieselbe Karte „Stempeluhr“ mit Zustand
          rechts wie heute, aber kompakt – Dienst bzw. laufende Zeit in einer
          Zeile, damit am kleinen Telefon die Tage darunter Platz haben.
          Telefon (Runde 17): als Zeile in der Kopfkarte. */}
      {headSlot !== undefined ? (
        headSlot && headLine ? (
          createPortal(headLine, headSlot)
        ) : null
      ) : (
        <SectionCard
          title="Stempeluhr"
          // Neben dem Titel statt rechts: rechts bräche der Zustand am kleinen
          // Telefon in eine eigene Zeile um.
          titleBadge={
            <span role="status">
              <StatusBadge label={badge.label} tone={badge.tone} />
            </span>
          }
        >
          <div
            data-setup-tour="time-clock"
            data-app-clock=""
            className="mt-2 text-sm leading-6"
          >
            {idleBeforeWork && plannedInfo ? (
              plannedInfo
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate tabular-nums">
                  <span
                    className={cn(
                      "font-semibold",
                      state === "break"
                        ? "text-moto-orange-strong"
                        : "text-gray-900",
                    )}
                  >
                    {headline}
                  </span>
                  {detail ? (
                    <span className="text-gray-500"> · {detail}</span>
                  ) : null}
                </p>
                {showToday ? (
                  <p className="shrink-0 text-gray-500 tabular-nums">
                    <span className="font-semibold text-gray-900">
                      {/* Gleich nach dem Einstempeln: nicht „0min“, die Zeit
                        läuft schon (sie zählt alle 15 s weiter). */}
                      {state === "working" && todayMinutes < 1
                        ? "<1min"
                        : formatDuration(todayMinutes)}
                    </span>{" "}
                    heute
                  </p>
                ) : null}
              </div>
            )}
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
          {terminalHint ? (
            <p className="mt-2 text-sm text-gray-500">{terminalHint}</p>
          ) : null}
        </SectionCard>
      )}

      {terminalOnly ? (
        state === "idle" ? (
          <ActionBar>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={props.onAddAbsence}
              tooltip="Öffnet ein Fenster, um eine Abwesenheit einzutragen."
            >
              Abwesenheit melden
            </Button>
          </ActionBar>
        ) : null
      ) : (
        <>
          {state === "idle" ? (
            <ActionBar>
              <Button
                type="button"
                variant="success"
                size="md"
                disabled={disabled || pending}
                onClick={() => setStatusSheetOpen(true)}
                tooltip="Öffnet die Auswahl, wo du heute arbeitest."
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
            <ActionBar>
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
        </>
      )}

      <OverlaySheet
        open={statusSheetOpen}
        onOpenChange={setStatusSheetOpen}
        title="Wo arbeitest du heute?"
      >
        <div className="flex flex-col gap-3 pt-1">
          {/* Runde 21: Der heutige Dienst mit vollem Namen der Schichtart;
              die Zeile von heute in der Woche kürzt ihn. */}
          {sheetPlanLine ? (
            <p className="text-sm text-gray-600 tabular-nums">
              {sheetPlanLine}
            </p>
          ) : null}
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
          <p className="-mt-1 text-sm text-gray-500">
            Unterwegs: zum Beispiel Ausflug, Fortbildung oder zu Hause.
          </p>
          {/* Neutral (Runde 11): Rot las sich im Einstempeln-Blatt wie
              Löschen. Runde 21: als Zeile mit Pfeil, denn sie führt in ein
              eigenes Formular, statt als blasser Textknopf. */}
          <ListRow
            onClick={() => {
              if (disabled || pending) return;
              setStatusSheetOpen(false);
              props.onAddAbsence();
            }}
            className="mt-1"
            trailing={
              <ChevronRight
                className="size-5 text-gray-500"
                aria-hidden="true"
              />
            }
          >
            <span className="min-w-0 flex-1 text-left font-medium text-gray-900">
              Abwesenheit melden
            </span>
          </ListRow>
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

/**
 * Eine Zeile über den Tagen: Pfeile, der Zeitraum und „Diese Woche“, solange
 * eine andere gezeigt wird. Woche/Monat wählt man in der Leiste der
 * Kopfkarte (#8070, Runde 9).
 */
export function AppRangeBar({
  label,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  onToday,
  todayLabel,
  leading,
}: Readonly<{
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  onToday?: () => void;
  todayLabel: string;
  /**
   * Runde 15: Woche/Monat steht links in derselben Zeile; am kleinen Telefon
   * kostete die eigene Zeile die Tage im ersten Bild. Der Sprung zurück
   * („Diese Woche“) rückt dann in eine zweite Zeile, nur solange er gilt.
   */
  leading?: ReactNode;
}>) {
  const todayChip = onToday ? (
    <Button
      type="button"
      variant="chip"
      size="md"
      onClick={onToday}
      tooltip={`Springt zurück zu ${todayLabel === "Dieser Monat" ? "diesem Monat" : "dieser Woche"}.`}
    >
      {todayLabel}
    </Button>
  ) : null;
  if (leading) {
    return (
      <div data-app-range-bar="">
        <div className="flex min-h-11 items-center gap-1 pr-2 pl-4">
          <div className="shrink-0">{leading}</div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5">
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
            {/* Kein Abschneiden („Nov. 2…“ am SE): Reicht die Breite neben
                dem Umschalter nicht, bricht der Monat vor dem Jahr um. */}
            <p
              className="min-w-0 text-center text-sm leading-tight font-medium text-gray-900 tabular-nums"
              aria-live="polite"
            >
              {label}
            </p>
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
          </div>
        </div>
        {todayChip ? (
          <div className="flex justify-end px-4 pb-1">{todayChip}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div
      // px-2: die 44-px-Trefferfläche der Pfeile ragt über den Knopf hinaus;
      // der Kartenrand würde sie sonst abschneiden. min-h-11: Ohne den
      // Zeitraum-Knopf wäre die Zeile niedriger als die Trefferfläche.
      className="flex min-h-11 items-center gap-1.5 px-2"
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
      <p
        className="min-w-0 flex-1 truncate text-center text-sm font-medium text-gray-900 tabular-nums"
        aria-live="polite"
      >
        {label}
      </p>
      {todayChip}
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
    </div>
  );
}

// ─── Tagesliste ──────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Plus (Überstunden) und ausgeglichen in Grün, ein kleines Minus grau; erst
 * ein deutliches Minus in Warnfarbe. Ein Plus in Orange las sich wie ein
 * Fehler (#8070, Runde 5).
 */
function balanceClass(delta: number): string {
  if (delta >= 0) return "text-moto-green-strong";
  if (delta < -15) return "text-moto-orange-strong";
  return "text-gray-500";
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
  readonly sessions: readonly OwnBlock[];
  readonly absence: OwnAbsence | undefined;
  readonly shifts: readonly PlanShift[];
  /** Entfallene Schichten (stehen am Telefon in der Zeile des Tages). */
  readonly cancelled: readonly PlanShift[];
  readonly special: string | undefined;
  readonly projection: DayProjection | undefined;
}

/**
 * Die Angaben, die der Desktop je Tag in der Tabelle zeigt (Plan, Soll, Ist,
 * Gutschrift, Saldo, Quelle). Am Telefon stehen sie oben im Blatt des Tages,
 * damit die Zeile zweizeilig bleibt (#8070, Runde 7).
 */
export interface AppDayFacts {
  readonly plan: string | null;
  readonly projection: DayProjection | undefined;
  /** Saldo erst, wenn der Tag zählt (vergangen oder heute abgeschlossen). */
  readonly showBalance: boolean;
  /** Woher der Block kommt: „App“, „NFC“ oder null (unbekannt). */
  readonly source: string | null;
}

export interface AppDayListProps {
  readonly from: Date;
  readonly to: Date;
  readonly today: Date;
  readonly sessions: readonly OwnBlock[];
  readonly absences: readonly OwnAbsence[];
  readonly shifts: readonly PlanShift[];
  readonly projection: ReadonlyMap<string, DayProjection> | undefined;
  readonly holidays: ReadonlyMap<string, string> | undefined;
  readonly closingDays: ReadonlyMap<string, string> | undefined;
  /** Tag oder Block bearbeiten (das Formular der Seite). */
  readonly onEdit: (
    date: Date,
    session: OwnBlock | null,
    facts: AppDayFacts,
  ) => void;
  /** Kopf der Karte: die Wahl von Woche oder Monat. */
  readonly header?: ReactNode;
  /**
   * „Mein Dienstplan“ als letzte Zeile der Karte (Erreichbarkeit, #8070):
   * Der Desktop zeigt den Knopf sichtbar in der Kopfkarte; am Telefon stand
   * er nur im „…“. Die Tage nennen ihren Plan, der Weg zum ganzen Plan
   * steht darunter.
   */
  readonly dienstplanHref?: string;
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
  dienstplanHref,
}: AppDayListProps) {
  const todayKey = toISODate(today);
  const weeks = useMemo(() => {
    const byDate = new Map<string, OwnBlock[]>();
    for (const s of sessions) {
      const list = byDate.get(s.date) ?? [];
      list.push(s);
      byDate.set(s.date, list);
    }
    for (const list of byDate.values()) {
      list.sort((a, b) => a.checkInTime.localeCompare(b.checkInTime));
    }
    const shiftsByDate = new Map<string, PlanShift[]>();
    const cancelledByDate = new Map<string, PlanShift[]>();
    for (const s of shifts) {
      const target = s.cancelled ? cancelledByDate : shiftsByDate;
      const list = target.get(s.date) ?? [];
      list.push(s);
      target.set(s.date, list);
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
        cancelled: cancelledByDate.get(key) ?? [],
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
    <Collection
      label="Erfasste Zeiten"
      // Tage und Zeilen rasten nicht ein: über der ersten Woche stehen Kopfkarte
      // und Wochenwahl, und das Einrasten zöge die Seite schon beim Laden
      // an ihnen vorbei.
      // (Regel unlayered in globals.css, darum mit !).
      // Runde 15: Am kleinen Telefon (SE) 52 statt 59 px je Tag, wie die
      // Aufsicht; die Trefferfläche bleibt über 44 px.
      className={cn(
        "app-time-days [&_*]:[scroll-snap-align:none]!",
        SHORT_PHONE_ROWS,
      )}
    >
      {header ? (
        <div className="border-b border-gray-100 py-1">{header}</div>
      ) : null}
      {weeks.map(({ week, days }, weekIndex) => {
        const dienstplanRow =
          dienstplanHref && weekIndex === weeks.length - 1 ? (
            <CollectionRow
              key="dienstplan"
              title="Mein Dienstplan"
              meta={
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-gray-500"
                  aria-hidden="true"
                />
              }
              href={dienstplanHref}
            />
          ) : null;
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
        // Die laufende Woche bis gestern; der Kopf nennt den Saldo aller Wochen,
        // so widersprechen sich die zwei Zahlen nicht (Runde 11).
        const saldoLabel = partial ? "Wochensaldo bis gestern" : "Wochensaldo";
        if (single) {
          // Runde 19: Über den Tagen stehen die Stunden der Woche wie in der
          // Kachel „Diese Woche“ des Desktops (Ist von Soll). Der Kopf nennt
          // den einzigen Saldo; den Saldo je Tag zeigt jede Zeile.
          const soll = days.reduce(
            (sum, d) => sum + (d.projection?.targetMinutes ?? 0),
            0,
          );
          return (
            <CollectionGroup
              key={week}
              title={
                <span className="tabular-nums">
                  {formatDayMonth(from)}–{formatDayMonth(to)}
                </span>
              }
              meta={
                <span className="tabular-nums">
                  <span className="font-semibold text-gray-900">
                    {formatDuration(ist)}
                  </span>
                  {soll > 0 ? ` von ${formatDuration(soll)}` : " gearbeitet"}
                </span>
              }
            >
              {days.flatMap((d) => dayRows(d, todayKey, onEdit))}
              {dienstplanRow}
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
            {dienstplanRow}
          </CollectionGroup>
        );
      })}
    </Collection>
  );
}

const SHORT_PHONE_ROWS =
  "[@media(max-height:760px)]:[&_[data-collection-row]]:min-h-[52px] [@media(max-height:760px)]:[&_[data-collection-row]]:py-1.5 [@media(max-height:760px)]:[&_[data-collection-row]>.flex-1>span]:mt-0 [@media(max-height:760px)]:[&_[data-collection-row]>.flex-1>span]:leading-[18px]";

/** Heute ist abgeschlossen: gestempelt und kein Block läuft mehr. */
/** „23.11.“ */
function formatDayMonth(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

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

function sourceLabel(session: OwnBlock | null): string | null {
  if (!session) return null;
  const source = session.source ?? "app";
  if (source === "nfc") return "NFC";
  if (source === "unknown") return null;
  return "App";
}

function dayRows(
  d: DayEntry,
  todayKey: string,
  onEdit: AppDayListProps["onEdit"],
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
  const plan =
    d.shifts.length > 0
      ? d.shifts.map((s) => `${s.startTime}–${s.endTime}`).join(", ")
      : null;
  const plannedText = plan ? `Geplant ${plan}` : null;
  // Das Blatt nennt wie die Desktop-Spalte „Plan (Schicht)“ auch entfallene
  // Schichten („08:00–16:30 entfällt“), statt „–“ zu zeigen.
  const factsPlan =
    [
      ...(plan ? [plan] : []),
      ...d.cancelled.map((s) => `${s.startTime}–${s.endTime} entfällt`),
    ].join(", ") || null;
  const facts = (session: OwnBlock | null): AppDayFacts => ({
    plan: factsPlan,
    projection: d.projection,
    showBalance: hasBalance,
    source: sourceLabel(session),
  });

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
    } else if (isFuture || isToday) {
      // Heute wie die kommenden Tage: der Zustand steht schon in der
      // Stempeluhr („Nicht eingestempelt“), die Zeile nennt nur den Plan
      // und seine Pause (Runde 15: die Stempeluhr nennt sie nicht mehr).
      title = plannedText ?? "Nichts geplant";
      const pause = d.shifts.reduce((sum, s) => sum + s.breakMinutes, 0);
      // Runde 17: Die Stempeluhr steht im Kopf und nennt nur Zustand und
      // Zeit; Schichtart, Vertretung und entfallene Schichten stehen hier.
      // Die Pause vorn: am SE kürzt die Zeile die Schichtart, nicht sie.
      // Runde 21: nur der erste Teil der Schichtart („Betreuung“ statt
      // „Betreuung / Zeit am Kind“), damit die Zeile zweizeilig bleibt; den
      // vollen Namen nennt das Einstempeln-Blatt.
      const types = [
        ...new Set(
          d.shifts.flatMap((s) =>
            s.shiftTypeName ? [shortShiftTypeName(s.shiftTypeName)] : [],
          ),
        ),
      ];
      const parts = [
        pause > 0 ? `Pause ${pause} min` : null,
        d.shifts.some((s) => s.originShiftId) ? "Vertretung" : null,
        ...types,
        ...d.cancelled.map((s) => `${s.startTime}–${s.endTime} entfällt`),
      ].filter((part): part is string => part !== null);
      subtitle = parts.length > 0 ? parts.join(" · ") : undefined;
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
        // Runde 19: Die Schichtart eines geplanten Tags bricht um, statt
        // am SE zu „Betreuung / …“ gekürzt zu werden.
        wrap={isFuture || isToday}
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
              onClick: () => onEdit(d.day, null, facts(null)),
              "aria-label": `${WEEKDAY_SHORT[toIsoDayOfWeek(d.day)]} ${d.day.getDate()}.: ${title}`,
            })}
      />,
    ];
  }

  return d.sessions.map((s, index) => {
    const open = s.checkOutTime === null;
    const times = `${formatTime(s.checkInTime)}–${open ? "läuft" : formatTime(s.checkOutTime)}`;
    const parts: string[] = [];
    // Der Ort steht in jeder Zeile wie die Status-Spalte des Desktops.
    parts.push(s.status === "home_office" ? "Unterwegs" : "OGS");
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
        subtitle={parts.join(" · ")}
        meta={
          d.sessions.length > 1 && !last
            ? meta(s.netMinutes, false)
            : meta(d.sessions.length > 1 ? dayIst : s.netMinutes, hasBalance)
        }
        onClick={() => onEdit(d.day, s, facts(s))}
        aria-label={`${WEEKDAY_SHORT[toIsoDayOfWeek(d.day)]} ${d.day.getDate()}.: ${times} bearbeiten`}
      />
    );
  });
}

// ─── Stundenkonto ────────────────────────────────────────────────────────────

/**
 * Die Kacheln „Dieser Monat“ und „Stundenkonto“ des Desktops mit der Herkunft
 * des Solls (#8070, Runde 9). Vorher standen sie als Fußzeile in der
 * Stempeluhr und schoben die Tage aus dem ersten Bild; die Woche steht in
 * der Kopfkarte.
 */
export function AppAccountCard({
  weekIst,
  weekSoll,
  monthIst,
  monthSoll,
  accountBalanceMinutes,
  accountStart,
  origin,
}: Readonly<{
  weekIst: number | null;
  weekSoll: number | null;
  monthIst: number | null;
  monthSoll: number | null;
  accountBalanceMinutes: number | null;
  /** Beginn des Stundenkontos; `null`, solange keiner feststeht. */
  accountStart: Date | null;
  /** Woher das Soll kommt, oder was fehlt (mit Link zum Eintragen). */
  origin: ReactNode;
}>) {
  const since =
    accountStart?.toLocaleDateString("de-DE", {
      timeZone: "Europe/Berlin",
      day: "numeric",
      month: "long",
      year: "numeric",
    }) ?? null;
  return (
    <SectionCard title="Stundenkonto" bodyClassName="mt-1">
      <div className="divide-y divide-gray-100 text-sm tabular-nums">
        {/* Runde 19: „Diese Woche“ wie die erste Kachel des Desktops; der
            Kopf nennt am Telefon nur noch den Saldo. */}
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <span className="text-gray-600">Diese Woche</span>
          <span className="text-right text-gray-500">
            <span className="font-semibold text-gray-900">
              {weekIst === null ? "–" : formatDuration(weekIst)}
            </span>
            {weekSoll === null ? null : ` von ${formatDuration(weekSoll)}`}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <span className="text-gray-600">Dieser Monat</span>
          <span className="text-right text-gray-500">
            <span className="font-semibold text-gray-900">
              {monthIst === null ? "–" : formatDuration(monthIst)}
            </span>
            {monthSoll === null ? null : ` von ${formatDuration(monthSoll)}`}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <span className="text-gray-600">
            {since ? `Saldo seit ${since}` : "Saldo"}
          </span>
          <span
            className={cn(
              "font-semibold",
              accountBalanceMinutes === null
                ? "text-gray-900"
                : balanceClass(accountBalanceMinutes),
            )}
          >
            {accountBalanceMinutes === null
              ? "–"
              : formatSignedDuration(accountBalanceMinutes)}
          </span>
        </div>
      </div>
      <div className="border-t border-gray-100 pt-2.5 text-sm text-gray-500">
        {origin}
      </div>
    </SectionCard>
  );
}

// ─── Aufbau ──────────────────────────────────────────────────────────────────

/**
 * Telefon: Stempeluhr, die Tage, dann Heute geplant, Urlaub und
 * Kontingente.
 */
export function AppTimeTrackingLayout({
  errors,
  clock,
  days,
  account,
  today,
  leave,
  allowances,
}: Readonly<{
  errors: ReactNode;
  clock: ReactNode;
  days: ReactNode;
  /** Monat, Stundenkonto und Herkunft des Solls (Kacheln des Desktops). */
  account?: ReactNode;
  today: ReactNode;
  leave: ReactNode;
  allowances: ReactNode;
}>) {
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
      {account}
      {today}
      {leave}
      {allowances}
    </div>
  );
}

// ─── Angaben des Tages (Blatt) ───────────────────────────────────────────────

/**
 * Plan, Soll, Ist, Gutschrift, Saldo und Quelle eines Tages: die Spalten der
 * Desktop-Tabelle, oben im Blatt des Tages (#8070, Runde 7).
 */
export function AppDayFactsPanel({ facts }: { readonly facts: AppDayFacts }) {
  const p = facts.projection;
  const credit = p?.creditMinutes ?? 0;
  return (
    // Ohne eigene Fläche (Runde 9): eine Karte in der Karte las sich wie
    // ein zweites Blatt; eine Linie trennt die Angaben vom Formular.
    <dl
      className="grid grid-cols-3 gap-x-3 gap-y-2 border-b border-gray-100 pb-4 text-sm tabular-nums"
      data-app-day-facts=""
    >
      <DataField label="Plan">{facts.plan ?? "–"}</DataField>
      <DataField label="Soll">
        {p && p.targetMinutes > 0 ? formatDuration(p.targetMinutes) : "–"}
      </DataField>
      <DataField label="Ist">
        {p && p.actualMinutes > 0 ? formatDuration(p.actualMinutes) : "–"}
      </DataField>
      <DataField label="Gutschrift">
        {credit > 0 ? formatDuration(credit) : "–"}
      </DataField>
      <DataField label="Saldo">
        {facts.showBalance && p ? (
          <span className={balanceClass(p.balanceMinutes)}>
            {formatSignedDuration(p.balanceMinutes)}
          </span>
        ) : (
          "–"
        )}
      </DataField>
      <DataField label="Erfasst über">{facts.source ?? "–"}</DataField>
    </dl>
  );
}
