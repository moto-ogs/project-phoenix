"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { BELOW_SM, useMediaQuery } from "~/lib/hooks/use-media-query";
import { useOptimisticStamp } from "~/lib/hooks/use-optimistic-stamp";
import { useOwnTimeRefresh } from "~/lib/hooks/use-own-time-refresh";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useCurrentTimestamp } from "~/lib/hooks/use-current-timestamp";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import { useLiveRefreshInterval, useSWRAuth } from "~/lib/swr";
import { StatCard } from "~/components/ui/stat-card";
import { AnchoredPopover } from "~/components/ui/anchored-popover";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { SectionCard } from "~/components/ui/section-card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { Modal } from "~/components/ui/modal";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "~/components/ui/segmented-control";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { Textarea } from "~/components/ui/textarea";
import {
  formatSignedDuration,
  TargetOriginChip,
} from "~/components/staff/staff-time-views";
import { TodayAssignmentsCard } from "~/components/time-tracking/betreuungsplan-heute-card";
import {
  berlinClockFromISO,
  berlinDayStart,
  berlinTodayISO,
} from "~/lib/date-helpers";
import { LOCATION_COLORS } from "~/lib/location-helper";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { liveDayLaborHints, type LaborHint } from "~/lib/labor-time-hints";
import {
  readStampDeviation,
  PLANNED_START_NOT_REACHED_CODE,
  timeTrackingService,
} from "~/lib/time-tracking-api";
import { ApiError } from "~/lib/api-error";
import {
  type WorkSessionBreak,
  type WorkDayLaborHint,
  absenceDisplayLabel,
  formatDuration,
  formatTime,
  calculateNetMinutes,
  balanceSessionEnd,
  OPEN_MONTH_REFRESH_MS,
} from "~/lib/time-tracking-helpers";
import type { ClockSession, PlanShift } from "~/lib/own-time-tracking-view";
import { createLogger } from "~/lib/logger";
import { errorStatus } from "~/lib/expected-failure";
import { IconTile } from "~/components/ui/icon-tile";
import { SpinnerIcon } from "~/components/ui/icons";
import { ModalActions } from "./absence-and-session-dialogs";
import { clockMetrics, readOwnClock } from "./own-clock-read";

const logger = createLogger({ component: "OwnClock" });
const unavailable = new ApiError("Own clock part unavailable", undefined, {
  code: "general.unavailable",
});
type ClockMetrics = ReturnType<typeof clockMetrics>;

