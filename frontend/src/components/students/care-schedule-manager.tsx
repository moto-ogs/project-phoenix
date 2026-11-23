"use client";

import type * as studentsContract from "~/lib/contract/students.generated";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mutate } from "~/lib/swr/mutate";
import {
  ChevronLeft,
  ChevronRight,
  SquarePen,
  StickyNote,
  X,
} from "lucide-react";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import type { MotoConcept } from "~/lib/moto-concepts";
import { SectionCard } from "~/components/ui/section-card";
import { Button } from "~/components/ui/button";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import {
  type CareExceptionSubmit,
  CarePlanEditorModal,
} from "./care-plan-editor-modal";
import {
  type CarePlanWeeklyAdjustment,
  type CarePlanWeeklySubmit,
  CareWeeklyPlanEditForm,
} from "./care-weekly-plan-editor";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { isReadStateRefusal } from "~/lib/api-error";
import { useApiFormError, useApiLoadError } from "~/contexts/ToastContext";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import {
  type ArrivalData,
  createArrivalException,
  createArrivalNote,
  deleteArrivalException,
  deleteArrivalNote,
  fetchArrivalData,
  fetchArrivalSettings,
  updateArrivalException,
  updateArrivalNote,
  updateArrivalSchedules,
  type CareTimePresets,
  type SchoolPeriod,
} from "~/lib/student-arrival-api";
import {
  type ArrivalDayData,
  formatDateISO,
  formatShortDate,
  getDayData as getArrivalDayData,
  getWeekDaysForStart,
  getWeekStart,
  mergeSchedulesWithTemplate as mergeArrivalSchedulesWithTemplate,
  arrivalScheduleSourceLabel,
} from "~/lib/arrival-schedule-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { parseISODate, berlinTodayISO } from "~/lib/date-helpers";
import {
  createStudentPickupException,
  createStudentPickupNote,
  deleteStudentPickupException,
  deleteStudentDepartureException,
  setStudentDepartureException,
  deleteStudentPickupNote,
  fetchStudentPickupData,
  applyStudentPickupAdjustment,
  previewStudentPickupAdjustment,
  resetStudentPickupToOffering,
  updateStudentPickupException,
  updateStudentPickupNote,
} from "~/lib/pickup-schedule-api";
import {
  type AllowedDepartureModes,
  DEPARTURE_MODE_LABELS,
} from "~/lib/departure-plan";
import {
  type DayData as PickupDayData,
  type PickupData,
  type PickupSchedule,
  type PickupScheduleFormData,
  formatPickupTime,
  formatWeekRange,
  getDayData as getPickupDayData,
  mergeSchedulesWithTemplate as mergePickupSchedulesWithTemplate,
  pickupScheduleSourceLabel,
} from "~/lib/pickup-schedule-helpers";
import { createLogger } from "~/lib/logger";
import { mapRosterImpact, type RosterImpact } from "~/lib/roster-impact";
import { CarePlanImpact } from "~/components/students/care-plan-impact";
import type {
  StudentStatusDay,
  StudentStatusKind,
} from "~/lib/student-status-days-api";
import { careTimesConcept } from "~/lib/concepts/careTimes";
import { parentsConcept } from "~/lib/concepts/parents";
import { pickupConcept } from "~/lib/concepts/pickup";
import { classTripConcept } from "~/lib/concepts/classTrip";
import { sickConcept } from "~/lib/concepts/sick";
import { excusedConcept } from "~/lib/concepts/excused";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { Loading } from "~/components/ui/loading";
import { PlanningDayChip } from "~/components/ui/planning/planning-context-bar";
import { CARE_SCHEDULE_STALE_EVENT } from "~/lib/care-schedule-stale";
import { groupKeys } from "~/lib/swr/groups-keys";
import { InsetPanel } from "~/components/ui/inset-panel";

const logger = createLogger({ component: "CareScheduleManager" });
const statusDayDateFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const weekMonthFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});
const EMPTY_STATUS_DAYS: StudentStatusDay[] = [];

function weeklyArrivalPayload(data: CarePlanWeeklySubmit) {
  return data.arrivalSchedules.map((schedule) => ({
    weekday: schedule.weekday,
    expected_arrival: schedule.expected_arrival,
    notes: schedule.notes ?? null,
  }));
}

function weeklyNotesPayload(data: CarePlanWeeklySubmit) {
  return data.weekdayNotes ? { weekday_notes: [...data.weekdayNotes] } : {};
}

function weeklyPickupAdjustmentPayload(
  data: CarePlanWeeklySubmit,
  adjustment: CarePlanWeeklyAdjustment | undefined,
  effectiveFrom: string,
): studentsContract.pickupAdjustmentRequest & { effective_from: string } {
  return {
    schedules: data.pickupSchedules.map((schedule) => ({
      weekday: schedule.weekday,
      pickup_time: schedule.pickupTime,
      ...(schedule.notes ? { notes: schedule.notes } : {}),
    })),
    care_days: data.arrivalSchedules.map((schedule) => schedule.weekday),
    arrival_schedules: weeklyArrivalPayload(data),
    effective_from: adjustment?.effectiveFrom ?? effectiveFrom,
    ...(adjustment?.selections ? { selections: adjustment.selections } : {}),
  };
}

/**
 * Applies the weekly plan with a pickup change. The apply carries the weekly
 * plan token the editor started from and the weekday notes, so the whole plan
 * is written in one request or not at all (ADR 0311); the preview reads
 * neither.
 */
async function applyWeeklyPickupAdjustment(
  studentId: string,
  payload: studentsContract.pickupAdjustmentRequest & {
    effective_from: string;
  },
  plan: Pick<
    studentsContract.pickupAdjustmentRequest,
    "expected_version" | "weekday_notes"
  >,
  adjustment?: CarePlanWeeklyAdjustment,
  onRosterImpact?: (impact: RosterImpact | null) => void,
): Promise<studentsContract.pickupAdjustmentPreviewResponse | undefined> {
  let preview = adjustment?.preview;
  if (!preview) {
    preview = await previewStudentPickupAdjustment(studentId, payload);
    if (
      preview.resolution_required ||
      payload.effective_from > berlinTodayISO()
    ) {
      return preview;
    }
  }
  const applied = await applyStudentPickupAdjustment(studentId, {
    ...payload,
    ...plan,
    preview_token: preview.preview_token,
    resolution: adjustment?.resolution ?? "exception",
    ...(adjustment?.reason ? { reason: adjustment.reason } : {}),
    ...(adjustment?.completeWithdrawalConfirmed
      ? { complete_withdrawal_confirmed: true }
      : {}),
  });
  onRosterImpact?.(mapRosterImpact(applied?.roster_impact));
}

interface CareScheduleManagerProps {
  readonly studentId: string;
  readonly readOnly?: boolean;
  readonly weekendFollowsFriday?: boolean;
  readonly onUpdate?: () => void;
  readonly isSick?: boolean;
  readonly isExcused?: boolean;
  readonly statusDays?: StudentStatusDay[];
  readonly onDeleteStatusDay?: (statusDayId: string) => Promise<void>;
  readonly canDeleteStatusDay?: (day: StudentStatusDay) => boolean;
  readonly onVisibleDateRangeChange?: (from: string, to: string) => void;
  /** Die Abholarten aus dem Wochenplan, für „Regulär“ im Tagesdialog (#3945). */
  readonly weeklyDepartureModes?: AllowedDepartureModes;
}

interface CareDayData {
  readonly date: Date;
  readonly weekday: number;
  readonly isToday: boolean;
  readonly status: StudentStatusKind | null;
  readonly statusDay: StudentStatusDay | null;
  readonly arrival: ArrivalDayData;
  readonly pickup: PickupDayData;
}

type CareEventTone = "neutral" | "warning" | "purple";

interface CareBoundaryItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly marker: string | null;
  /**
   * Eine Abweichung, die jemand prüfen sollte, steht als Warnung statt als
   * graue Herkunft; `markerTitle` nennt dann beide Zeiten.
   */
  readonly markerTone?: "warning";
  readonly markerTitle?: string;
  /** Die reguläre Zeit, die eine Tagesausnahme ersetzt; steht durchgestrichen. */
  readonly replacedValue?: string;
  readonly icon: React.ReactNode;
  readonly onEdit?: () => void;
}