const WeekChart = dynamic(() => import("./week-chart"), {
  ssr: false,
  loading: () => (
    <Skeleton shape="card" className="min-h-[280px]" aria-hidden />
  ),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── ClockInCard ──────────────────────────────────────────────────────────────

// Renders today's planned Dienstplan shifts under the Stempeluhr title: each
// active shift with its Schichtart chip, a "Vertretung" tag for replacement
// shifts, plus a muted line for shifts that do not take place ("entfällt"),
// so Dienstplan-level changes are visible to the staff member (#1844).
function PlannedShiftsInfo({
  plannedShifts,
  cancelledShifts,
}: {
  readonly plannedShifts?: readonly PlanShift[];
  readonly cancelledShifts?: readonly PlanShift[];
}) {
  const active = plannedShifts ?? [];
  const cancelled = cancelledShifts ?? [];
  if (active.length === 0 && cancelled.length === 0) return null;
  return (
    <div className="-mt-3 mb-5 space-y-1 text-sm text-gray-500">
      {active.map((shift) => (
        <div key={shift.id} className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500">Geplant:</span>
          {shift.shiftTypeName && (
            // Schichtart pill: the color is tenant-defined data the backend
            // embeds (#1844), not a brand hue; without one the pill falls
            // back to the neutral HOME gray.
            <StatusColorBadge
              label={shift.shiftTypeName}
              color={shift.shiftTypeColor ?? LOCATION_COLORS.HOME}
            />
          )}
          <span className="tabular-nums">
            {shift.startTime}–{shift.endTime}
          </span>
          {shift.originShiftId && (
            <StatusBadge label="Vertretung" tone="blue" compact />
          )}
          {shift.breakMinutes > 0 && (
            <span className="text-gray-500">
              · Pause {shift.breakMinutes} min
            </span>
          )}
        </div>
      ))}
      {cancelled.map((shift) => (
        <div
          key={shift.id}
          className="flex flex-wrap items-center gap-1.5 text-gray-500"
        >
          <span className="tabular-nums line-through">
            {shift.startTime}–{shift.endTime}
          </span>
          <StatusBadge label="Entfällt" tone="gray" compact />
          {shift.changeReason && (
            <span className="italic">{shift.changeReason}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function formatTimeFromDate(date: Date): string {
  return berlinClockFromISO(date.toISOString());
}

const DEFAULT_BREAK_MINUTES = 30;
const BREAK_STEP_MINUTES = 15;
const BREAK_START_TOOLTIP =
  "Startet sofort eine Pause mit der gewählten Dauer.";
const MIN_BREAK_MINUTES = 15;
const MAX_BREAK_MINUTES = 240;

// Session status type (only present or home_office - no absent for active sessions)
type SessionStatus = ClockSession["status"];

// Work mode type for clock-in status (includes absent option)
type WorkMode = SessionStatus | "absent";

// Calculate elapsed minutes from a start time to now
function calcElapsedMinutes(startTime: string | Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(startTime).getTime()) / 60000),
  );
}

// Calculate elapsed seconds from a start time to now
function calcElapsedSeconds(startTime: string | Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(startTime).getTime()) / 1000),
  );
}

// Calculate live break minutes including active break
function calcLiveBreakMins(
  breakMins: number,
  activeBreak: WorkSessionBreak | null,
  now: Date,
): number {
  if (!activeBreak) return breakMins;
  const activeBreakMins = calcElapsedMinutes(activeBreak.startedAt, now);
  return breakMins + activeBreakMins;
}

// Format countdown as MM:SS
function formatCountdown(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Returns the kit StatusBadge tone and label for the current session state.
function getSessionStatusBadge(
  isOnBreak: boolean,
  status: string | undefined,
): { tone: StatusBadgeTone; label: string } {
  if (isOnBreak) {
    return { tone: "orange", label: "Pause" };
  }
  if (status === "home_office") {
    return { tone: "blue", label: "Unterwegs" };
  }
  return { tone: "green", label: "In der OGS" };
}

// Vor Ort / Homeoffice / Abwesend as a kit SegmentedControl. Tones map to
// LOCATION_COLORS: present → GROUP_ROOM green, home_office → OTHER_ROOM blue,
// absent → HOME red. `value` stays null until the staff member picks one
// (Issue #1368 — no pre-selection on an audit-relevant choice).
const WORK_MODE_ITEMS: readonly SegmentedControlItem<WorkMode>[] = [
  { value: "present", label: "In der OGS", tone: "green" },
  { value: "home_office", label: "Unterwegs", tone: "blue" },
  { value: "absent", label: "Abwesend", tone: "red" },
];

// The circular stamp controls are deliberately larger than any kit Button size
// (64px / 48px touch targets on a tablet mounted in the hallway), so they pass
// their geometry to ui/Button via className while keeping the kit's focus,
// disabled and transition treatment. Colors are brand hexes only.
//
// `!rounded-full` is load-bearing: Button applies a radius per size
// (`rounded-lg` on the page sizes), and Tailwind resolves competing
// border-radius utilities by stylesheet order, not by the order they appear in
// the class attribute. Without the important modifier these buttons render as
// rounded squares. Same modifier as the break stepper below.
const STAMP_BUTTON_BASE =
  "!rounded-full border-2 !p-0 shadow-none hover:shadow-none active:scale-95";

// Returns className for the check-in button. `mode === null` renders muted and
// disabled — the staff member must pick a status first (Issue #1368).
function getCheckInButtonClassName(mode: WorkMode | null): string {
  const base = `${STAMP_BUTTON_BASE} h-16 w-16 disabled:cursor-not-allowed`;
  if (mode === null)
    return `${base} border-gray-500/40 text-gray-500/60 cursor-not-allowed`;
  if (mode === "home_office")
    return `${base} border-moto-blue text-moto-blue hover:bg-moto-blue/5`;
  return `${base} border-moto-green text-moto-green hover:bg-moto-green/5`;
}

// Returns className for the break/pause button. Orange is SCHOOLYARD #F78C10
// from LOCATION_COLORS — the app's warning tone.
function getBreakButtonClassName(
  isOnBreak: boolean,
  breakMins: number,
): string {
  const base = `${STAMP_BUTTON_BASE} h-12 w-12 disabled:opacity-60`;
  if (isOnBreak) return `${base} border-moto-orange text-moto-orange`;
  if (breakMins > 0)
    return `${base} border-moto-orange text-moto-orange hover:bg-moto-orange/10`;
  return `${base} border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-500`;
}

// Returns formatted duration for today footer
function calcGrossMinutes(
  isCheckedIn: boolean,
  session: ClockSession | null,
  now: Date,
  end: Date,
): number {
  if (!isCheckedIn || !session) return 0;
  const start = new Date(session.checkInTime);
  if (Number.isNaN(start.getTime())) return 0;
  const dayStart = berlinDayStart(now);
  const from = start > dayStart ? start : dayStart;
  if (end <= from) return 0;
  return calcElapsedMinutes(from, end);
}

// Break minutes of the running block that fall inside [from, now]. Used for a
// block that started before midnight: its cached breakMinutes covers the whole
// block, and deducting yesterday's pause from today's live figure would
// understate today's work.
function calcBreakMinutesSince(
  breaks: readonly WorkSessionBreak[],
  from: Date,
  now: Date,
): number {
  let totalMs = 0;
  for (const workBreak of breaks) {
    const start = new Date(workBreak.startedAt).getTime();
    const end = workBreak.endedAt
      ? new Date(workBreak.endedAt).getTime()
      : now.getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const overlap =
      Math.min(end, now.getTime()) - Math.max(start, from.getTime());
    if (overlap > 0) totalMs += overlap;
  }
  return Math.floor(totalMs / 60_000);
}

// Calculate countdown remaining seconds for break timer
// Prefers plannedEndTime from backend (persists across refresh)
// Falls back to plannedMins for immediate feedback before backend responds
function calcCountdownSecs(
  isOnBreak: boolean,
  plannedEndTime: string | null,
  plannedMins: number | null,
  elapsedSecs: number,
  now: Date,
): number | null {
  if (!isOnBreak) return null;

  // Use backend's plannedEndTime if available (survives refresh)
  if (plannedEndTime) {
    const endTime = new Date(plannedEndTime).getTime();
    const remaining = Math.floor((endTime - now.getTime()) / 1000);
    return Math.max(0, remaining);
  }

  // Fallback to local state for immediate feedback
  if (plannedMins === null) return null;
  return Math.max(0, plannedMins * 60 - elapsedSecs);
}

// Check if auto-end break should trigger
function shouldAutoEndBreak(
  countdownSecs: number | null,
  isOnBreak: boolean,
  loading: boolean,
): boolean {
  return countdownSecs !== null && countdownSecs <= 0 && isOnBreak && !loading;
}

// Hinweise zu Pause und Tageslimit, nur während der Arbeit. Werte und
// Schwellen kommen vom Server (#4804); der Arbeitstag ist der Tag, an dem der
// laufende Block begann.
function getLiveLaborHints(
  isCheckedIn: boolean,
  session: ClockSession | null,
  laborDays: readonly WorkDayLaborHint[],
  now: Date,
): LaborHint[] {
  if (!isCheckedIn || !session) return [];
  const workday = berlinTodayISO(new Date(session.checkInTime));
  return liveDayLaborHints(
    laborDays.find((day) => day.date === workday),
    now,
  );
}

// Timer display content based on break/work state
function renderTimerContent(
  isOnBreak: boolean,
  countdownRemainingSecs: number | null,
  plannedBreakDurationMins: number | null,
  plannedBreakEndsAt: string | null,
  activeBreakElapsedSecs: number,
  displayMinutes: number,
  laborHints: readonly LaborHint[],
): React.ReactNode {
  // Break with countdown timer
  if (
    isOnBreak &&
    countdownRemainingSecs !== null &&
    plannedBreakDurationMins
  ) {
    return (
      <>
        <span className="text-moto-orange-strong text-4xl font-light tabular-nums">
          {formatCountdown(countdownRemainingSecs)}
        </span>
        <span className="text-moto-orange-strong mt-0.5 text-xs font-medium">
          Pause ({plannedBreakDurationMins} Min)
        </span>
        <span className="text-moto-amber-strong mt-0.5 text-center text-xs font-medium">
          {plannedBreakEndsAt
            ? `Automatisch weiter um ${formatTime(plannedBreakEndsAt)}`
            : "Automatisch weiter nach der Pause"}
        </span>
      </>
    );
  }
  // Break without countdown (manual)
  if (isOnBreak) {
    return (
      <>
        <span className="text-moto-orange-strong text-4xl font-light tabular-nums">
          {formatCountdown(activeBreakElapsedSecs)}
        </span>
        <span className="text-moto-orange-strong mt-0.5 text-xs font-medium">
          Pause läuft
        </span>
      </>
    );
  }
  // Working time display
  return (
    <>
      <span className="text-4xl font-light text-gray-900 tabular-nums">
        {formatDuration(displayMinutes)}
      </span>
      {laborHints.map((hint) => (
        <span
          key={hint.key}
          title={hint.title}
          className="text-moto-amber-strong mt-0.5 text-center text-xs font-medium"
        >
          {hint.text}
        </span>
      ))}
    </>
  );
}

function ClockInCard({
  currentSession,
  breaks,
  onCheckIn,
  onCheckOut,
  onStartBreak,
  onEndBreak,
  completedTodayMinutes,
  onAddAbsence,
  metrics,
  plannedShifts,
  cancelledShifts,
  stampingDisabled,
  saving = false,
  laborDays,
  setTargetHref,
}: {
  readonly currentSession: ClockSession | null;
  readonly breaks: WorkSessionBreak[];
  readonly onCheckIn: (status: SessionStatus) => Promise<void>;
  readonly onCheckOut: () => Promise<void>;
  readonly onStartBreak: (durationMinutes: number) => Promise<void>;
  readonly onEndBreak: () => Promise<void>;
  readonly completedTodayMinutes: number;
  readonly onAddAbsence: () => void;
  readonly metrics?: ClockMetrics;
  readonly plannedShifts?: readonly PlanShift[];
  readonly cancelledShifts?: readonly PlanShift[];
  /** Session and absence data must be current before a stamp is allowed. */
  readonly stampingDisabled: boolean;
  /**
   * A stamp is on its way (#5012): the card already shows its expected
   * result, the header says it is not confirmed yet.
   */
  readonly saving?: boolean;
  /** ArbZG-Sicht der geladenen Arbeitstage vom Server (#4804). */
  readonly laborDays: readonly WorkDayLaborHint[];
  /** Führt zum eigenen Arbeitszeitmodell, wenn das Soll fehlt und die Person
   *  es selbst setzen darf (#6887). */
  readonly setTargetHref?: string;
}) {
  // Null until the staff member explicitly picks Vor Ort / Homeoffice / Abwesend.
  // No pre-selection per Issue #1368 — silent defaults are unacceptable for an
  // audit-relevant choice.
  const [mode, setMode] = useState<WorkMode | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now);
  const [breakMenuOpen, setBreakMenuOpen] = useState(false);
  const [plannedBreakMinutes, setPlannedBreakMinutes] = useState<number | null>(
    null,
  );
  const [individualBreakMinutes, setIndividualBreakMinutes] = useState(
    DEFAULT_BREAK_MINUTES,
  );
  const isMobileViewport = useMediaQuery(BELOW_SM);
  // Mutex to prevent race condition in auto-end break effect
  const autoEndInFlightRef = useRef(false);
  const autoEndAttemptedBreakIdRef = useRef<string | null>(null);

  const isCheckedIn =
    currentSession !== null && currentSession.checkOutTime === null;
  const isCheckedOut =
    currentSession !== null && currentSession.checkOutTime !== null;

  const activeBreak = breaks.find((b) => !b.endedAt) ?? null;
  const isOnBreak = activeBreak !== null;

  // Tick every second during break (for the seconds countdown) and every
  // 15s otherwise. 15s is fast enough that the "5h 29min" timer flips to
  // "5h 30min" within seconds of the actual minute change, but slow enough
  // to avoid pointless re-renders.
  useEffect(() => {
    if (!isCheckedIn) return;
    const interval = setInterval(
      () => setNowMs(Date.now()),
      isOnBreak ? 1000 : 15000,
    );
    return () => clearInterval(interval);
  }, [isCheckedIn, isOnBreak]);

  const now = new Date(nowMs);

  const breakMins = currentSession?.breakMinutes ?? 0;
  // Same midnight boundary as calcGrossMinutes: for an overnight block the
  // pauses are re-derived from the break rows so only today's share is
  // deducted from today's live minutes.
  const dayStart = berlinDayStart(now);
  const startedBeforeToday =
    isCheckedIn &&
    currentSession !== null &&
    new Date(currentSession.checkInTime).getTime() < dayStart.getTime();

  // The block's own end: `now` while it is running, its live limit once it has
  // passed it. Work AND break minutes are measured against this single instant
  // so the live figure cannot drift away from the server-side Saldo, which
  // caps the very same block (balanceSessionEnd).
  const liveEnd =
    isCheckedIn && currentSession !== null
      ? balanceSessionEnd(
          {
            date: currentSession.date,
            checkIn: new Date(currentSession.checkInTime),
            checkOut: null,
          },
          now,
        )
      : now;

  const liveBreakMins = startedBeforeToday
    ? calcBreakMinutesSince(breaks, dayStart, liveEnd)
    : calcLiveBreakMins(breakMins, activeBreak, liveEnd);
  const grossMinutes = calcGrossMinutes(
    isCheckedIn,
    currentSession,
    now,
    liveEnd,
  );
  const netMinutes = Math.max(0, grossMinutes - liveBreakMins);
  const dayNetMinutes = completedTodayMinutes + netMinutes;
  const displayMinutes = isCheckedIn ? dayNetMinutes : 0;
  const activeBreakElapsedSecs = activeBreak
    ? calcElapsedSeconds(activeBreak.startedAt, now)
    : 0;
  const countdownRemainingSecs = calcCountdownSecs(
    isOnBreak,
    activeBreak?.plannedEndTime ?? null,
    plannedBreakMinutes,
    activeBreakElapsedSecs,
    now,
  );

  // Calculate planned break duration from backend or local state
  // Backend: plannedEndTime - startedAt, Local: plannedBreakMinutes (for immediate feedback)
  const plannedBreakDurationMins: number | null = (() => {
    if (activeBreak?.plannedEndTime && activeBreak.startedAt) {
      const start = new Date(activeBreak.startedAt).getTime();
      const end = new Date(activeBreak.plannedEndTime).getTime();
      return Math.round((end - start) / 60000);
    }
    return plannedBreakMinutes;
  })();

  // Auto-end break when countdown reaches 0
  useEffect(() => {
    if (
      shouldAutoEndBreak(countdownRemainingSecs, isOnBreak, actionLoading) &&
      !stampingDisabled &&
      !autoEndInFlightRef.current &&
      activeBreak?.id !== autoEndAttemptedBreakIdRef.current
    ) {
      autoEndInFlightRef.current = true;
      autoEndAttemptedBreakIdRef.current = activeBreak?.id ?? null;
      void (async () => {
        setActionLoading(true);
        try {
          await onEndBreak();
          setPlannedBreakMinutes(null);
        } finally {
          setActionLoading(false);
          autoEndInFlightRef.current = false;
        }
      })();
    }
  }, [
    countdownRemainingSecs,
    isOnBreak,
    actionLoading,
    stampingDisabled,
    activeBreak?.id,
    onEndBreak,
  ]);

  // Clear planned break when break ends externally
  useEffect(() => {
    if (!isOnBreak) {
      setPlannedBreakMinutes(null);
    }
  }, [isOnBreak]);

  // Hinweise zu Pause und Tageslimit (nur während der Arbeit)
  const laborHints = getLiveLaborHints(
    isCheckedIn,
    currentSession,
    laborDays,
    now,
  );

  const checkedOutNet =
    isCheckedOut && currentSession
      ? calculateNetMinutes(
          currentSession.checkInTime,
          currentSession.checkOutTime,
          currentSession.breakMinutes,
        )
      : null;

  // Session status badge (computed once, not in IIFE)
  const statusBadge =
    isCheckedIn && currentSession
      ? getSessionStatusBadge(isOnBreak, currentSession.status)
      : null;
  const workModeItems = useMemo(
    () =>
      stampingDisabled
        ? WORK_MODE_ITEMS.map((item) => ({ ...item, disabled: true }))
        : WORK_MODE_ITEMS,
    [stampingDisabled],
  );

  const handleCheckIn = async () => {
    // mode === null: user has not yet chosen — the button is disabled in the
    // UI, but guard here too in case of stray double-clicks.
    // mode === "absent": that path opens the absence modal, not check-in.
    if (stampingDisabled || mode === null || mode === "absent") return;
    setActionLoading(true);
    try {
      await onCheckIn(mode);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (stampingDisabled) return;
    setActionLoading(true);
    try {
      await onCheckOut();
    } finally {
      setActionLoading(false);
    }
  };

  const handleSelectBreakDuration = async (minutes: number) => {
    if (stampingDisabled) return;
    setBreakMenuOpen(false);
    setPlannedBreakMinutes(minutes);
    setActionLoading(true);
    try {
      await onStartBreak(minutes);
    } finally {
      setActionLoading(false);
    }
  };

  // Während Laden, Ladefehler oder Speichern bleibt der Knopf nativ gesperrt:
  // dann gibt es keinen fachlichen Grund zu nennen.
  const reasonOnceReady = (reason: string) =>
    stampingDisabled || actionLoading ? undefined : reason;

  const handleBreakStepperChange = (direction: 1 | -1) => {
    setIndividualBreakMinutes((current) =>
      Math.min(
        MAX_BREAK_MINUTES,
        Math.max(MIN_BREAK_MINUTES, current + direction * BREAK_STEP_MINUTES),
      ),
    );
  };

  const handleEndBreakEarly = async () => {
    if (stampingDisabled) return;
    setActionLoading(true);
    try {
      await onEndBreak();
      setPlannedBreakMinutes(null);
    } finally {
      setActionLoading(false);
    }
  };

  const showBreakDurationPicker = breakMenuOpen && !isOnBreak;
  const breakDurationStepper = (
    <div className="mx-auto grid w-full max-w-xs grid-cols-[4.5rem_1fr_4.5rem] items-center gap-1 sm:flex sm:max-w-sm sm:justify-center sm:gap-5">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Pausendauer verringern"
        disabled={
          stampingDisabled ||
          actionLoading ||
          individualBreakMinutes <= MIN_BREAK_MINUTES
        }
        disabledReason={reasonOnceReady(
          `Kürzer als ${MIN_BREAK_MINUTES} Minuten geht nicht.`,
        )}
        tooltip={`Verkürzt die geplante Pause um ${BREAK_STEP_MINUTES} Minuten.`}
        onClick={() => handleBreakStepperChange(-1)}
        className="h-[4.5rem] w-[4.5rem] !rounded-[1.75rem] border border-gray-200 shadow-none sm:h-12 sm:w-12 sm:!rounded-xl"
      >
        <svg
          className="h-9 w-9 sm:h-7 sm:w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
        </svg>
      </Button>
      <div className="flex h-20 min-w-32 items-center justify-center px-3 sm:h-14 sm:min-w-24">
        <span className="text-5xl font-semibold text-gray-900 tabular-nums sm:text-3xl">
          {individualBreakMinutes}
        </span>
        <span className="ml-2 text-lg font-medium text-gray-500 sm:text-sm">
          min
        </span>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Pausendauer erhöhen"
        disabled={
          stampingDisabled ||
          actionLoading ||
          individualBreakMinutes >= MAX_BREAK_MINUTES
        }
        disabledReason={reasonOnceReady(
          `Länger als ${MAX_BREAK_MINUTES} Minuten geht nicht.`,
        )}
        tooltip={`Verlängert die geplante Pause um ${BREAK_STEP_MINUTES} Minuten.`}
        onClick={() => handleBreakStepperChange(1)}
        className="h-[4.5rem] w-[4.5rem] !rounded-[1.75rem] border border-gray-200 shadow-none sm:h-12 sm:w-12 sm:!rounded-xl"
      >
        <svg
          className="h-9 w-9 sm:h-7 sm:w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </Button>
    </div>
  );
  const breakStartButton = (
    <Button
      type="button"
      size="md"
      variant="primary"
      disabled={stampingDisabled || actionLoading}
      onClick={() => void handleSelectBreakDuration(individualBreakMinutes)}
      tooltip={BREAK_START_TOOLTIP}
      className="mx-auto w-full max-w-sm"
    >
      Starten
    </Button>
  );
  const breakDurationControls = (
    <>
      {breakDurationStepper}
      <Button
        type="button"
        size="md"
        variant="primary"
        disabled={stampingDisabled || actionLoading}
        onClick={() => void handleSelectBreakDuration(individualBreakMinutes)}
        tooltip={BREAK_START_TOOLTIP}
        className="mx-auto mt-6 w-full max-w-sm"
      >
        Starten
      </Button>
    </>
  );

  return (
    <SectionCard
      title="Stempeluhr"
      actions={
        // One live region for both: screen readers hear „Wird gespeichert“
        // and then the confirmed state.
        <span role="status">
          {saving ? (
            <StatusBadge label="Wird gespeichert" tone="gray" />
          ) : statusBadge ? (
            <StatusBadge label={statusBadge.label} tone={statusBadge.tone} />
          ) : null}
        </span>
      }
    >
      {/* Ziel der Tour „Arbeitszeit erfassen“ (#3748). */}
      <div className="relative" data-setup-tour="time-clock">
        {/* Heute geplante Schichten (Dienstplan) — dezente Zeilen unter dem
            Titel: Dienstart als farbiger Chip, Vertretungen und entfallene
            Schichten sichtbar (#1844). Geteilte Dienste zeigen jede Schicht. */}
        <PlannedShiftsInfo
          plannedShifts={plannedShifts}
          cancelledShifts={cancelledShifts}
        />

        {/* ── Not checked in: start controls ── */}
        {!isCheckedIn && !isCheckedOut && (
          <div className="flex flex-col items-center gap-5">
            {/* Mode toggle */}
            <SegmentedControl
              ariaLabel="Arbeitsmodus"
              variant="pills"
              items={workModeItems}
              value={mode}
              onChange={setMode}
            />
            {/* „Unterwegs“ ersetzt „Homeoffice“ (#4778); der API-Wert bleibt
                home_office. Die Zeile sagt, was alles darunter fällt. */}
            <p className="-mt-2 text-center text-sm text-gray-500">
              Unterwegs: zum Beispiel Ausflug, Fortbildung oder zu Hause.
            </p>

            {/* Action button: play (check-in) or calendar (absence) */}
            {mode === "absent" ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onAddAbsence}
                disabled={stampingDisabled || actionLoading}
                className={`${STAMP_BUTTON_BASE} border-moto-red text-moto-red hover:bg-moto-red/5 h-16 w-16`}
                aria-label="Abwesenheit melden"
                tooltip="Öffnet ein Fenster, um eine Abwesenheit einzutragen."
              >
                <svg
                  className="h-7 w-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                  />
                </svg>
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={handleCheckIn}
                disabled={stampingDisabled || actionLoading || mode === null}
                disabledReason={reasonOnceReady(
                  "Wähle zuerst oben deinen Status.",
                )}
                className={getCheckInButtonClassName(mode)}
                aria-label="Einstempeln"
                tooltip="Startet deine Arbeitszeit im gewählten Status."
              >
                {actionLoading ? (
                  <SpinnerIcon className="h-5 w-5" />
                ) : (
                  <svg
                    className="ml-0.5 h-7 w-7"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </Button>
            )}

            <span className="text-xs text-gray-500 sm:text-sm">
              {mode === null
                ? "Bitte Status wählen"
                : mode === "absent"
                  ? "Abwesenheit melden"
                  : "Einstempeln"}
            </span>
          </div>
        )}

        {/* ── Checked in: timer controls ── */}
        {isCheckedIn && (
          <>
            {/* Control row: pause | timer | stop */}
            <div className="mb-5 flex items-center justify-between">
              {/* Pause button (opens menu) or End Break button */}
              <div>
                {isOnBreak ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleEndBreakEarly}
                    disabled={stampingDisabled || actionLoading}
                    className={getBreakButtonClassName(true, breakMins)}
                    aria-label="Pause beenden"
                    tooltip="Beendet die Pause sofort, deine Arbeitszeit läuft weiter."
                  >
                    <svg
                      className="h-5 w-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </Button>
                ) : (
                  // The outside click is consumed so that dismissing this
                  // picker cannot also trigger an action behind it.
                  <AnchoredPopover
                    open={showBreakDurationPicker && !isMobileViewport}
                    onOpenChange={setBreakMenuOpen}
                    ariaLabel="Pause stempeln"
                    preferredWidth={288}
                    focusPanelOnOpen
                    swallowOutsideClick
                    className="p-3"
                    renderTrigger={({ ref, panelId }) => (
                      <Button
                        ref={ref}
                        type="button"
                        variant="ghost"
                        onClick={() => setBreakMenuOpen(!breakMenuOpen)}
                        disabled={stampingDisabled || actionLoading}
                        className={getBreakButtonClassName(false, breakMins)}
                        aria-label="Pause starten"
                        tooltip="Öffnet die Auswahl, wie lange die Pause dauert."
                        aria-expanded={breakMenuOpen}
                        aria-haspopup="dialog"
                        aria-controls={
                          showBreakDurationPicker && !isMobileViewport
                            ? panelId
                            : undefined
                        }
                      >
                        <svg
                          className="h-5 w-5"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      </Button>
                    )}
                  >
                    {() => breakDurationControls}
                  </AnchoredPopover>
                )}
              </div>

              {showBreakDurationPicker && isMobileViewport && (
                <Drawer
                  open
                  onOpenChange={(next) => {
                    if (!next) setBreakMenuOpen(false);
                  }}
                  direction="bottom"
                  shouldScaleBackground
                >
                  <DrawerContent
                    aria-label="Pause stempeln"
                    aria-describedby={undefined}
                    className="max-h-[calc(100vh-7rem)] min-h-[22rem] overflow-visible px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
                  >
                    <DrawerHeader className="flex items-center justify-between px-0 pt-4 pb-4 text-left">
                      <DrawerTitle>Pause stempeln</DrawerTitle>
                      <DrawerClose
                        type="button"
                        aria-label="Pausendauer schließen"
                        className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                      >
                        <svg
                          className="h-5 w-5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M6 6l12 12" />
                          <path d="M18 6L6 18" />
                        </svg>
                      </DrawerClose>
                    </DrawerHeader>
                    <div className="flex min-h-56 flex-1 flex-col pt-2 pb-1">
                      <div className="flex flex-1 items-start pt-8">
                        {breakDurationStepper}
                      </div>
                      {breakStartButton}
                    </div>
                  </DrawerContent>
                </Drawer>
              )}

              {/* Timer display */}
              <div className="flex flex-col items-center">
                {renderTimerContent(
                  isOnBreak,
                  countdownRemainingSecs,
                  plannedBreakDurationMins,
                  activeBreak?.plannedEndTime ?? null,
                  activeBreakElapsedSecs,
                  displayMinutes,
                  laborHints,
                )}
              </div>

              {/* Stop / check-out button */}
              <Button
                type="button"
                variant="ghost"
                onClick={handleCheckOut}
                disabled={stampingDisabled || actionLoading || isOnBreak}
                disabledReason={reasonOnceReady("Beende zuerst die Pause.")}
                tooltip="Stempelt dich aus und beendet deine Arbeitszeit."
                className={`${STAMP_BUTTON_BASE} hover:border-moto-red hover:text-moto-red h-12 w-12 border-gray-300 text-gray-500 disabled:opacity-50`}
                aria-label="Ausstempeln"
              >
                {actionLoading ? (
                  <SpinnerIcon className="h-4 w-4" />
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                )}
              </Button>
            </div>

            {/* ── Activity log rows ── */}
            <div className="border-t border-gray-100">
              <BreakActivityLog
                checkInTime={currentSession?.checkInTime ?? ""}
                now={now}
                breaks={breaks}
                isCheckedIn={isCheckedIn}
                plannedBreakMinutes={plannedBreakMinutes}
              />
            </div>
          </>
        )}

        {/* ── Checked out: summary rows ── */}
        {isCheckedOut && currentSession && (
          <div className="border-t border-gray-100">
            <div className="flex items-center justify-between py-2.5 text-sm">
              <span className="w-14 shrink-0 font-medium text-gray-700">
                Arbeit
              </span>
              <span className="w-12 shrink-0 text-center text-gray-600 tabular-nums">
                {formatTime(currentSession.checkInTime)}
              </span>
              <span className="shrink-0 text-gray-500">&rarr;</span>
              <span className="w-12 shrink-0 text-center text-gray-600 tabular-nums">
                {formatTime(currentSession.checkOutTime)}
              </span>
              <span className="w-16 shrink-0 text-right font-medium text-gray-700 tabular-nums">
                {checkedOutNet === null ? "--" : formatDuration(checkedOutNet)}
              </span>
            </div>

            {currentSession.breakMinutes > 0 && (
              <div className="flex items-center justify-between border-t border-gray-50 py-2.5 text-sm">
                <span className="w-14 shrink-0 font-medium text-gray-500">
                  Pause
                </span>
                <span className="w-12 shrink-0" />
                <span className="shrink-0 opacity-0">&rarr;</span>
                <span className="w-12 shrink-0" />
                <span className="w-16 shrink-0 text-right text-gray-500 tabular-nums">
                  {formatDuration(currentSession.breakMinutes)}
                </span>
              </div>
            )}
          </div>
        )}

        {metrics && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <ClockInStatsStrip metrics={metrics} />
            <div className="mt-3 flex justify-end">
              <TargetOriginChip
                hasTargetOverride={metrics.hasTargetOverride}
                hasTarget={metrics.hasTarget}
                setTargetHref={setTargetHref}
              />
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function ClockInStatsStrip({
  metrics,
}: {
  // Every figure is date-valid, straight from the backend month model
  // (#1842, #6847). Never price days in the browser: a
  // browser-side calculation contradicted the Monatskarte and the daily rows
  // after a contract change. null = loading.
  readonly metrics: ClockMetrics;
}) {
  const { week, month, accountBalanceMinutes } = metrics;

  const weekPct =
    week && (week.soll ?? 0) > 0 ? (week.ist / (week.soll ?? 1)) * 100 : 0;
  const monthPct =
    month && (month.soll ?? 0) > 0 ? (month.ist / (month.soll ?? 1)) * 100 : 0;

  const accountTone =
    accountBalanceMinutes === null
      ? "gray"
      : accountBalanceMinutes > 0
        ? "orange"
        : accountBalanceMinutes < -60
          ? "gray"
          : "green";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      <StatCard
        label="Diese Woche"
        value={week === null ? "–" : formatDuration(week.ist)}
        hint={
          week.soll === null
            ? "Soll unbekannt"
            : `von ${formatDuration(week.soll)} · ${Math.round(weekPct)} %`
        }
        progressPct={week.soll === null ? undefined : weekPct}
        tone="green"
      />
      <StatCard
        label="Dieser Monat"
        value={month === null ? "–" : formatDuration(month.ist)}
        hint={
          month.soll === null
            ? "Soll unbekannt"
            : `von ${formatDuration(month.soll)} · ${Math.round(monthPct)} %`
        }
        progressPct={month.soll === null ? undefined : monthPct}
        tone="green"
      />
      <StatCard
        label="Stundenkonto"
        value={
          accountBalanceMinutes === null
            ? "–"
            : formatSignedDuration(accountBalanceMinutes)
        }
        hint={
          metrics.accountStart
            ? `seit ${metrics.accountStart.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`
            : undefined
        }
        tone={accountTone}
      />
    </div>
  );
}

// ─── BreakActivityLog ────────────────────────────────────────────────────────

function BreakActivityLog({
  checkInTime,
  now,
  breaks,
  isCheckedIn,
  plannedBreakMinutes,
}: {
  readonly checkInTime: string;
  readonly now: Date;
  readonly breaks: WorkSessionBreak[];
  readonly isCheckedIn: boolean;
  readonly plannedBreakMinutes?: number | null;
}) {
  // Build timeline segments: work → break → work → break → work...
  const segments: Array<{
    type: "work" | "break";
    start: Date;
    end: Date | null;
    durationMinutes: number;
    isActive: boolean;
  }> = [];

  const checkIn = new Date(checkInTime);
  let cursor = checkIn;

  for (const brk of breaks) {
    const breakStart = new Date(brk.startedAt);
    const breakEnd = brk.endedAt ? new Date(brk.endedAt) : null;

    // Work segment before this break
    if (breakStart > cursor) {
      const workDuration = Math.max(
        0,
        Math.floor((breakStart.getTime() - cursor.getTime()) / 60000),
      );
      segments.push({
        type: "work",
        start: cursor,
        end: breakStart,
        durationMinutes: workDuration,
        isActive: false,
      });
    }

    // Break segment
    const isActiveBreak = !breakEnd;
    const breakDuration = (() => {
      if (breakEnd) return brk.durationMinutes;
      if (isActiveBreak && plannedBreakMinutes) return plannedBreakMinutes;
      return Math.max(
        0,
        Math.floor((now.getTime() - breakStart.getTime()) / 60000),
      );
    })();
    segments.push({
      type: "break",
      start: breakStart,
      end: breakEnd,
      durationMinutes: breakDuration,
      isActive: isActiveBreak,
    });

    cursor = breakEnd ?? now;
  }

  // Final work segment after last break (if checked in and not on active break)
  const lastBreak = breaks.at(-1);
  const hasActiveBreak = lastBreak && !lastBreak.endedAt;
  if (isCheckedIn && !hasActiveBreak) {
    const workDuration = Math.max(
      0,
      Math.floor((now.getTime() - cursor.getTime()) / 60000),
    );
    segments.push({
      type: "work",
      start: cursor,
      end: null,
      durationMinutes: workDuration,
      isActive: true,
    });
  }

  // If no breaks at all, show single work row
  if (segments.length === 0 && isCheckedIn) {
    const workDuration = Math.max(
      0,
      Math.floor((now.getTime() - checkIn.getTime()) / 60000),
    );
    segments.push({
      type: "work",
      start: checkIn,
      end: null,
      durationMinutes: workDuration,
      isActive: true,
    });
  }

  const MAX_VISIBLE = 3;
  const [expanded, setExpanded] = useState(false);
  const hasHidden = segments.length > MAX_VISIBLE;
  const hiddenSegments = hasHidden ? segments.slice(0, -MAX_VISIBLE) : [];
  const visibleSegments = hasHidden ? segments.slice(-MAX_VISIBLE) : segments;

  // Returns row text color class based on segment type and state
  const getSegmentRowColor = (seg: {
    type: "work" | "break";
    isActive: boolean;
  }) => {
    if (seg.type === "break" && seg.isActive) return "text-moto-amber-strong";
    if (seg.type === "break") return "text-gray-500";
    return "";
  };

  // Returns label text color class based on segment type and state
  const getSegmentLabelColor = (seg: {
    type: "work" | "break";
    isActive: boolean;
  }) => {
    if (seg.type === "work" && seg.isActive) return "text-moto-green-strong";
    if (seg.type === "work") return "text-gray-600";
    return "";
  };

  // Returns time text color class based on segment type and state
  const getSegmentTimeColor = (seg: {
    type: "work" | "break";
    isActive: boolean;
  }) => {
    if (seg.type === "work" && seg.isActive) return "text-moto-green-strong";
    if (seg.type === "work") return "text-gray-600";
    return "";
  };

  const renderRow = (
    seg: (typeof segments)[number],
    index: number,
    showBorder: boolean,
  ) => (
    <div
      key={`${seg.type}-${seg.start.toISOString()}`}
      className={`flex items-center justify-between py-2.5 text-sm ${
        showBorder ? "border-t border-gray-50" : ""
      } ${getSegmentRowColor(seg)}`}
    >
      <span
        className={`w-14 shrink-0 font-medium ${getSegmentLabelColor(seg)}`}
      >
        {seg.type === "work" ? "Arbeitszeit" : "Pause"}
      </span>
      <span
        className={`w-12 shrink-0 text-center tabular-nums ${getSegmentTimeColor(seg)}`}
      >
        {formatTimeFromDate(seg.start)}
      </span>
      <span
        className={`shrink-0 ${seg.type === "break" && seg.isActive ? "text-moto-orange/60" : "text-gray-500"}`}
      >
        &rarr;
      </span>
      <span className="w-12 shrink-0 text-center tabular-nums">
        {seg.end ? formatTimeFromDate(seg.end) : "···"}
      </span>
      <span
        className={`w-16 shrink-0 text-right tabular-nums ${
          seg.type === "work" ? "font-medium text-gray-700" : ""
        }`}
      >
        {formatDuration(seg.durationMinutes)}
      </span>
    </div>
  );

  return (
    <>
      {/* Collapsible older segments */}
      {hasHidden && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
          }}
        >
          <div className="overflow-hidden">
            {hiddenSegments.map((seg, i) => renderRow(seg, i, i > 0))}
          </div>
        </div>
      )}
      {/* Always-visible recent segments */}
      {visibleSegments.map((seg, i) => {
        const globalIndex = hiddenSegments.length + i;
        return renderRow(seg, globalIndex, i > 0 || hasHidden);
      })}
      {/* Toggle button at the bottom */}
      {hasHidden && (
        <div className="border-t border-gray-50 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="w-full"
            tooltip={
              expanded
                ? "Zeigt wieder nur die letzten Zeiten."
                : "Zeigt alle Arbeits- und Pausenzeiten dieses Tages."
            }
          >
            {expanded
              ? "Weniger anzeigen"
              : `${hiddenSegments.length} weitere anzeigen`}
          </Button>
        </div>
      )}
    </>
  );
}

export function useOwnClock(today: string) {
  const interval = useLiveRefreshInterval(OPEN_MONTH_REFRESH_MS);
  const read = useSWRAuth(
    timeTrackingKeys.overview(today),
    () => readOwnClock(today),
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
      refreshInterval: interval,
    },
  );
  const { data, error, mutate } = read;
  const refresh = useOwnTimeRefresh();
  const toast = useToast();
  const loadError = useSwrLoadError(error, "deine Stempeluhr", mutate);
  const shiftError = useSwrLoadError(
    data?.shiftsUnavailable ? unavailable : undefined,
    "die Liste deiner Schichten",
    mutate,
  );
  const assignmentError = useSwrLoadError(
    data?.assignmentsUnavailable ? unavailable : undefined,
    "die Liste deiner Einsätze",
    mutate,
  );

  const stampAction = useOptimisticStamp(
    data?.session,
    (session) => {
      void mutate(
        (previous) =>
          previous ? { ...previous, session, breaks: [] } : undefined,
        {
          revalidate: false,
        },
      );
    },
    today,
  );
  const stamp = stampAction.stamp;
  const canStamp =
    data !== undefined && error === undefined && !stampAction.pending;
  const canStampRef = useRef(canStamp);
  useLayoutEffect(() => {
    canStampRef.current = canStamp;
  }, [canStamp]);
  const todayAbsence = data?.absence;

  const handleClosePendingCheckIn = useCallback(
    () => setPendingCheckIn(null),
    [],
  );
  const [pendingCheckIn, setPendingCheckIn] = useState<SessionStatus | null>(
    null,
  );

  // F9 deviation-reason prompt. Set when the backend rejects a stamp with
  // DEVIATION_REASON_REQUIRED_CODE because it falls outside the tolerance
  // window around the planned shift window. The modal collects the reason
  // and retries the same stamp; the backend stores it in the audit log.
  const [pendingDeviation, setPendingDeviation] = useState<{
    action: "check_in" | "check_out";
    status?: SessionStatus;
    plannedTime?: string;
    actualTime?: string;
    deviationMinutes?: string;
  } | null>(null);
  const [deviationReason, setDeviationReason] = useState("");
  const [deviationSubmitting, setDeviationSubmitting] = useState(false);
  const deviationErrors = useApiFormError();
  const confirmDeviationRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const clearDeviationErrors = deviationErrors.clear;
  const handleClosePendingDeviation = useCallback(() => {
    clearDeviationErrors();
    setPendingDeviation(null);
    setDeviationReason("");
  }, [clearDeviationErrors]);
  const { show: showActionError } = useApiErrorDisplay();

  // „Wiederholen“ im Fehler-Toast ruft die Aktion mit ihrem aktuellen Stand
  // auf, nicht mit dem vom Fehlerzeitpunkt.
  const stampRetryRef = useRef<{
    checkIn: (status: SessionStatus) => Promise<void>;
    checkOut: () => Promise<void>;
    startBreak: (durationMinutes: number) => Promise<void>;
    endBreak: () => Promise<void>;
  }>({
    checkIn: async () => undefined,
    checkOut: async () => undefined,
    startBreak: async () => undefined,
    endBreak: async () => undefined,
  });

  // Opens the F9 reason prompt when the backend wants a reason for a stamp
  // outside the planned window. Returns whether it did.
  const promptDeviationReason = useCallback(
    (
      err: unknown,
      action: "check_in" | "check_out",
      status?: SessionStatus,
    ) => {
      const details = readStampDeviation(err);
      if (details === null) return false;
      deviationErrors.clear();
      setDeviationReason("");
      setPendingDeviation({
        action,
        status,
        plannedTime: details?.planned_time,
        actualTime: details?.actual_time,
        deviationMinutes:
          details.deviation_minutes === undefined
            ? undefined
            : String(details.deviation_minutes),
      });
      return true;
    },
    [deviationErrors],
  );

  const executeCheckIn = useCallback(
    async (status: SessionStatus) => {
      if (!canStampRef.current) return;
      try {
        const outcome = await stamp(status);
        if (outcome.status === "discarded") return;
        if (outcome.status === "failed") throw outcome.error;
      } catch (err) {
        if (promptDeviationReason(err, "check_in", status)) return;
        // Too early is an expected answer, not a defect: the catalog text
        // names the planned start from the error details.
        if (
          !(err instanceof ApiError) ||
          err.code !== PLANNED_START_NOT_REACHED_CODE
        ) {
          logger.error("check_in_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await showActionError(err, {
          object: "die Arbeitszeit",
          retry: () => void stampRetryRef.current.checkIn(status),
        });
        return;
      }
      void refresh("time");
      toast.success("Du bist eingestempelt.");
    },
    [stamp, refresh, toast, showActionError, promptDeviationReason],
  );

  const handleCheckIn = useCallback(
    async (status: SessionStatus) => {
      if (!canStampRef.current) return;
      if (todayAbsence) {
        setPendingCheckIn(status);
        return;
      }
      await executeCheckIn(status);
    },
    [todayAbsence, executeCheckIn],
  );

  const handleCheckOut = useCallback(async () => {
    if (!canStampRef.current) return;
    try {
      const outcome = await stamp(null);
      if (outcome.status === "discarded") return;
      if (outcome.status === "failed") throw outcome.error;
    } catch (err) {
      if (promptDeviationReason(err, "check_out")) return;
      logger.error("check_out_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, {
        object: "die Arbeitszeit",
        retry: () => void stampRetryRef.current.checkOut(),
      });
      return;
    }
    void refresh("time");
    toast.success("Du bist ausgestempelt.");
  }, [stamp, refresh, toast, showActionError, promptDeviationReason]);

  // Retry the rejected stamp with the collected reason. The modal stays open
  // when the retry fails so the reason isn't lost; the error shows inside it.
  const confirmDeviationReason = useCallback(async () => {
    const pending = pendingDeviation;
    if (!pending || !canStampRef.current) return;
    const reason = deviationReason.trim();
    // The confirm button stays disabled until a reason is typed.
    if (!reason) return;

    setDeviationSubmitting(true);
    deviationErrors.clear();
    try {
      const outcome = await stamp(
        pending.action === "check_in" ? (pending.status ?? null) : null,
        reason,
      );
      if (outcome.status === "discarded") return;
      if (outcome.status === "failed") throw outcome.error;
    } catch (err) {
      logger.error("deviation_reason_submit_failed", {
        error: err instanceof Error ? err.message : String(err),
        action: pending.action,
      });
      await deviationErrors.show(err, {
        object: "die Arbeitszeit",
        retry: () => void confirmDeviationRef.current(),
      });
      return;
    } finally {
      setDeviationSubmitting(false);
    }
    toast.success(
      pending.action === "check_in"
        ? "Du bist eingestempelt."
        : "Du bist ausgestempelt.",
    );
    setPendingDeviation(null);
    setDeviationReason("");
    void refresh("time");
  }, [
    pendingDeviation,
    deviationReason,
    deviationErrors,
    stamp,
    refresh,
    toast,
  ]);

  const handleStartBreak = useCallback(
    async (durationMinutes: number) => {
      if (!canStampRef.current) return;
      try {
        await timeTrackingService.startBreak(durationMinutes);
      } catch (err) {
        logger.error("start_break_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        await showActionError(err, {
          object: "die Pause",
          retry: () => void stampRetryRef.current.startBreak(durationMinutes),
        });
        return;
      }
      await refresh("time");
    },
    [refresh, showActionError],
  );

  const handleEndBreak = useCallback(async () => {
    if (!canStampRef.current) return;
    try {
      await timeTrackingService.endBreak();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (
        code !== "workforce.no_active_break" &&
        code !== "workforce.no_active_session"
      ) {
        logger.error("end_break_failed", {
          error: err instanceof Error ? err.message : String(err),
          status: errorStatus(err),
        });
        await showActionError(err, {
          object: "die Pause",
          retry: () => void stampRetryRef.current.endBreak(),
        });
      } else {
        // The timer or another tab already ended this break.
        logger.warn("end_break_failed", {
          error: err instanceof Error ? err.message : String(err),
          status: errorStatus(err),
        });
      }
    }
    await refresh("time");
  }, [refresh, showActionError]);

  useLayoutEffect(() => {
    stampRetryRef.current = {
      checkIn: executeCheckIn,
      checkOut: handleCheckOut,
      startBreak: handleStartBreak,
      endBreak: handleEndBreak,
    };
    confirmDeviationRef.current = confirmDeviationReason;
  });

  const now = useCurrentTimestamp();
  const running = data?.session;
  const elapsed = (at: number) => {
    if (!running || !data || running.checkOutTime !== null)
      return { actual: 0, pause: 0 };
    const time = new Date(at);
    const dayStart = berlinDayStart(time);
    const start = new Date(running.checkInTime);
    const liveEnd = balanceSessionEnd(
      { date: running.date, checkIn: start, checkOut: null },
      time,
    );
    const pause = calcBreakMinutesSince(data.breaks, dayStart, liveEnd);
    const gross = calcGrossMinutes(true, running, time, liveEnd);
    return { actual: Math.max(0, gross - pause), pause };
  };
  const canAdvance =
    data &&
    running &&
    !error &&
    now > Date.parse(data.asOf) &&
    berlinTodayISO(new Date(now)) === today;
  const atRead = canAdvance
    ? elapsed(Date.parse(data.asOf))
    : { actual: 0, pause: 0 };
  const live = canAdvance ? elapsed(now) : atRead;
  const actualDelta = live.actual - atRead.actual;
  const pauseDelta = live.pause - atRead.pause;
  const metrics = data && !error ? clockMetrics(data, actualDelta) : undefined;
  const chart = useMemo(
    () =>
      data?.chart.map((point) =>
        point.date === today
          ? {
              ...point,
              actual_minutes: point.actual_minutes + actualDelta,
              break_minutes: point.break_minutes + pauseDelta,
            }
          : point,
      ) ?? [],
    [data, today, actualDelta, pauseDelta],
  );

  return {
    error,
    loadError,
    shiftError,
    assignmentError,
    data,
    currentSession: stampAction.data ?? null,
    saving: stampAction.pending,
    canStamp,
    metrics,
    chart,
    today,
    todayAbsence,
    handleCheckIn,
    handleCheckOut,
    handleStartBreak,
    handleEndBreak,
    pendingCheckIn,
    setPendingCheckIn,
    handleClosePendingCheckIn,
    executeCheckIn,
    pendingDeviation,
    deviationSubmitting,
    deviationReason,
    setDeviationReason,
    deviationErrors,
    confirmDeviationReason,
    handleClosePendingDeviation,
  };
}

type Clock = ReturnType<typeof useOwnClock>;

export function OwnClockCards({
  clock,
  onAddAbsence,
  setTargetHref,
}: {
  readonly clock: Clock;
  readonly onAddAbsence: () => void;
  readonly setTargetHref?: string;
}) {
  const { data, metrics } = clock;
  return (
    <>
      <LoadErrorAlert error={clock.loadError} />
      {data && (
        <>
          <LoadErrorAlert error={clock.shiftError} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <ClockInCard
              currentSession={clock.currentSession}
              breaks={
                clock.currentSession?.id === data.session?.id ? data.breaks : []
              }
              onCheckIn={clock.handleCheckIn}
              onCheckOut={clock.handleCheckOut}
              onStartBreak={clock.handleStartBreak}
              onEndBreak={clock.handleEndBreak}
              completedTodayMinutes={data.completedToday}
              laborDays={data.laborDays}
              onAddAbsence={onAddAbsence}
              metrics={metrics}
              plannedShifts={data.plannedShifts}
              cancelledShifts={data.cancelledShifts}
              stampingDisabled={!clock.canStamp}
              saving={clock.saving}
              setTargetHref={setTargetHref}
            />
            <WeekChart points={clock.chart} />
          </div>
          <TodayAssignmentsCard
            today={clock.today}
            assignments={data.assignments}
            failed={data.assignmentsUnavailable}
            error={clock.assignmentError}
          />
        </>
      )}
      {!data && !clock.error && <Skeleton className="h-48 w-full" />}
    </>
  );
}