interface CareAppointmentItem {
  readonly key: string;
  readonly title: string;
  readonly timeRange: string;
  readonly tone: CareEventTone;
}

interface CareNoteItem {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

function invalidatePickupCaches() {
  // Best effort: the write itself succeeded and is on screen. A failed
  // revalidation of other lists only leaves them stale until their next load.
  try {
    mutate(
      (key) =>
        typeof key === "string" &&
        (key.includes(groupKeys.liveFamily) || key.includes("dashboard")),
    ).catch(() => undefined);
  } catch {
    return;
  }
}

function getStatusLabel(status: StudentStatusKind): string {
  if (status === "sick") return "Krank";
  if (status === "class_trip") return "Klassenfahrt";
  return "Entschuldigt";
}

const shortWeekdayLabels = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function shortWeekdayLabel(date: Date): string {
  return shortWeekdayLabels[date.getDay()] ?? "Tag";
}

function formatStatusDayDate(date: string): string {
  return statusDayDateFormatter.format(new Date(`${date}T00:00:00`));
}

function formatWeekMonth(days: CareDayData[]): string {
  const firstDay = days[0]?.date;
  const lastDay = days[days.length - 1]?.date;
  if (!firstDay) return "";
  if (!lastDay || firstDay.getMonth() === lastDay.getMonth()) {
    return weekMonthFormatter.format(firstDay);
  }
  const firstMonth = firstDay.toLocaleDateString("de-DE", { month: "long" });
  const lastMonth = lastDay.toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });
  return `${firstMonth} / ${lastMonth}`;
}

function getAbsenceStatus(
  arrival: ArrivalDayData,
  pickup: PickupDayData,
): StudentStatusKind | null {
  if (arrival.showSick || pickup.showSick) return "sick";
  if (arrival.showClassTrip || pickup.showClassTrip) return "class_trip";
  if (arrival.showExcused || pickup.showExcused) return "excused";
  return null;
}

// Wochenwechsel am Desktop und auf dem Handy erklären sich gleich (#6765).
const EMPTY_ARRIVAL_DATA: ArrivalData = {
  schedules: [],
  exceptions: [],
  notes: [],
};
const EMPTY_PICKUP_DATA: PickupData = {
  schedules: [],
  exceptions: [],
  notes: [],
};
const EMPTY_SCHOOL_PERIODS: readonly SchoolPeriod[] = [];
const CARE_WEEK_READER = {
  keepPreviousData: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
} as const;

const PREVIOUS_WEEK_HINT = "Zeigt die Betreuungszeiten der Woche davor.";
const NEXT_WEEK_HINT = "Zeigt die Betreuungszeiten der Woche danach.";
const CURRENT_WEEK_HINT = "Springt zurück zu den Zeiten dieser Woche.";