export function ClockDialogs({ clock }: { readonly clock: Clock }) {
  const {
    pendingCheckIn,
    setPendingCheckIn,
    handleClosePendingCheckIn,
    executeCheckIn,
    pendingDeviation,
    deviationSubmitting,
    deviationReason,
    setDeviationReason,
    deviationErrors,
    confirmDeviationReason,
    handleClosePendingDeviation,
    todayAbsence,
  } = clock;
  return (
    <>
      {/* Check-in confirmation when absence exists */}
      <Modal
        isOpen={pendingCheckIn !== null}
        onClose={handleClosePendingCheckIn}
        title="Abwesenheit eingetragen"
        footer={
          <ModalActions
            onCancel={() => setPendingCheckIn(null)}
            onConfirm={() => {
              const status = pendingCheckIn;
              setPendingCheckIn(null);
              if (status) void executeCheckIn(status);
            }}
            confirmLabel="Trotzdem einstempeln"
            confirmTooltip="Stempelt dich trotz der Abwesenheit sofort ein."
          />
        }
      >
        <div className="py-4 text-center">
          <IconTile
            size="page"
            shape="round"
            tone="orange"
            className="mx-auto mb-4"
            icon={
              <svg
                className="text-moto-orange-strong"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            }
          />
          <p className="mt-2 text-gray-600">
            Für heute ist eine Abwesenheit eingetragen
            {todayAbsence ? ` (${absenceDisplayLabel(todayAbsence)})` : ""}.
            Trotzdem einstempeln?
          </p>
        </div>
      </Modal>

      {/* F9: stamping outside the tolerance window around the planned shift
              needs a reason that lands in the audit trail. */}
      <Modal
        isOpen={pendingDeviation !== null}
        onClose={handleClosePendingDeviation}
        title="Abweichung vom Dienstplan"
        footer={
          <ModalActions
            onCancel={handleClosePendingDeviation}
            cancelDisabled={deviationSubmitting}
            onConfirm={confirmDeviationReason}
            confirmDisabled={
              deviationSubmitting || deviationReason.trim() === ""
            }
            confirmDisabledReason={
              deviationSubmitting
                ? undefined
                : "Gib zuerst einen kurzen Grund an."
            }
            confirmTooltip={
              pendingDeviation?.action === "check_in"
                ? "Stempelt dich ein und speichert den Grund beim Eintrag."
                : "Stempelt dich aus und speichert den Grund beim Eintrag."
            }
            confirmLabel={
              pendingDeviation?.action === "check_in"
                ? "Mit Begründung einstempeln"
                : "Mit Begründung ausstempeln"
            }
          />
        }
      >
        <div className="py-2">
          <FormErrorAlert message={deviationErrors.error} className="mb-3" />
          <p className="text-sm text-gray-600">
            {pendingDeviation?.action === "check_in" ? (
              <>
                Du stempelst
                {pendingDeviation?.deviationMinutes ? (
                  <span className="font-medium text-gray-900">
                    {" "}
                    {pendingDeviation.deviationMinutes} Minuten
                  </span>
                ) : (
                  " deutlich"
                )}{" "}
                vor deinem geplanten Dienstbeginn
                {pendingDeviation?.plannedTime
                  ? ` (${pendingDeviation.plannedTime} Uhr)`
                  : ""}{" "}
                ein.
              </>
            ) : (
              <>
                Du stempelst
                {pendingDeviation?.deviationMinutes ? (
                  <span className="font-medium text-gray-900">
                    {" "}
                    {pendingDeviation.deviationMinutes} Minuten
                  </span>
                ) : (
                  " deutlich"
                )}{" "}
                nach deinem geplanten Dienstende
                {pendingDeviation?.plannedTime
                  ? ` (${pendingDeviation.plannedTime} Uhr)`
                  : ""}{" "}
                aus.
              </>
            )}{" "}
            Bitte gib einen kurzen Grund an. Er wird beim Eintrag gespeichert.
          </p>
          <div className="mt-4">
            <Textarea
              id="deviation-reason"
              name="reason"
              label="Grund"
              error={deviationErrors.fieldError("reason")}
              value={deviationReason}
              onChange={(e) => setDeviationReason(e.target.value)}
              disabled={deviationSubmitting}
              placeholder="z. B. Elterngespräch lief länger"
              rows={3}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