export function CareScheduleManager({
  studentId,
  readOnly = false,
  weekendFollowsFriday = false,
  onUpdate,
  isSick = false,
  isExcused = false,
  statusDays = EMPTY_STATUS_DAYS,
  onDeleteStatusDay,
  canDeleteStatusDay,
  onVisibleDateRangeChange,
  weeklyDepartureModes,
}: CareScheduleManagerProps) {
  // A failed reload after the user's own write (the shared reads report
  // their own load errors below).
  const refreshLoad = useApiLoadError();
  const { show: showRefreshError, clear: clearRefreshError } = refreshLoad;
  const deleteErrors = useApiFormError();
  // A weekly plan save refused because the plan changed since it was read:
  // the section shows the stored plan again with this message (ADR 0311).
  const planErrors = useApiFormError();
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  // The day exception slide-over. null = closed; { date } = opened from a day
  // card for that date.
  const [editorTarget, setEditorTarget] = useState<{ date: Date } | null>(null);
  // The section's Bearbeiten-Zustand (BAUARTEN-SPEC Bauart 2 Regel 3, #3119):
  // the weekly grid replaces the day cards in place, no overlay.
  const [isEditingWeekly, setIsEditingWeekly] = useState(false);
  // Was ein Angebotswechsel im Betreuungsplan bewirkt hat (#5102).
  const [rosterImpact, setRosterImpact] = useState<RosterImpact | null>(null);
  const [statusDayToDelete, setStatusDayToDelete] =
    useState<StudentStatusDay | null>(null);
  const [deletingStatusDayId, setDeletingStatusDayId] = useState<string | null>(
    null,
  );
  const todayISO = useBerlinToday();
  const currentWeekStartISO = useMemo(
    () => formatDateISO(getWeekStart(0, todayISO)),
    [todayISO],
  );
  const [weekStartISO, setWeekStartISO] = useState(currentWeekStartISO);
  const previousCurrentWeekStartISO = useRef(currentWeekStartISO);

  useLayoutEffect(() => {
    const previous = previousCurrentWeekStartISO.current;
    previousCurrentWeekStartISO.current = currentWeekStartISO;
    if (previous === currentWeekStartISO) return;
    setWeekStartISO((selected) =>
      selected === previous ? currentWeekStartISO : selected,
    );
  }, [currentWeekStartISO]);

  const weekDays = useMemo(
    () => getWeekDaysForStart(weekStartISO, weekendFollowsFriday, todayISO),
    [todayISO, weekStartISO, weekendFollowsFriday],
  );
  const weekRange = useMemo(
    () =>
      formatWeekRange(
        weekDays[0] ?? parseISODate(berlinTodayISO()),
        weekDays[weekDays.length - 1] ?? parseISODate(berlinTodayISO()),
      ),
    [weekDays],
  );
  const firstWeekDay = weekDays[0];
  const lastWeekDay = weekDays[weekDays.length - 1];
  const fromISO = firstWeekDay ? formatDateISO(firstWeekDay) : null;
  const toISO = lastWeekDay ? formatDateISO(lastWeekDay) : null;
  const weekKnown = fromISO !== null && toISO !== null;
  // Not under the "arrival-data-"/"pickup-data-" prefixes the global SSE hook
  // revalidates: the editors seed their drafts from these props, so a remote
  // change arrives through CARE_SCHEDULE_STALE_EVENT below and waits while one
  // is open. Focus and reconnect would replace the data the same way. Any
  // other revalidation (the header's „Aktualisieren“) still reaches these
  // readers; the shown week is held while an editor is open (`heldWeek`).
  const arrivalWeek = useSWRAuth(
    weekKnown ? tenantStudentKeys.arrivalWeek(studentId, fromISO, toISO) : null,
    () => fetchArrivalData(studentId, fromISO ?? "", toISO ?? ""),
    CARE_WEEK_READER,
  );
  const pickupWeek = useSWRAuth(
    weekKnown ? tenantStudentKeys.pickupWeek(studentId, fromISO, toISO) : null,
    () =>
      fetchStudentPickupData(studentId, {
        from: fromISO ?? "",
        to: toISO ?? "",
      }),
    CARE_WEEK_READER,
  );
  const arrivalSettings = useSWRAuth(
    tenantStudentKeys.arrivalSettings(),
    fetchArrivalSettings,
  );
  const { mutate: mutateArrivalWeek } = arrivalWeek;
  const { mutate: mutatePickupWeek } = pickupWeek;
  const { mutate: mutateArrivalSettings } = arrivalSettings;
  const reloadCareData = useCallback(
    () =>
      Promise.all([
        mutateArrivalWeek(),
        mutatePickupWeek(),
        mutateArrivalSettings(),
      ]),
    [mutateArrivalWeek, mutatePickupWeek, mutateArrivalSettings],
  );
  const load = useSwrResourceLoadError(
    [arrivalWeek, pickupWeek, arrivalSettings],
    "die Übersicht der Betreuungszeiten",
    () => {
      clearRefreshError();
      return reloadCareData();
    },
  );

  // Another week of the same child keeps the previous week on screen until
  // its own answer arrives; a different child never shows this one's plan.
  const [shownWeek, setShownWeek] = useState<{
    studentId: string;
    arrival: ArrivalData;
    pickup: PickupData;
  } | null>(null);
  if (
    arrivalWeek.data &&
    pickupWeek.data &&
    (shownWeek?.studentId !== studentId ||
      shownWeek.arrival !== arrivalWeek.data ||
      shownWeek.pickup !== pickupWeek.data)
  ) {
    setShownWeek({
      studentId,
      arrival: arrivalWeek.data,
      pickup: pickupWeek.data,
    });
  }
  const previousWeek = shownWeek?.studentId === studentId ? shownWeek : null;
  const loadedArrival =
    (pickupWeek.data ? arrivalWeek.data : undefined) ??
    previousWeek?.arrival ??
    EMPTY_ARRIVAL_DATA;
  const loadedPickup =
    (arrivalWeek.data ? pickupWeek.data : undefined) ??
    previousWeek?.pickup ??
    EMPTY_PICKUP_DATA;
  // An open editor holds an unsaved draft that was seeded from arrivalData /
  // pickupData: the exception slide-over re-reads its day whenever those props
  // change identity, and the weekly edit state measures its removals against
  // them, so writing them mid-edit silently changes what the user is editing.
  const isEditorOpen = editorTarget !== null || isEditingWeekly;
  // The week the open editor was seeded from. Only the user's own writes
  // replace it (`refreshCareData`); every other answer waits until the editor
  // closes, the same way deferred remote changes do.
  const [heldWeek, setHeldWeek] = useState<{
    arrival: ArrivalData;
    pickup: PickupData;
  } | null>(null);
  if (isEditorOpen && heldWeek === null) {
    setHeldWeek({ arrival: loadedArrival, pickup: loadedPickup });
  } else if (!isEditorOpen && heldWeek !== null) {
    setHeldWeek(null);
  }
  const arrivalData =
    (isEditorOpen ? heldWeek?.arrival : null) ?? loadedArrival;
  const pickupData = (isEditorOpen ? heldWeek?.pickup : null) ?? loadedPickup;
  const settings = arrivalSettings.data;
  const careDaysSource = settings?.careDaysSource ?? null;
  const schoolPeriods = settings?.schoolPeriods ?? EMPTY_SCHOOL_PERIODS;
  const timePresets = useMemo<CareTimePresets | undefined>(
    () =>
      settings
        ? {
            arrival: settings.defaultArrivalTime ?? "",
            pickup: settings.defaultPickupTime ?? "",
          }
        : undefined,
    [settings],
  );
  // A failed load stays loading until its error text is there, so no empty
  // week shows in its place.
  const isLoading = load.failure
    ? load.error === null
    : !arrivalWeek.data || !pickupWeek.data || !settings;

  // The edit state needs the care-days source and write access; without either
  // the section stays on its display, so the header never loses its controls.
  const isEditingWeeklyView =
    isEditingWeekly && careDaysSource !== null && !readOnly;

  useEffect(() => {
    const firstDay = weekDays[0];
    const lastDay = weekDays[weekDays.length - 1];
    if (!firstDay || !lastDay) return;
    onVisibleDateRangeChange?.(formatDateISO(firstDay), formatDateISO(lastDay));
  }, [onVisibleDateRangeChange, weekDays]);

  const isCurrentWeek = weekStartISO === currentWeekStartISO;

  function showCurrentWeek(): void {
    setWeekStartISO(currentWeekStartISO);
  }

  function moveWeek(direction: -1 | 1): void {
    setWeekStartISO((selected) => {
      const next = parseISODate(selected);
      next.setDate(next.getDate() + direction * 7);
      return formatDateISO(next);
    });
  }

  const statusDayByDate = useMemo(() => {
    const entries = new Map<string, StudentStatusDay>();
    for (const day of statusDays) {
      if (!day.cleared_at) {
        entries.set(day.date, day);
      }
    }
    return entries;
  }, [statusDays]);

  const statusByDate = useMemo(() => {
    const entries = new Map<string, StudentStatusKind>();
    for (const [date, day] of statusDayByDate) {
      entries.set(date, day.status);
    }
    return entries;
  }, [statusDayByDate]);

  const days = useMemo<CareDayData[]>(
    () =>
      weekDays.map((date) => {
        const dateKey = formatDateISO(date);
        const statusForDate = statusByDate.get(dateKey) ?? null;
        const arrival = getArrivalDayData(
          date,
          arrivalData.schedules,
          arrivalData.exceptions,
          arrivalData.notes,
          isSick,
          isExcused,
          statusForDate,
          weekendFollowsFriday,
          todayISO,
        );
        const pickup = getPickupDayData(
          date,
          pickupData.schedules,
          pickupData.exceptions,
          isSick,
          pickupData.notes,
          isExcused,
          statusForDate,
          pickupData.effectiveSchedules,
          weekendFollowsFriday,
          pickupData.departureExceptions,
          todayISO,
        );
        return {
          date,
          weekday: arrival.weekday,
          isToday: arrival.isToday || pickup.isToday,
          status: getAbsenceStatus(arrival, pickup),
          statusDay: statusDayByDate.get(dateKey) ?? null,
          arrival,
          pickup,
        };
      }),
    [
      weekDays,
      statusByDate,
      statusDayByDate,
      arrivalData.schedules,
      arrivalData.exceptions,
      arrivalData.notes,
      pickupData.schedules,
      pickupData.exceptions,
      pickupData.notes,
      pickupData.effectiveSchedules,
      pickupData.departureExceptions,
      isSick,
      isExcused,
      weekendFollowsFriday,
      todayISO,
    ],
  );
  const selectedMobileDay = useMemo(() => {
    const today = days.find((day) => day.isToday);
    if (!selectedDateKey) return today ?? days[0] ?? null;
    return (
      days.find((day) => formatDateISO(day.date) === selectedDateKey) ??
      today ??
      days[0] ??
      null
    );
  }, [days, selectedDateKey]);
  const weekMonth = useMemo(() => formatWeekMonth(days), [days]);

  useEffect(() => {
    if (days.length === 0) return;
    const selectedStillVisible = days.some(
      (day) => formatDateISO(day.date) === selectedDateKey,
    );
    if (selectedStillVisible) return;
    const today = days.find((day) => day.isToday);
    setSelectedDateKey(formatDateISO((today ?? days[0])!.date));
  }, [days, selectedDateKey]);

  // After the user's own write: put the fresh week into the cache and show a
  // failed reload (writes have already committed, so its retry only reloads
  // and never repeats the mutation).
  const refreshCareData = useCallback(async () => {
    if (fromISO !== null && toISO !== null) {
      try {
        const [arrival, pickup] = await Promise.all([
          mutateArrivalWeek(fetchArrivalData(studentId, fromISO, toISO), {
            revalidate: false,
          }),
          mutatePickupWeek(
            fetchStudentPickupData(studentId, { from: fromISO, to: toISO }),
            { revalidate: false },
          ),
        ]);
        // An editor still open sees its own write.
        if (arrival && pickup) {
          setHeldWeek((held) => (held ? { arrival, pickup } : held));
        }
        clearRefreshError();
      } catch (err) {
        logger.error("care_schedule_refresh_failed", {
          error: err instanceof Error ? err.message : String(err),
          student_id: studentId,
        });
        await showRefreshError(err, {
          object: "die Übersicht der Betreuungszeiten",
          retry: () => {
            clearRefreshError();
            void reloadCareData();
          },
        });
      }
    }
    onUpdate?.();
  }, [
    fromISO,
    toISO,
    studentId,
    mutateArrivalWeek,
    mutatePickupWeek,
    clearRefreshError,
    showRefreshError,
    reloadCareData,
    onUpdate,
  ]);

  // The read after a refused save (ADR 0311): it rejects when it fails, so
  // the refusal's message names the failed read instead of claiming the
  // stored plan is on screen.
  const reloadCareWeek = useCallback(async () => {
    if (fromISO === null || toISO === null) return;
    const [arrival, pickup] = await Promise.all([
      fetchArrivalData(studentId, fromISO, toISO),
      fetchStudentPickupData(studentId, { from: fromISO, to: toISO }),
    ]);
    await Promise.all([
      mutateArrivalWeek(arrival, { revalidate: false }),
      mutatePickupWeek(pickup, { revalidate: false }),
    ]);
  }, [fromISO, toISO, studentId, mutateArrivalWeek, mutatePickupWeek]);

  // Read through a ref inside the listener so opening/closing a modal does not
  // resubscribe it, and so the check uses the state at event time.
  const isEditorOpenRef = useRef(isEditorOpen);
  useEffect(() => {
    isEditorOpenRef.current = isEditorOpen;
  }, [isEditorOpen]);
  const hasDeferredRemoteRefresh = useRef(false);

  // Background refresh: a failure keeps the data on screen and is only
  // logged, the user did not ask for it. Written as a mutation, so an older
  // refresh that answers last cannot overwrite a newer one. Before the first
  // answer, a failed refresh hands over to a fresh read instead of leaving the
  // initial load it overtook discarded.
  const refreshFromRemote = useCallback(() => {
    if (fromISO === null || toISO === null) return;
    const onlyWithoutData = (current: unknown) => current === undefined;
    const logFailure = (err: unknown) => {
      logger.debug("care_schedule_remote_refresh_failed", {
        error: err instanceof Error ? err.message : String(err),
        student_id: studentId,
      });
    };
    mutateArrivalWeek(fetchArrivalData(studentId, fromISO, toISO), {
      revalidate: onlyWithoutData,
    }).catch(logFailure);
    mutatePickupWeek(
      fetchStudentPickupData(studentId, { from: fromISO, to: toISO }),
      { revalidate: onlyWithoutData },
    ).catch(logFailure);
  }, [fromISO, toISO, studentId, mutateArrivalWeek, mutatePickupWeek]);

  // React to REMOTE arrival/pickup changes, announced on this window event
  // instead of the global SSE invalidation (see the readers above). Re-fetch
  // quietly: no onUpdate, that would ripple a parent refresh for a change the
  // parent already heard about.
  //
  // While a modal is open the refresh is DEFERRED, not dropped: someone else's
  // edit must never cost this user their in-progress work, and the update is
  // still applied the moment the editor closes. Local saves keep refreshing
  // immediately — that path is the user's own action, and the day-override modal
  // needs to see its own write.
  useEffect(() => {
    const onStale = () => {
      if (isEditorOpenRef.current) {
        hasDeferredRemoteRefresh.current = true;
        return;
      }
      refreshFromRemote();
    };
    window.addEventListener(CARE_SCHEDULE_STALE_EVENT, onStale);
    return () => window.removeEventListener(CARE_SCHEDULE_STALE_EVENT, onStale);
  }, [refreshFromRemote]);

  // Drain a refresh that arrived while the user was editing.
  useEffect(() => {
    if (isEditorOpen || !hasDeferredRemoteRefresh.current) return;
    hasDeferredRemoteRefresh.current = false;
    refreshFromRemote();
  }, [isEditorOpen, refreshFromRemote]);

  const handleUpdateWeeklyPlan = useCallback(
    async (
      data: CarePlanWeeklySubmit,
      adjustment?: CarePlanWeeklyAdjustment,
    ) => {
      const pickupChanged = !sameWeeklyPickupSchedules(
        data.pickupSchedules,
        pickupData.schedules,
      );
      const careDaysChanged = !sameWeekdays(
        data.arrivalSchedules.map((schedule) => schedule.weekday),
        arrivalData.schedules.map((schedule) => schedule.weekday),
      );
      // The token of the plan the editor started from (`heldWeek`); after the
      // user's own save `refreshCareData` puts the saved plan and its token
      // there. The recurring weekday notes (#3369) travel in the same request:
      // they live beside the pickup rows, not on them, because a row would
      // mark the child as expected and these notes are for the days it is not.
      const expectedVersion = pickupData.weeklyPlanVersion ?? "";
      let refused = false;
      const showRefusal = (err: unknown) => {
        if (!isReadStateRefusal(err)) return;
        // The draft was made on a plan that changed since: back to the stored
        // plan with the message, which waits for that read.
        refused = true;
        setIsEditingWeekly(false);
        void planErrors.show(err, {
          object: "die Änderung am Wochenplan",
          reload: reloadCareWeek,
        });
      };
      const afterSave = async () => {
        if (refused) return;
        await refreshCareData();
        invalidatePickupCaches();
      };
      if (!pickupChanged && !careDaysChanged && !adjustment) {
        try {
          await updateArrivalSchedules(studentId, weeklyArrivalPayload(data), {
            expectedVersion,
            weekdayNotes: data.weekdayNotes,
          });
        } catch (err) {
          showRefusal(err);
          throw err;
        } finally {
          await afterSave();
        }
        return;
      }
      const today = berlinTodayISO();
      const weekStart = formatDateISO(
        weekDays[0] ?? parseISODate(berlinTodayISO()),
      );
      const basePayload = weeklyPickupAdjustmentPayload(
        data,
        adjustment,
        weekStart > today ? weekStart : today,
      );

      if (adjustment?.resolution === "offering" && !adjustment.confirm) {
        return previewStudentPickupAdjustment(studentId, basePayload);
      }

      try {
        // A returned preview means the plan still waits for a decision, so
        // nothing is written yet, the notes included.
        return await applyWeeklyPickupAdjustment(
          studentId,
          basePayload,
          { expected_version: expectedVersion, ...weeklyNotesPayload(data) },
          adjustment,
          setRosterImpact,
        );
      } catch (err) {
        showRefusal(err);
        throw err;
      } finally {
        await afterSave();
      }
    },
    [
      studentId,
      refreshCareData,
      reloadCareWeek,
      planErrors,
      pickupData.schedules,
      pickupData.weeklyPlanVersion,
      arrivalData.schedules,
      weekDays,
    ],
  );

  const editingDayDate = editorTarget?.date ?? null;

  const currentEditingArrivalDay = useMemo(() => {
    if (!editingDayDate) return null;
    const dateKey = formatDateISO(editingDayDate);
    return getArrivalDayData(
      editingDayDate,
      arrivalData.schedules,
      arrivalData.exceptions,
      arrivalData.notes,
      isSick,
      isExcused,
      statusByDate.get(dateKey) ?? null,
      weekendFollowsFriday,
      todayISO,
    );
  }, [
    editingDayDate,
    arrivalData,
    isSick,
    isExcused,
    statusByDate,
    weekendFollowsFriday,
    todayISO,
  ]);

  const currentEditingPickupDay = useMemo(() => {
    if (!editingDayDate) return null;
    const dateKey = formatDateISO(editingDayDate);
    return getPickupDayData(
      editingDayDate,
      pickupData.schedules,
      pickupData.exceptions,
      isSick,
      pickupData.notes,
      isExcused,
      statusByDate.get(dateKey) ?? null,
      pickupData.effectiveSchedules,
      weekendFollowsFriday,
      pickupData.departureExceptions,
      todayISO,
    );
  }, [
    editingDayDate,
    pickupData,
    isSick,
    isExcused,
    statusByDate,
    weekendFollowsFriday,
    todayISO,
  ]);

  /**
   * Write the exception for one day. "Regulär" means the day has no override,
   * so it maps to a delete; every other mode creates or updates the row. A leg
   * the editor reports as untouched (`null`) is skipped entirely — writing it
   * would reclaim a guardian-authored day from the parent for no reason.
   */
  const handleSubmitException = useCallback(
    async (payload: CareExceptionSubmit) => {
      const { date: dayISO, arrival, pickup, departure } = payload;
      let persistedChange = false;

      try {
        if (arrival) {
          const existing = arrivalData.exceptions.find(
            (exception) => exception.exceptionDate.slice(0, 10) === dayISO,
          );
          if (arrival.kind === "regular") {
            if (existing) {
              await deleteArrivalException(studentId, existing.id);
              persistedChange = true;
            }
          } else {
            const input = {
              exception_date: dayISO,
              expected_arrival: arrival.kind === "time" ? arrival.time : null,
              ...(arrival.kind === "none"
                ? { clear_expected_arrival: true }
                : {}),
              // An empty string deliberately clears an existing reason. A null
              // JSON value means "leave unchanged" to the patch endpoint.
              reason: existing && arrival.reason === null ? "" : arrival.reason,
            };
            if (existing) {
              await updateArrivalException(studentId, existing.id, input);
            } else {
              await createArrivalException(studentId, input);
            }
            persistedChange = true;
          }
        }

        if (pickup) {
          const existing = pickupData.exceptions.find(
            (exception) => exception.exceptionDate.slice(0, 10) === dayISO,
          );
          if (pickup.kind === "regular") {
            if (existing) {
              await deleteStudentPickupException(studentId, existing.id);
              persistedChange = true;
            }
          } else {
            const input = {
              exceptionDate: dayISO,
              pickupTime: pickup.kind === "time" ? pickup.time : undefined,
              ...(pickup.kind === "none" ? { clearPickupTime: true } : {}),
              // See the arrival leg above: only an existing row needs the
              // distinguishable empty value to clear its persisted reason.
              reason:
                existing && pickup.reason === null
                  ? ""
                  : (pickup.reason ?? undefined),
            };
            if (existing) {
              await updateStudentPickupException(studentId, existing.id, input);
            } else {
              await createStudentPickupException(studentId, input);
            }
            persistedChange = true;
          }
        }

        // Die Abholart des Tages (#3945) ist ein eigener Eintrag neben der
        // Abholzeit; „Wie im Wochenplan“ entfernt ihn.
        if (departure) {
          if (departure.kind === "regular") {
            await deleteStudentDepartureException(studentId, dayISO);
          } else {
            await setStudentDepartureException(studentId, dayISO, {
              departureMode: departure.mode,
              reason: departure.reason ?? undefined,
            });
          }
          persistedChange = true;
        }
      } catch (err) {
        // Arrival and pickup are separate endpoints, so a failed second request
        // can leave the first change persisted. Refresh before reporting the
        // error so the open editor reflects that server state.
        if (persistedChange) {
          try {
            await refreshCareData();
            invalidatePickupCaches();
          } catch (refreshErr) {
            logger.error("care_schedule_partial_exception_refresh_failed", {
              error:
                refreshErr instanceof Error
                  ? refreshErr.message
                  : String(refreshErr),
              student_id: studentId,
            });
          }
        }
        throw err;
      }

      await refreshCareData();
      invalidatePickupCaches();
    },
    [arrivalData.exceptions, pickupData.exceptions, studentId, refreshCareData],
  );

  const handleCreateArrivalNote = useCallback(
    async (date: string, content: string) => {
      await createArrivalNote(studentId, { note_date: date, content });
      await refreshCareData();
    },
    [studentId, refreshCareData],
  );
  // A note is changed as the open day editor read it (`heldWeek`). Refused
  // because it changed since: the editor gets the stored note, then the
  // message (ADR 0311).
  const refreshOnRefusal = useCallback(
    async (err: unknown) => {
      if (isReadStateRefusal(err)) await refreshCareData();
    },
    [refreshCareData],
  );
  const handleUpdateArrivalNote = useCallback(
    async (date: string, noteId: string, content: string) => {
      const read = arrivalData.notes.find((note) => note.id === noteId);
      try {
        await updateArrivalNote(
          studentId,
          noteId,
          { note_date: date, content },
          read?.version ?? "",
        );
      } catch (err) {
        await refreshOnRefusal(err);
        throw err;
      }
      await refreshCareData();
    },
    [studentId, refreshCareData, refreshOnRefusal, arrivalData.notes],
  );
  const handleDeleteArrivalNote = useCallback(
    async (noteId: string) => {
      await deleteArrivalNote(studentId, noteId);
      await refreshCareData();
    },
    [studentId, refreshCareData],
  );
  const handleCreatePickupNote = useCallback(
    async (date: string, content: string) => {
      await createStudentPickupNote(studentId, { noteDate: date, content });
      await refreshCareData();
      invalidatePickupCaches();
    },
    [studentId, refreshCareData],
  );
  const handleUpdatePickupNote = useCallback(
    async (date: string, noteId: string, content: string) => {
      const read = pickupData.notes.find((note) => note.id === noteId);
      try {
        await updateStudentPickupNote(
          studentId,
          noteId,
          { noteDate: date, content },
          read?.version ?? "",
        );
      } catch (err) {
        await refreshOnRefusal(err);
        throw err;
      }
      await refreshCareData();
      invalidatePickupCaches();
    },
    [studentId, refreshCareData, refreshOnRefusal, pickupData.notes],
  );
  const handleDeletePickupNote = useCallback(
    async (noteId: string) => {
      await deleteStudentPickupNote(studentId, noteId);
      await refreshCareData();
      invalidatePickupCaches();
    },
    [studentId, refreshCareData],
  );

  const handleResetPickupToOffering = useCallback(
    async (weekday: number, date: string) => {
      await resetStudentPickupToOffering(studentId, weekday, date);
      await refreshCareData();
      invalidatePickupCaches();
      onUpdate?.();
    },
    [studentId, refreshCareData, onUpdate],
  );

  const handleDeleteStatusDay = useCallback(
    async (statusDayId: string) => {
      if (!onDeleteStatusDay) return;
      setDeletingStatusDayId(statusDayId);
      try {
        await onDeleteStatusDay(statusDayId);
      } finally {
        setDeletingStatusDayId(null);
      }
    },
    [onDeleteStatusDay],
  );

  const handleConfirmDeleteStatusDay = useCallback(async () => {
    if (!statusDayToDelete) return;
    deleteErrors.clear();
    try {
      await handleDeleteStatusDay(statusDayToDelete.id);
      setStatusDayToDelete(null);
    } catch (err) {
      logger.error("care_schedule_status_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
        student_status_day_id: statusDayToDelete.id,
      });
      // Der Dialog bleibt offen und nennt den Grund; ein zweiter Klick auf
      // „Endgültig entfernen“ ist der neue Versuch.
      await deleteErrors.show(err, { object: "die geplante Abwesenheit" });
    }
  }, [deleteErrors, handleDeleteStatusDay, statusDayToDelete]);

  if (isLoading && arrivalData.schedules.length === 0) {
    return (
      <SectionCard>
        <Loading message="Betreuungszeiten werden geladen …" />
      </SectionCard>
    );
  }

  const loadError = load.error ?? refreshLoad.error;
  if (loadError) {
    return <LoadErrorAlert error={loadError} />;
  }

  return (
    <SectionCard
      className="@container"
      title="Betreuungszeiten"
      concept={careTimesConcept}
      description={weekRange}
      // Die Wochennavigation gehört zum Kopf, eine Linie über die volle Breite
      // trennt ihn vom Inhalt; beide bringen ihr eigenes Polster mit.
      flush
      bodyClassName=""
      actions={
        // While the section is in its edit state the week controls step
        // aside: the plan applies to every week, and the only ways out are
        // Speichern and Abbrechen at the bottom (Bauart 2 Regel 4).
        isEditingWeeklyView ? undefined : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              tooltip={CURRENT_WEEK_HINT}
              onClick={showCurrentWeek}
              disabled={isCurrentWeek}
              className="disabled:hidden"
            >
              Heute
            </Button>
            {/* Labelled on purpose, on every layout: an unlabelled pencil
                  here was indistinguishable from the per-day pencils below,
                  which is the confusion issue #893 reports. The word
                  „bearbeiten“ names the edit state it switches to. */}
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="gap-1.5"
                tooltip="Öffnet die festen Zeiten jeder Woche zum Ändern."
                onClick={() => {
                  setRosterImpact(null);
                  planErrors.clear();
                  setIsEditingWeekly(true);
                }}
              >
                <SquarePen className="h-4 w-4 shrink-0" aria-hidden="true" />
                Wochenplan bearbeiten
              </Button>
            ) : null}
          </div>
        )
      }
    >
      {isEditingWeeklyView ? null : (
        <div className="compact:px-4 relative mt-4 hidden items-center justify-between gap-2 px-5 max-sm:px-4 @4xl:flex">
          <div>
            <Button
              type="button"
              variant="surface"
              size="md"
              aria-label="Vorherige Woche"
              tooltip={PREVIOUS_WEEK_HINT}
              onClick={() => moveWeek(-1)}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Vorherige Woche</span>
            </Button>
          </div>
          {isCurrentWeek ? (
            <span className="absolute left-1/2 hidden h-9 -translate-x-1/2 items-center justify-center rounded-full bg-gray-100 px-3 text-sm font-semibold text-gray-600 sm:inline-flex">
              Aktuelle Woche
            </span>
          ) : (
            <Button
              type="button"
              variant="surface"
              size="md"
              tooltip={CURRENT_WEEK_HINT}
              onClick={showCurrentWeek}
              className="absolute left-1/2 hidden -translate-x-1/2 sm:inline-flex"
            >
              Zurück zur aktuellen Woche
            </Button>
          )}
          <div>
            <Button
              type="button"
              variant="surface"
              size="md"
              aria-label="Nächste Woche"
              tooltip={NEXT_WEEK_HINT}
              onClick={() => moveWeek(1)}
              className="gap-1.5"
            >
              <span className="hidden sm:inline">Nächste Woche</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      <div className="compact:mt-4 mt-5 border-t border-gray-100 p-3 max-sm:mt-4 sm:p-4">
        {!isEditingWeeklyView && planErrors.error ? (
          <FormErrorAlert message={planErrors.error} className="mb-3" />
        ) : null}
        {rosterImpact && !isEditingWeeklyView ? (
          <div className="mb-3">
            <CarePlanImpact impact={rosterImpact} studentId={studentId} />
          </div>
        ) : null}
        {isEditingWeeklyView && careDaysSource ? (
          // Mounted only while editing: the form seeds its draft once, so a
          // refresh of arrivalData / pickupData cannot overwrite the typing.
          <CareWeeklyPlanEditForm
            careDaysSource={careDaysSource}
            schoolPeriods={schoolPeriods}
            timePresets={timePresets}
            weeklyArrival={mergeArrivalSchedulesWithTemplate(
              arrivalData.schedules,
            )}
            weeklyPickup={mergePickupSchedulesWithTemplate(
              pickupData.schedules,
            )}
            weeklyNotes={pickupData.notes.flatMap((note) =>
              note.weekday
                ? [{ weekday: note.weekday, content: note.content }]
                : [],
            )}
            onSubmitWeekly={handleUpdateWeeklyPlan}
            onCancel={() => setIsEditingWeekly(false)}
            onSaved={() => setIsEditingWeekly(false)}
          />
        ) : (
          <>
            <div className="@4xl:hidden">
              <MobileCareWeek
                days={days}
                weekMonth={weekMonth}
                selectedDay={selectedMobileDay}
                readOnly={readOnly}
                deletingStatusDayId={deletingStatusDayId}
                onPreviousWeek={() => moveWeek(-1)}
                onNextWeek={() => moveWeek(1)}
                onSelectDay={(day) =>
                  setSelectedDateKey(formatDateISO(day.date))
                }
                onEditDay={(day) => setEditorTarget({ date: day })}
                onRequestDeleteStatusDay={setStatusDayToDelete}
                canDeleteStatusDay={canDeleteStatusDay}
              />
            </div>
            <div className="hidden @4xl:block">
              <div
                className={
                  days.length > 5
                    ? "grid grid-cols-7 gap-3"
                    : "grid grid-cols-5 gap-3"
                }
              >
                {days.map((day) => (
                  <CareDayCard
                    key={formatDateISO(day.date)}
                    day={day}
                    readOnly={readOnly}
                    onEditDay={(day) => setEditorTarget({ date: day })}
                    deletingStatusDayId={deletingStatusDayId}
                    onRequestDeleteStatusDay={setStatusDayToDelete}
                    canDeleteStatusDay={canDeleteStatusDay}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <CarePlanEditorModal
        isOpen={editorTarget !== null}
        onClose={() => setEditorTarget(null)}
        arrivalDay={currentEditingArrivalDay}
        pickupDay={currentEditingPickupDay}
        onSubmitException={handleSubmitException}
        weeklyDepartureModes={weeklyDepartureModes}
        onCreateArrivalNote={handleCreateArrivalNote}
        onUpdateArrivalNote={handleUpdateArrivalNote}
        onDeleteArrivalNote={handleDeleteArrivalNote}
        onCreatePickupNote={handleCreatePickupNote}
        onUpdatePickupNote={handleUpdatePickupNote}
        onDeletePickupNote={handleDeletePickupNote}
        onResetPickupToOffering={
          readOnly ? undefined : handleResetPickupToOffering
        }
      />
      <ConfirmDeleteModal
        isOpen={statusDayToDelete !== null}
        title="Geplanten Status entfernen"
        description={
          <p className="leading-6">
            {statusDayToDelete
              ? `Dieser Eintrag wird nur für ${formatStatusDayDate(
                  statusDayToDelete.date,
                )} entfernt. Andere geplante Tage bleiben bestehen.`
              : "Dieser geplante Status wird entfernt."}
          </p>
        }
        gate={{ mode: "twoStep", firstStepLabel: "Entfernen" }}
        confirmLabel="Endgültig entfernen"
        loadingLabel="Wird entfernt…"
        onConfirm={handleConfirmDeleteStatusDay}
        onClose={() => {
          deleteErrors.clear();
          setStatusDayToDelete(null);
        }}
        loading={
          statusDayToDelete !== null &&
          deletingStatusDayId === statusDayToDelete.id
        }
        error={deleteErrors.error?.message ?? ""}
      />
    </SectionCard>
  );
}

function MobileCareWeek({
  days,
  weekMonth,
  selectedDay,
  readOnly,
  deletingStatusDayId,
  onPreviousWeek,
  onNextWeek,
  onSelectDay,
  onEditDay,
  onRequestDeleteStatusDay,
  canDeleteStatusDay,
}: {
  readonly days: CareDayData[];
  readonly weekMonth: string;
  readonly selectedDay: CareDayData | null;
  readonly readOnly: boolean;
  readonly deletingStatusDayId: string | null;
  readonly onPreviousWeek: () => void;
  readonly onNextWeek: () => void;
  readonly onSelectDay: (day: CareDayData) => void;
  readonly onEditDay: (date: Date) => void;
  readonly onRequestDeleteStatusDay: (statusDay: StudentStatusDay) => void;
  readonly canDeleteStatusDay?: (day: StudentStatusDay) => boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2">
        <Button
          type="button"
          variant="surface"
          size="icon"
          aria-label="Vorherige Woche"
          tooltip={PREVIOUS_WEEK_HINT}
          onClick={onPreviousWeek}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="min-w-0 text-center text-lg font-semibold text-gray-800">
          {weekMonth}
        </div>
        <Button
          type="button"
          variant="surface"
          size="icon"
          aria-label="Nächste Woche"
          tooltip={NEXT_WEEK_HINT}
          onClick={onNextWeek}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div
        className={
          days.length > 5
            ? "grid grid-cols-7 gap-1.5"
            : "grid grid-cols-5 gap-1.5"
        }
      >
        {days.map((day) => (
          <MobileDayButton
            key={formatDateISO(day.date)}
            day={day}
            isSelected={
              selectedDay !== null &&
              formatDateISO(selectedDay.date) === formatDateISO(day.date)
            }
            onClick={() => onSelectDay(day)}
          />
        ))}
      </div>

      {selectedDay ? (
        <CareDayCard
          day={selectedDay}
          readOnly={readOnly}
          onEditDay={onEditDay}
          deletingStatusDayId={deletingStatusDayId}
          onRequestDeleteStatusDay={onRequestDeleteStatusDay}
          canDeleteStatusDay={canDeleteStatusDay}
          isMobileDetail
        />
      ) : null}
    </div>
  );
}

function MobileDayButton({
  day,
  isSelected,
  onClick,
}: {
  readonly day: CareDayData;
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  const statusLabel = day.status
    ? day.status === "class_trip"
      ? "Klasse"
      : getStatusLabel(day.status)
    : null;
  return (
    <PlanningDayChip
      stacked
      weekdayLabel={shortWeekdayLabel(day.date)}
      dateLabel={String(day.date.getDate())}
      selected={isSelected}
      onClick={onClick}
      statusLabel={statusLabel ?? undefined}
      today={day.isToday}
    />
  );
}

function CareDayCard({
  day,
  readOnly,
  onEditDay,
  deletingStatusDayId,
  onRequestDeleteStatusDay,
  canDeleteStatusDay,
  isMobileDetail = false,
}: {
  readonly day: CareDayData;
  readonly readOnly: boolean;
  readonly onEditDay: (date: Date) => void;
  readonly deletingStatusDayId: string | null;
  readonly onRequestDeleteStatusDay: (statusDay: StudentStatusDay) => void;
  readonly canDeleteStatusDay?: (day: StudentStatusDay) => boolean;
  readonly isMobileDetail?: boolean;
}) {
  const hasStatus = day.status !== null;
  const hasException =
    day.arrival.isException ||
    day.pickup.isException ||
    day.pickup.departureException !== undefined;
  // A guardian-sourced exception means a parent changed this day's pickup or
  // arrival time from the parents portal — flag it so staff don't mistake it
  // for their own edit at the door.
  const parentChanged =
    day.pickup.exception?.source === "guardian" ||
    day.arrival.exception?.source === "guardian";
  const boundaries = getCareBoundaries(day, {
    onEditArrival: () => onEditDay(day.date),
    onEditPickup: () => onEditDay(day.date),
  });
  const appointments = getCareAppointments();
  const notes = getCareNotes(day);

  return (
    <article
      className={`moto-content-surface flex flex-col rounded-xl border p-3 ${
        isMobileDetail ? "min-h-[236px]" : "min-h-[260px]"
      }`}
    >
      <div className="flex min-h-[52px] items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">
              {shortWeekdayLabel(day.date)}
            </span>
            {day.isToday ? (
              <span className="text-xs font-semibold text-gray-500">Heute</span>
            ) : null}
            {parentChanged ? (
              <StatusBadge
                label="Von Eltern"
                tone="blue"
                icon={<MotoConceptIcon concept={parentsConcept} size={14} />}
                compact
              />
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
            {day.isToday ? (
              <>
                <span className="bg-moto-orange-strong flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-semibold text-white">
                  {day.date.getDate()}
                </span>
                <span>.</span>
                <span>
                  {(day.date.getMonth() + 1).toString().padStart(2, "0")}.
                </span>
              </>
            ) : (
              formatShortDate(day.date)
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasStatus ? <StatusPill status={day.status} /> : null}
          {/* ONE labelled entry per day, top right where the eye lands. Two
              pencils per card that both opened the same dialog, plus a third
              nameless one for the week, is the confusion #893 reports. */}
          {!readOnly && !hasStatus ? (
            <Button
              type="button"
              variant="surface"
              size="compact"
              onClick={() => onEditDay(day.date)}
              tooltip={
                hasException
                  ? "Öffnet die Ausnahme dieses Tages zum Ändern."
                  : "Öffnet ein Fenster für eine Abweichung nur an diesem Tag."
              }
            >
              <SquarePen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Ausnahme
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col space-y-3">
        {hasStatus ? (
          <AbsencePlaceholder
            status={day.status}
            statusDay={day.statusDay}
            readOnly={
              day.statusDay
                ? !(canDeleteStatusDay?.(day.statusDay) ?? !readOnly)
                : true
            }
            isDeleting={deletingStatusDayId === day.statusDay?.id}
            onRequestDeleteStatusDay={onRequestDeleteStatusDay}
          />
        ) : (
          <CareBoundarySection
            boundaries={boundaries}
            onEdit={readOnly ? undefined : () => onEditDay(day.date)}
          />
        )}
        {appointments.length > 0 ? (
          <CareAppointmentSection appointments={appointments} />
        ) : null}
        {notes.length > 0 ? <CareNotesSection notes={notes} /> : null}
      </div>
    </article>
  );
}

function AbsencePlaceholder({
  status,
  statusDay,
  readOnly,
  isDeleting,
  onRequestDeleteStatusDay,
}: {
  readonly status: StudentStatusKind | null;
  readonly statusDay: StudentStatusDay | null;
  readonly readOnly: boolean;
  readonly isDeleting: boolean;
  readonly onRequestDeleteStatusDay: (statusDay: StudentStatusDay) => void;
}) {
  if (!status) return null;
  const concept: MotoConcept =
    status === "class_trip"
      ? classTripConcept
      : status === "sick"
        ? sickConcept
        : excusedConcept;
  const label =
    status === "class_trip"
      ? "Ganztägig Klassenfahrt"
      : status === "sick"
        ? "Ganztägig krank gemeldet"
        : "Ganztägig entschuldigt";
  const isInteractive = !readOnly && statusDay !== null;
  const content = (
    <div className="flex min-w-0 items-center gap-3 pr-8 text-left">
      <ConceptIconTile concept={concept} size="section" />
      <div className="min-w-0">
        <div className="text-xs text-gray-500">Status</div>
        <div className="text-sm leading-5 font-semibold text-gray-900">
          {isDeleting ? "Wird entfernt..." : label}
        </div>
      </div>
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={() => onRequestDeleteStatusDay(statusDay)}
        disabled={isDeleting}
        className="moto-content-surface moto-hover-elevated group relative flex min-h-[134px] w-full items-center rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-gray-600 disabled:cursor-not-allowed disabled:opacity-70"
        aria-label={`${label} entfernen`}
      >
        <span className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-md text-gray-500 transition-colors group-hover:bg-gray-100 group-hover:text-gray-700">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {content}
      </button>
    );
  }

  return (
    <div className="moto-content-surface flex min-h-[134px] items-center rounded-lg border p-3">
      {content}
    </div>
  );
}

function CareBoundarySection({
  boundaries,
  onEdit,
}: {
  readonly boundaries: CareBoundaryItem[];
  /** undefined = read-only; the whole block opens the day editor otherwise. */
  readonly onEdit?: () => void;
}) {
  const rows = (
    <div className="flex flex-1 flex-col divide-y divide-gray-100">
      {boundaries.map((boundary) => (
        <CareBoundaryRow key={boundary.key} boundary={boundary} />
      ))}
    </div>
  );

  // The block is ONE target rather than one per line: tapping a time still
  // opens the editor, but the card shows a single pencil (in its header)
  // instead of one per row.
  if (onEdit) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-[134px] w-full flex-col rounded-lg border border-gray-100 bg-gray-50 text-left transition-colors hover:bg-gray-100/70 focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:outline-none"
      >
        {rows}
      </button>
    );
  }

  return (
    <div className="flex min-h-[134px] flex-col rounded-lg border border-gray-100 bg-gray-50">
      {rows}
    </div>
  );
}

function CareBoundaryRow({
  boundary,
}: {
  readonly boundary: CareBoundaryItem;
}) {
  return (
    <div className="flex flex-1 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {/* Neutrale Kachel, wie bei AbsencePlaceholder in derselben Datei:
            MotoConceptIcon setzt seine Farbe selbst aus dem Konzept und
            ueberschreibt ein geerbtes color. Eine getoente Kachel ergab
            deshalb eine indigofarbene Uhr auf Gruen und ein petrolfarbenes
            Auto auf Orange. */}
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 shadow-sm">
          {boundary.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-500">{boundary.label}</div>
          {/* Flex-wrapped rather than inline: the badge is taller than the 20px
              line box, so as an inline element it painted over the next line
              whenever the value wrapped ("Keine Abholung" in a day column). */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 font-semibold text-gray-900">
            <span className="min-w-0 break-words">{boundary.value}</span>
            {boundary.replacedValue ? (
              <span className="font-normal text-gray-500">
                <span className="sr-only">statt </span>
                <s>{boundary.replacedValue}</s>
              </span>
            ) : null}
            {boundary.marker && boundary.markerTone === "warning" ? (
              <StatusBadge
                tone="warning"
                compact
                label={boundary.marker}
                title={boundary.markerTitle}
              />
            ) : boundary.marker ? (
              <span
                className="max-w-full shrink-0 truncate rounded-full bg-white px-1.5 py-0.5 text-sm font-semibold text-gray-500 shadow-sm"
                title={boundary.marker}
              >
                {boundary.marker}
              </span>
            ) : null}
          </div>
          {boundary.description ? (
            <div className="mt-0.5 text-xs leading-5 text-gray-500">
              {boundary.description}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CareAppointmentSection({
  appointments,
}: {
  readonly appointments: CareAppointmentItem[];
}) {
  return (
    <div className="space-y-1.5">
      {appointments.map((appointment) => (
        <InsetPanel key={appointment.key} tone="white" padding="compact">
          <div className="text-sm font-semibold text-gray-500">
            {appointment.timeRange}
          </div>
          <div className="text-sm font-semibold text-gray-900">
            {appointment.title}
          </div>
        </InsetPanel>
      ))}
    </div>
  );
}

function CareNotesSection({ notes }: { readonly notes: CareNoteItem[] }) {
  return (
    <div className="space-y-1.5 border-t border-gray-100 pt-3">
      {notes.map((note) => (
        <div
          key={note.key}
          className="flex min-w-0 items-start gap-2 text-xs leading-5 text-gray-500"
        >
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
          <span className="font-semibold text-gray-600">{note.label}:</span>
          <span className="min-w-0 break-words">{note.value}</span>
        </div>
      ))}
    </div>
  );
}

// Muss dieselbe Dreiteilung tragen wie AbsencePlaceholder in derselben Karte,
// sonst zeigt ein Klassenfahrt-Tag eine lila Pille ueber einem cyanfarbenen
// Icon und ist ausserdem nicht von "Entschuldigt" zu unterscheiden.
const STATUS_PILL_TONES: Record<StudentStatusKind, StatusBadgeTone> = {
  sick: "red",
  class_trip: "cyan",
  excused: "purple",
};

function StatusPill({ status }: { readonly status: StudentStatusKind }) {
  return (
    <StatusBadge
      label={getStatusLabel(status)}
      tone={STATUS_PILL_TONES[status]}
      compact
    />
  );
}

function getArrivalValue(day: ArrivalDayData): string {
  if (day.isAbsent) return "Kommt nicht";
  return day.effectiveTime ?? "Nicht geplant";
}

function getPickupValue(day: PickupDayData): string {
  if (day.isException && !day.effectiveTime) return "Keine Abholung";
  return day.effectiveTime
    ? formatPickupTime(day.effectiveTime)
    : "Nicht geplant";
}

function getArrivalMarker(day: ArrivalDayData): string | null {
  if (day.isException) return "Ausnahme";
  return arrivalScheduleSourceLabel(day.baseSchedule);
}

/**
 * Die gebuchte Abholzeit, wenn eine von Hand eingetragene Zeit sie an diesem
 * Tag verdeckt. Die eingetragene Zeit gewinnt, deshalb muss die Abweichung
 * in der Woche auffallen, nicht nur im Tageseditor (#5618).
 */
function hiddenBookedPickup(day: PickupDayData): string | null {
  if (
    day.isException ||
    !day.baseSchedule ||
    day.baseSchedule.source === "care_offering" ||
    !day.offeringSchedule ||
    day.baseSchedule.pickupTime === day.offeringSchedule.pickupTime
  ) {
    return null;
  }
  return formatPickupTime(day.offeringSchedule.pickupTime);
}

/**
 * Die reguläre Abholzeit, die eine Tagesausnahme ersetzt (#7707). Der Tag
 * fällt so in der Woche auf, auch nachdem das Banner in der Kinderakte
 * geschlossen ist.
 */
function replacedRegularPickup(day: PickupDayData): string | undefined {
  if (!day.baseSchedule?.pickupTime) return undefined;
  const regular = formatPickupTime(day.baseSchedule.pickupTime);
  return day.effectiveTime && formatPickupTime(day.effectiveTime) === regular
    ? undefined
    : regular;
}

function pickupBoundary(day: PickupDayData) {
  const booked = hiddenBookedPickup(day);
  if (day.isException) {
    return {
      description: getPickupDescription(day),
      marker: "Ausnahme",
      markerTone: "warning" as const,
      replacedValue: replacedRegularPickup(day),
    };
  }
  if (booked === null || !day.baseSchedule) {
    return {
      description: getPickupDescription(day),
      marker: pickupScheduleSourceLabel(day.baseSchedule),
    };
  }
  const offering = day.offeringSchedule?.careOfferingName;
  return {
    description: "Von Hand eingetragen, gilt statt der gebuchten Zeit.",
    marker: `Gebucht ${booked} Uhr`,
    markerTone: "warning" as const,
    markerTitle: `Von Hand eingetragen: ${formatPickupTime(day.baseSchedule.pickupTime)} Uhr. Gebucht${
      offering ? ` im Angebot „${offering}“` : ""
    }: ${booked} Uhr.`,
  };
}

function sameWeekdays(
  left: readonly number[],
  right: readonly number[],
): boolean {
  const normalize = (values: readonly number[]) =>
    [...new Set(values)].sort((a, b) => a - b).join(",");
  return normalize(left) === normalize(right);
}

function sameWeeklyPickupSchedules(
  next: readonly PickupScheduleFormData[],
  current: readonly PickupSchedule[],
): boolean {
  const normalize = (
    rows: ReadonlyArray<{
      weekday: number;
      pickupTime: string;
      notes?: string;
    }>,
  ) =>
    rows
      .filter((row) => row.pickupTime.trim() !== "")
      .map((row) => ({
        weekday: row.weekday,
        pickupTime: formatPickupTime(row.pickupTime),
        notes: row.notes?.trim() ?? "",
      }))
      .sort((a, b) => a.weekday - b.weekday);
  return JSON.stringify(normalize(next)) === JSON.stringify(normalize(current));
}

function getArrivalDescription(day: ArrivalDayData): string | undefined {
  if (!day.isException) return undefined;
  return day.effectiveReason
    ? `Grund: ${day.effectiveReason}`
    : "Tagesänderung";
}

function getPickupDescription(day: PickupDayData): string | undefined {
  if (!day.isException) return undefined;
  return day.effectiveNotes ? `Grund: ${day.effectiveNotes}` : "Tagesänderung";
}

function getCareBoundaries(
  day: CareDayData,
  actions: {
    readonly onEditArrival: () => void;
    readonly onEditPickup: () => void;
  },
): CareBoundaryItem[] {
  return [
    {
      key: "arrival",
      label: "Ankunft",
      value: getArrivalValue(day.arrival),
      description: getArrivalDescription(day.arrival),
      marker: getArrivalMarker(day.arrival),
      icon: <MotoConceptIcon concept={careTimesConcept} size={18} />,
      onEdit: actions.onEditArrival,
    },
    {
      key: "pickup",
      label: "Abholung",
      value: getPickupValue(day.pickup),
      ...pickupBoundary(day.pickup),
      icon: <MotoConceptIcon concept={pickupConcept} size={18} />,
      onEdit: actions.onEditPickup,
    },
    // Die Abholart erscheint nur an einem Tag, an dem sie vom Wochenplan
    // abweicht (#3945); sonst steht sie in den Stammdaten des Kindes.
    ...(day.pickup.departureException
      ? [
          {
            key: "departure",
            label: "Abholart",
            value:
              DEPARTURE_MODE_LABELS[
                day.pickup.departureException.departureMode
              ],
            description: day.pickup.departureException.reason
              ? `Grund: ${day.pickup.departureException.reason}`
              : "Nur an diesem Tag",
            marker: "Ausnahme",
            icon: <MotoConceptIcon concept={pickupConcept} size={18} />,
            onEdit: actions.onEditPickup,
          },
        ]
      : []),
  ];
}

function getCareAppointments(): CareAppointmentItem[] {
  return [];
}

function getCareNotes(day: CareDayData): CareNoteItem[] {
  const notes: CareNoteItem[] = [];
  const arrivalNotes = getArrivalDisplayNotes(day.arrival);
  const pickupNotes = getPickupDisplayNotes(day.pickup);
  if (arrivalNotes.length > 0) {
    notes.push({
      key: "arrival-notes",
      label: "Ankunft",
      value: arrivalNotes.join(", "),
    });
  }
  if (pickupNotes.length > 0) {
    notes.push({
      key: "pickup-notes",
      // Without a pickup time the note belongs to the day (#3369).
      label: day.pickup.effectiveTime ? "Abholung" : "Notiz",
      value: pickupNotes.join(", "),
    });
  }
  return notes;
}

function getArrivalDisplayNotes(day: ArrivalDayData): string[] {
  return [
    day.baseSchedule?.notes ?? null,
    ...day.notes.map((note) => note.content),
  ].filter((note): note is string => !!note);
}

function getPickupDisplayNotes(day: PickupDayData): string[] {
  return [
    day.baseSchedule?.notes ?? null,
    day.weekdayNote?.content ?? null,
    ...day.notes.map((note) => note.content),
  ].filter((note): note is string => !!note);
}
