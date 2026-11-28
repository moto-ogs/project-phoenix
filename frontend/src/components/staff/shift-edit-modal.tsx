"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Alert } from "~/components/ui/alert";
import { FieldLabel } from "~/components/ui/field-label";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceModal } from "~/components/ui/choice-modal";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { DatePicker } from "~/components/ui/date-picker";
import { Input } from "~/components/ui/input";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  SlideOver,
  SlideOverBody,
  SlideOverContent,
  SlideOverFooter,
  SlideOverHeader,
  SlideOverTitle,
} from "~/components/ui/slide-over";
import {
  type FormModalOperation,
  useFormModalPending,
} from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { calendarPeriodService } from "~/lib/calendar-period-api";
import {
  findPeriodForDate,
  weekPatternForDate,
  type CalendarPeriod,
} from "~/lib/calendar-period-helpers";
import {
  berlinTodayISO,
  formatDate,
  parseISODate,
  toISODate,
} from "~/lib/date-helpers";
import {
  readStateWaitReason,
  useReadDraftForm,
  useReadDraftLoadError,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { databaseKeys } from "~/lib/swr/portal-keys";
import {
  copyStableObjectKey,
  getStableObjectKey,
} from "~/lib/stable-object-key";
import {
  staffShiftService,
  staffShiftSeriesService,
  type SeriesResult,
  type SeriesRule,
} from "~/lib/shift-api";
import {
  parseBreakMinutes,
  shiftBreakMaxMinutes,
  shiftDurationMinutes,
  type StaffScheduleStaff,
  type StaffShift,
} from "~/lib/shift-helpers";
import {
  isShiftTypeOffered,
  shiftTypeOptionLabel,
  type ShiftType,
} from "~/lib/shift-type-helpers";
import {
  latestISODate,
  materializedRecurrenceDates,
} from "~/lib/timetable-helpers";

import {
  dayBeforeISO,
  useShiftEditDraft,
  type ReplacementRow,
  type SeriesEditorFields,
  type ShiftFields,
  type StoredShift,
} from "./shift-edit-draft";
import {
  formatWeekdays,
  RhythmPicker,
  WeekdayPicker,
} from "./shift-recurrence-fields";
import { useWorkingTimeConfirmation } from "./working-time-confirmation";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionLabel } from "~/components/ui/section-label";

const logger = createLogger({ component: "ShiftEditModal" });
// Stable empty default so the optional staffOptions prop does not create a new
// array reference each render (oxlint react/no-object-type-as-default-prop).
const EMPTY_STAFF_OPTIONS: readonly StaffScheduleStaff[] = [];
/** Both reads after one refusal; rejects when either fails. */
function readBoth(
  first: (() => Promise<unknown>) | undefined,
  second: () => Promise<unknown>,
): () => Promise<unknown> {
  return () => Promise.all([first?.(), second()]);
}

/** No reload given: a refused save stays locked with this load error. */
function reloadShiftUnavailable(): Promise<never> {
  return Promise.reject(new Error("the stored shift cannot be read again"));
}

// Stable empty default for the optional existingReplacements prop (same
// rationale as EMPTY_STAFF_OPTIONS).
const EMPTY_REPLACEMENTS: readonly StaffShift[] = [];
const WEEKDAY_REQUIRED_MESSAGE = "Bitte wähle mindestens einen Wochentag aus.";
// Stable empty default while the series rule is not read yet.
const NO_WEEKDAYS: readonly number[] = [];

// Create/edit modal for one planned shift (Dienstplan). Times are plain
// "HH:MM" strings end-to-end — no Date/ISO conversion, which sidesteps the
// timezone pitfalls of the session edit modal.
export type ShiftEditMode = "create" | "edit";

interface ShiftEditModalProps {
  readonly mode: ShiftEditMode;
  readonly staffId: string;
  readonly staffName: string;
  /** Calendar day as "YYYY-MM-DD" */
  readonly date: string;
  readonly shift: StaffShift | null;
  /** All shift types (Schichtarten); the picker offers active ones plus the
   *  one currently attached to this shift (even if inactive). */
  readonly shiftTypes: readonly ShiftType[];
  /** All staff, used to pick a replacement person when a shift is left open
   *  (#1841). The edited shift's own staff member is excluded automatically.
   *  Optional so callers that never left a gap open (and tests) can omit it. */
  readonly staffOptions?: readonly StaffScheduleStaff[];
  /** Replacement shifts already covering this (cancelled) shift — the rows whose
   *  originShiftId is this shift's id (#1841). Passed in so reopening the modal
   *  shows the existing covers instead of an empty set; without them, saving any
   *  edit to an already-cancelled shift would send an empty replacement set and
   *  the backend would delete every cover. Optional / empty for create and for
   *  never-cancelled shifts. */
  readonly existingReplacements?: readonly StaffShift[];
  /** Vorbelegte Zeiten für eine neue Schicht ("HH:MM"), z. B. aus der im
   *  Viertelstunden-Raster aufgezogenen Spanne (#3818). Nur bei `create`. */
  readonly initialStartTime?: string;
  readonly initialEndTime?: string;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  /**
   * Reads the stored shift again after a refused save and hands it in as
   * `shift` and `existingReplacements`; answers it (nothing when the shift
   * is gone) and rejects when the read fails (ADR 0311). Without it a
   * refusal keeps saving locked with the load error.
   */
  readonly reloadShift?: () => Promise<StoredShift | undefined | void>;
}

export function ShiftEditModal({
  mode,
  staffId,
  staffName,
  date,
  shift,
  shiftTypes,
  staffOptions = EMPTY_STAFF_OPTIONS,
  existingReplacements = EMPTY_REPLACEMENTS,
  initialStartTime,
  initialEndTime,
  onClose,
  onSaved,
  reloadShift = reloadShiftUnavailable,
}: ShiftEditModalProps) {
  const seedTimes = useMemo(() => {
    if (shift) {
      return {
        startTime: shift.startTime,
        endTime: shift.endTime,
        breakMinutes: shift.breakMinutes,
        shiftTypeId: shift.shiftTypeId ?? "",
      };
    }
    if (initialStartTime && initialEndTime) {
      // Aufgezogene Spanne aus dem Viertelstunden-Raster: die Pause folgt der
      // Länge (mehr als sechs Stunden: 30 Minuten), damit ein kurzer Block wie
      // eine Randstunde nicht mit einer Pause startet, die länger ist als er.
      const span = shiftDurationMinutes(initialStartTime, initialEndTime) ?? 0;
      return {
        startTime: initialStartTime,
        endTime: initialEndTime,
        breakMinutes: span > 360 ? 30 : 0,
        shiftTypeId: "",
      };
    }
    return {
      startTime: "08:00",
      endTime: "16:00",
      breakMinutes: 30,
      shiftTypeId: "",
    };
  }, [shift, initialStartTime, initialEndTime]);
  const seed = useMemo<ShiftFields>(
    () => ({
      startTime: seedTimes.startTime,
      endTime: seedTimes.endTime,
      breakMinutesStr: String(seedTimes.breakMinutes),
      shiftTypeId: seedTimes.shiftTypeId,
      changeReason: "",
      cancelled: false,
      replacements: [],
    }),
    [seedTimes],
  );

  // The shift and its covers as the planner opened them (ADR 0311): the
  // day's draft rests on them, and an edit or a cancellation sends their
  // versions; the server refuses a shift or a cover set changed since.
  // After a refusal `reloadShift` hands in the stored shift, the draft shows
  // it, and saving waits for that read.
  const stored = useMemo<StoredShift | null>(
    () =>
      mode === "edit" && shift ? { shift, covers: existingReplacements } : null,
    [mode, shift, existingReplacements],
  );
  const drafts = useShiftEditDraft({
    opening: stored
      ? `edit:${stored.shift.id}`
      : `create:${staffId}:${date}:${seed.startTime}-${seed.endTime}`,
    stored,
    seed,
    reloadShift,
  });
  const { day, series: seriesRead, seriesEditOpen, leaveSeriesEdit } = drafts;
  // The times, break and type on screen: the day's, or the rule's while the
  // series editor is open.
  const { startTime, endTime, breakMinutesStr, shiftTypeId } = drafts.fields;
  const { setFields } = drafts;
  const setStartTime = (value: string) => setFields({ startTime: value });
  const setEndTime = (value: string) => setFields({ endTime: value });
  const setBreakMinutesStr = (value: string) =>
    setFields({ breakMinutesStr: value });
  const setShiftTypeId = (value: string) => setFields({ shiftTypeId: value });
  // Flexible daily changes (#1841): optional reason, "Ausfall" (leave the gap
  // open), and one or more replacements that split the gap across people.
  const { changeReason, cancelled, replacements } = day.draft ?? seed;
  const setDayFields = (patch: Partial<ShiftFields>) =>
    day.setDraft((current) => ({ ...current, ...patch }));
  const setReplacements = (
    next: (rows: readonly ReplacementRow[]) => readonly ReplacementRow[],
  ) =>
    day.setDraft((current) => ({
      ...current,
      replacements: next(current.replacements),
    }));
  // The series editor's own fields, on the rule behind the shift (#2028).
  const seriesFields = seriesRead.draft;
  const seriesWeekdays = seriesFields?.weekdays ?? NO_WEEKDAYS;
  const seriesBiweekly = seriesFields?.biweekly ?? false;
  const seriesAbPattern = seriesFields?.abPattern ?? 1;
  // Inclusive "Gültig bis" as shown in the picker; the stored valid_until is
  // exclusive (converted on load and on save).
  const seriesValidUntil = seriesFields?.validUntil ?? "";
  const seriesIncludeSchoolBreaks = seriesFields?.includeSchoolBreaks ?? false;
  const setSeriesFields = (patch: Partial<SeriesEditorFields>) =>
    seriesRead.setDraft((current) => ({ ...current, ...patch }));
  // Every write runs through the panel's pending contract (#6593), also
  // the ones started from the delete confirmation or the scope question
  // while the panel is hidden behind them. A late answer must not close or
  // fill the dialog for another shift.
  const write = useFormModalPending(true, shift?.id ?? `${staffId}:${date}`);
  // Which write runs: the save buttons and the scope question show a save,
  // the delete confirmation a delete.
  const [runningWrite, setRunningWrite] = useState<"save" | "delete">("save");
  const isSaving = write.pending && runningWrite === "save";
  const isDeleting = write.pending && runningWrite === "delete";
  const runWrite = (
    kind: "save" | "delete",
    task: (op: FormModalOperation) => Promise<void>,
  ) =>
    write.run((op) => {
      setRunningWrite(kind);
      return task(op);
    });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  // Rückfrage bei einem Verstoß gegen eine Arbeitszeitregel (#4708).
  const workingTime = useWorkingTimeConfirmation();
  const { reset: resetWorkingTime } = workingTime;
  const deleteErrors = useApiFormError();
  // „Wiederholen“ sendet den aktuellen Stand, nicht den vom Fehlerzeitpunkt.
  const latestSaveRef = useRef<() => void>(() => undefined);
  const latestDeleteRef = useRef<() => void>(() => undefined);
  // Which scope the last series save chose, so a retry repeats it.
  const scopeChoiceRef = useRef<"single" | "following" | null>(null);

  // A replacement shift itself is never cancelled or re-covered from here.
  const isReplacementRow = shift?.originShiftId != null;

  // Wiederholung (#1889): create-only series section.
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [chosenPeriodId, setPeriodId] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [biweekly, setBiweekly] = useState(false);
  const [abPattern, setAbPattern] = useState<1 | 2>(1);
  const [abTouched, setAbTouched] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  // Ferien und Schließtage (#3820): ohne Haken lässt die Serie sie aus.
  const [includeSchoolBreaks, setIncludeSchoolBreaks] = useState(false);
  // After a series create/split with skipped days the modal shows this
  // notice instead of closing, so the admin sees which days were left out.
  const [seriesNotice, setSeriesNotice] = useState<string | null>(null);
  // Scope question ("Nur diese Woche" / "Ab jetzt dauerhaft" / "Alle Termine
  // der Serie") for edits and deletes of a series-backed row.
  const [scopeQuestion, setScopeQuestion] = useState<"edit" | null>(null);
  const [deleteScope, setDeleteScope] = useState<"single" | "following" | null>(
    null,
  );

  const clearFormError = formErrors.clear;
  const clearDeleteError = deleteErrors.clear;
  const isSeriesRow = mode === "edit" && shift?.seriesId != null;
  // A moved occurrence keeps its original recurrence slot. Series changes
  // begin at that slot, so every editor hint must describe the same date.
  const seriesEffectiveDate = shift?.seriesOccurrenceDate ?? date;

  // Errors belong to one opening: a different shift or a new opening starts
  // without them. The reload after a refusal hands in the stored shift with
  // the same id; its message stays until the person acts (ADR 0311).
  const openedShiftId = shift?.id;
  useEffect(() => {
    clearFormError();
    clearDeleteError();
  }, [openedShiftId, clearFormError, clearDeleteError]);

  // The dialog's questions and the create-only series section start anew
  // on opening and when the stored shift arrives after a refusal; the
  // fields are the draft's.
  useEffect(() => {
    resetWorkingTime();
    setConfirmDeleteOpen(false);
    setRepeatEnabled(false);
    setWeekdays([isoWeekdayOf(date)]);
    setBiweekly(false);
    setAbPattern(1);
    setAbTouched(false);
    setValidUntil("");
    setSeriesNotice(null);
    setIncludeSchoolBreaks(false);
    setScopeQuestion(null);
    leaveSeriesEdit();
  }, [seed, date, stored, resetWorkingTime, leaveSeriesEdit]);

  // Calendar periods load once the series section is opened; the period is
  // required (it bounds the series and anchors Woche A/B). A series row needs
  // them too: its own period decides whether Woche A/B is available at all
  // (#2028). Same entry as the Dienstplan's period switcher.
  const periodsResource = useSWRAuth(
    repeatEnabled || isSeriesRow ? databaseKeys.calendarPeriods() : null,
    () => calendarPeriodService.list(),
  );
  // Periods stay unloaded on a failure: an empty list would claim the school
  // has no calendar period at all.
  const periods: CalendarPeriod[] | null = periodsResource.data ?? null;
  const { error: periodsLoadError } = useSwrResourceLoadError(
    [periodsResource],
    "die Liste der Kalenderzeiträume",
    () => periodsResource.mutate(),
  );
  const periodId =
    chosenPeriodId ||
    (periods ? (findPeriodForDate(periods, date)?.id ?? "") : "");

  const seriesRule: SeriesRule | null = seriesRead.base ?? null;
  const seriesRuleLoadError = useReadDraftLoadError(seriesRead, "die Serie");
  const dayForm = useReadDraftForm(
    stored ? day : null,
    formErrors,
    "die Schicht",
  );
  // A series write also confirms the opened occurrence (its version): it
  // waits for both reads.
  const seriesWriteReady = seriesRead.canSubmit && day.canSubmit;
  const seriesWaitReason = !seriesRead.canSubmit
    ? readStateWaitReason(seriesRead.status)
    : dayForm.waitReason;

  const selectedPeriod = useMemo(
    () => periods?.find((p) => p.id === periodId) ?? null,
    [periods, periodId],
  );
  const periodHasCycle = (selectedPeriod?.weekCycleLength ?? 1) > 1;
  const defaultAbPattern = weekPatternForDate(selectedPeriod, date);
  const effectiveWeekPattern = biweekly && periodHasCycle ? abPattern : 0;

  // Default the A/B choice to the parity of the clicked week (mirrors the
  // timetable Wochenrhythmus control from #1882); a manual choice sticks.
  useEffect(() => {
    if (!biweekly || abTouched) return;
    if (defaultAbPattern !== null) setAbPattern(defaultAbPattern);
  }, [biweekly, abTouched, defaultAbPattern]);

  // The series edits against its OWN period, not the create form's selection:
  // that period decides whether Woche A/B exists and anchors the A/B parity.
  const seriesPeriod = useMemo(
    () => periods?.find((p) => p.id === seriesRule?.calendarPeriodId) ?? null,
    [periods, seriesRule],
  );
  const seriesPeriodHasCycle = (seriesPeriod?.weekCycleLength ?? 1) > 1;
  // The backend never re-plans today or the past, so a series edit takes effect
  // tomorrow at the earliest (clamped up to the segment start). Every hint in
  // the editor describes THIS date — showing the opened occurrence promised a
  // change for a day the re-plan does not touch (#2028).
  const seriesAppliesFrom = latestISODate(
    seriesEffectiveDate,
    dayAfterISO(berlinTodayISO()),
    seriesRule?.validFrom ?? seriesEffectiveDate,
  );
  // "Gültig bis" is inclusive in the picker: the segment still has something to
  // change while its last day is on or after the applies-from date. Without the
  // check the save fails server-side with a 400 the planner cannot act on.
  const seriesHasDateRange =
    seriesValidUntil === "" || seriesValidUntil >= seriesAppliesFrom;
  const seriesDefaultAbPattern = weekPatternForDate(
    seriesPeriod,
    seriesAppliesFrom,
  );
  // Keep the stored A/B pattern until the series period is available:
  // otherwise a save while its metadata is still loading would silently turn
  // an alternating series into a weekly one (#2028).
  const seriesRuleWeekPattern =
    seriesPeriod === null
      ? (seriesRule?.weekPattern ?? 0)
      : seriesBiweekly && seriesPeriodHasCycle
        ? seriesAbPattern
        : 0;

  // Schließtage der Serienbearbeitung (#2032): "Alle Termine der Serie" plant
  // ab dieser Stelle neu, kann also spätere Termine auf einen Schließtag
  // legen — dieselbe Rückfrage wie beim Anlegen. Das Fenster beginnt frühestens
  // morgen, weil die Materialisierung vergangene Tage ohnehin nicht anfasst.
  const seriesEditClosingDayWindow = useMemo(() => {
    if (!seriesEditOpen || !seriesPeriod) return null;
    const from = latestISODate(seriesAppliesFrom, seriesPeriod.startDate);
    const to =
      seriesValidUntil !== "" && seriesValidUntil < seriesPeriod.endDate
        ? seriesValidUntil
        : seriesPeriod.endDate;
    const dates = materializedRecurrenceDates({
      period: seriesPeriod,
      fromISO: from,
      weekdays: [...seriesWeekdays],
      weekPattern: seriesRuleWeekPattern,
      validUntil:
        seriesValidUntil === "" ? undefined : dayAfterISO(seriesValidUntil),
    });
    return { from, to, dates };
  }, [
    seriesEditOpen,
    seriesAppliesFrom,
    seriesPeriod,
    seriesRuleWeekPattern,
    seriesValidUntil,
    seriesWeekdays,
  ]);
  const seriesHasRemainingOccurrence =
    seriesHasDateRange &&
    (seriesPeriod === null || seriesEditClosingDayWindow?.dates.length !== 0);
  const seriesNoOccurrenceMessage = seriesHasDateRange
    ? `Für die gewählten Wochentage und den Wochenrhythmus bleibt ab ${formatDate(seriesAppliesFrom)} kein Termin mehr. Setze „Gültig bis" auf ein späteres Datum oder ändere die Wiederholung.`
    : `Diese Serie endet am ${formatDate(seriesValidUntil)}, Änderungen wirken aber erst ab ${formatDate(seriesAppliesFrom)}. Setze „Gültig bis" auf ein späteres Datum, um die Serie fortzuführen.`;

  const timesValid = shiftDurationMinutes(startTime, endTime) !== null;
  const breakMaxMinutes = shiftBreakMaxMinutes(startTime, endTime);
  const breakMinutes = parseBreakMinutes(breakMinutesStr, breakMaxMinutes);
  const breakValid = breakMinutes !== null;
  const seriesValid =
    !repeatEnabled || (weekdays.length > 0 && periodId !== "");

  const typeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "", label: "Keine Dienstart" },
    ];
    for (const type of shiftTypes) {
      if (isShiftTypeOffered(type) || type.id === shift?.shiftTypeId) {
        opts.push({ value: type.id, label: shiftTypeOptionLabel(type) });
      }
    }
    return opts;
  }, [shiftTypes, shift]);

  const periodOptions = useMemo(
    () =>
      (periods ?? [])
        .filter((p) => p.isActive)
        .map((p) => ({ value: p.id, label: p.name })),
    [periods],
  );

  // Replacement candidates: everyone except the absent staff member.
  const replacementStaffOptions = useMemo(
    () => [
      { value: "", label: "Person auswählen" },
      ...staffOptions
        .filter((member) => member.id !== staffId)
        .map((member) => ({
          value: member.id,
          label: `${member.lastName}, ${member.firstName}`,
        })),
    ],
    [staffOptions, staffId],
  );

  const addReplacement = () => {
    setReplacements((rows) => [
      ...rows,
      { staffId: "", startTime, endTime, breakMinutes: 0, shiftTypeId: "" },
    ]);
  };

  const updateReplacement = (index: number, patch: Partial<ReplacementRow>) => {
    setReplacements((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // A cover edited directly in the grid may carry a nonzero break, but this
        // row has no break field to correct it. Shortening the window below that
        // hidden break would otherwise submit a break longer than the shift and
        // the backend rejects the whole save. Clamp the preserved break to the
        // edited duration so it can never exceed the window (#1841).
        const maxBreak =
          patch.startTime !== undefined || patch.endTime !== undefined
            ? shiftDurationMinutes(next.startTime, next.endTime)
            : null;
        return copyStableObjectKey(
          row,
          maxBreak !== null && next.breakMinutes > maxBreak
            ? { ...next, breakMinutes: maxBreak }
            : next,
        );
      }),
    );
  };

  const removeReplacement = (index: number) => {
    setReplacements((rows) => rows.filter((_, i) => i !== index));
  };

  const toggleSeriesWeekday = (value: number) => {
    setSeriesFields({
      weekdays: seriesWeekdays.includes(value)
        ? seriesWeekdays.filter((v) => v !== value)
        : [...seriesWeekdays, value].sort((a, b) => a - b),
    });
  };

  /** Opens the series editor: the same shift modal, but editing the rule
   *  behind the shift (weekdays, rhythm, window, validity) instead of the
   *  single day. An untouched editor follows a newer read of the rule (the
   *  plan reloads after every colleague's change), so it shows the rule it
   *  saves against. */
  const openSeriesEdit = () => {
    // The button stays disabled until the rule has loaded.
    if (!seriesRule) return;
    formErrors.clear();
    drafts.openSeriesEdit();
  };

  /** Writes the edited rule through the existing split: it takes effect from
   *  this occurrence onwards, days before it keep the old rule. That is the
   *  one behaviour a series edit has — no second write path (#2028). */
  const saveSeriesRule = async () => {
    if (!seriesRule || !shift || !seriesWriteReady) return;
    if (!validateInputs()) return;
    if (seriesWeekdays.length === 0) {
      formErrors.invalid(WEEKDAY_REQUIRED_MESSAGE);
      return;
    }
    if (!seriesHasRemainingOccurrence) {
      formErrors.invalid(seriesNoOccurrenceMessage);
      return;
    }
    await runWrite("save", async (op) => {
      const result = await seriesRead.submit((expectedVersion) =>
        staffShiftSeriesService.splitSeries(seriesRule.id, {
          effectiveDate: seriesEffectiveDate,
          occurrenceShiftId: shift.id,
          expectedOccurrenceVersion: day.token?.version ?? "",
          startTime,
          endTime,
          breakMinutes: breakMinutes ?? 0,
          shiftTypeId: shiftTypeId === "" ? null : shiftTypeId,
          weekdays: [...seriesWeekdays],
          weekPattern: seriesRuleWeekPattern,
          // The picker is inclusive, the API's valid_until exclusive.
          validUntil:
            seriesValidUntil === "" ? null : dayAfterISO(seriesValidUntil),
          includeSchoolBreaks: seriesIncludeSchoolBreaks,
          workingTime: workingTime.current(),
          expectedVersion,
        }),
      );
      if (result.ok) {
        finishSeriesMutation(result.saved, op);
        return;
      }
      const err = result.error;
      logger.error("shift_series_rule_save_failed", {
        series_id: seriesRule.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
      if (!op.isCurrent()) return;
      if (result.refused) {
        showSeriesChanged(err, result.reload);
        return;
      }
      if (workingTime.intercept(err, () => latestSaveRef.current())) return;
      await formErrors.show(err, {
        object: "die Serie",
        retry: () => latestSaveRef.current(),
      });
    });
  };

  /** A colleague changed the series since it was read (ADR 0311): the modal
   *  shows the stored rule again once `reload` read it (the editor reopens
   *  from it), and the plan reloads. A failed read is a load error, and
   *  nothing is sent until the rule is read. */
  const showSeriesChanged = (
    err: unknown,
    reload: (() => Promise<unknown>) | undefined,
  ) => {
    if (seriesEditOpen) leaveSeriesEdit();
    onSaved();
    // A split effective today also rewrote the opened occurrence and checks
    // its version: the day's draft takes the refusal too, so the next write
    // waits for the stored occurrence and sends its version.
    const readAgain =
      seriesEffectiveDate === berlinTodayISO()
        ? readBoth(reload, day.refuse())
        : reload;
    void formErrors.show(err, { object: "die Serie", reload: readAgain });
  };

  const toggleWeekday = (value: number) => {
    setWeekdays((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value].sort((a, b) => a - b),
    );
  };

  const finishSeriesMutation = (
    result: SeriesResult,
    op: FormModalOperation,
  ) => {
    onSaved();
    if (!op.isCurrent()) return;
    const notices: string[] = [];
    if (result.skippedNonWorkingDays > 0) {
      notices.push(schoolBreaksNotice(result.skippedNonWorkingDays));
    }
    if (result.skippedDates.length > 0) {
      notices.push(
        `An folgenden Tagen besteht bereits eine Schicht, sie wurden übersprungen: ${result.skippedDates
          .map((day) => formatDate(day))
          .join(", ")}.`,
      );
    }
    if (notices.length > 0) {
      setSeriesNotice(notices.join(" "));
      return;
    }
    onClose();
  };

  const validateInputs = (): boolean => {
    formErrors.clear();
    if (!timesValid) {
      formErrors.invalid("Das Ende muss nach dem Beginn liegen.", {
        end_time: "Bitte eine spätere Zeit wählen.",
      });
      return false;
    }
    if (!breakValid || breakMinutes === null) {
      formErrors.invalid(
        `Die Pause muss zwischen 0 und ${breakMaxMinutes} Minuten liegen.`,
        { break_minutes: `Bitte 0 bis ${breakMaxMinutes} Minuten eintragen.` },
      );
      return false;
    }
    if (repeatEnabled && weekdays.length === 0) {
      formErrors.invalid(WEEKDAY_REQUIRED_MESSAGE);
      return false;
    }
    if (repeatEnabled && periodId === "") {
      formErrors.invalid("Bitte wähle einen Kalenderzeitraum aus.", {
        calendar_period_id: "Bitte einen Zeitraum wählen.",
      });
      return false;
    }
    if (mode === "edit" && cancelled) {
      for (const row of replacements) {
        if (row.staffId === "") {
          formErrors.invalid(
            "Bitte wähle für jede Vertretung eine Person aus.",
          );
          return false;
        }
        if (!(
          row.startTime !== "" &&
          row.endTime !== "" &&
          row.startTime < row.endTime
        )) {
          formErrors.invalid(
            "Bei jeder Vertretung muss das Ende nach dem Beginn liegen.",
          );
          return false;
        }
      }
    }
    return true;
  };

  const createSeries = () =>
    runWrite("save", async (op) => {
      try {
        const result = await staffShiftSeriesService.createSeries({
          staffId,
          weekdays,
          startTime,
          endTime,
          breakMinutes: breakMinutes ?? 0,
          shiftTypeId: shiftTypeId === "" ? null : shiftTypeId,
          calendarPeriodId: periodId,
          // Guard against stale biweekly state: switching to a period without
          // a week cycle hides the A/B control but does not reset the flag.
          weekPattern: effectiveWeekPattern,
          validFrom: date,
          // The picker is inclusive ("Gültig bis" = last day WITH a shift);
          // the API's valid_until is exclusive — send the day after.
          validUntil: validUntil === "" ? null : dayAfterISO(validUntil),
          includeSchoolBreaks,
          workingTime: workingTime.current(),
        });
        finishSeriesMutation(result, op);
      } catch (err: unknown) {
        logger.error("shift_series_create_failed", {
          staff_id: staffId,
          date,
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        if (workingTime.intercept(err, () => latestSaveRef.current())) return;
        await formErrors.show(err, {
          object: "die Serie",
          retry: () => latestSaveRef.current(),
        });
      }
    });

  const saveSingleShift = () =>
    runWrite("save", async (op) => {
      try {
        const resolvedShiftTypeId = shiftTypeId === "" ? null : shiftTypeId;
        if (mode === "edit" && shift) {
          // Anything that touches the cancellation state (cancelling, editing the
          // replacement set, or reactivating) goes through one atomic endpoint so
          // the origin flag and the whole replacement set change together (#1841).
          // Reactivating removes the now-obsolete replacements server-side; a plain
          // edit never carries `cancelled`, so the stored flag is preserved.
          const wasCancelled = shift.cancelled ?? false;
          const cancellationInvolved =
            !isReplacementRow && (cancelled || wasCancelled);
          // Sends over the shift and covers the draft rests on (ADR 0311).
          const result = await day.submit((token) =>
            cancellationInvolved
              ? staffShiftService.applyCancellation(shift.id, {
                  cancelled,
                  changeReason,
                  // Carry the shift's own edited window/type so a time change made in
                  // the same save is applied to the origin, not silently dropped, and
                  // a reactivation re-checks overlap against the edited window (#1841).
                  startTime,
                  endTime,
                  breakMinutes: breakMinutes ?? 0,
                  shiftTypeId: resolvedShiftTypeId,
                  // Each cover keeps its own break and shift type — a replacement may
                  // have been edited directly in the grid to differ from the origin,
                  // so re-saving the origin must not reset them (#1841).
                  replacements: cancelled
                    ? replacements.map((row) => ({
                        staffId: row.staffId,
                        startTime: row.startTime,
                        endTime: row.endTime,
                        breakMinutes: row.breakMinutes,
                        shiftTypeId:
                          row.shiftTypeId === "" ? null : row.shiftTypeId,
                      }))
                    : [],
                  workingTime: workingTime.current(),
                  expectedVersion: token?.version ?? "",
                  expectedReplacementVersions: Object.fromEntries(
                    token?.covers ?? [],
                  ),
                })
              : staffShiftService.updateShift(shift.id, {
                  staffId,
                  date,
                  startTime,
                  endTime,
                  breakMinutes: breakMinutes ?? 0,
                  shiftTypeId: resolvedShiftTypeId,
                  changeReason,
                  workingTime: workingTime.current(),
                  expectedVersion: token?.version ?? "",
                }),
          );
          if (!result.ok) {
            if (result.skipped) return;
            if (!result.refused) throw result.error;
            // Changed since the modal opened: the message waits for the
            // stored shift, which reseeds the form; no retry resends.
            if (op.isCurrent()) {
              await formErrors.show(result.error, {
                object: "die Schicht",
                reload: result.reload,
              });
            }
            return;
          }
        } else {
          await staffShiftService.createShift({
            staffId,
            date,
            startTime,
            endTime,
            breakMinutes: breakMinutes ?? 0,
            shiftTypeId: resolvedShiftTypeId,
            workingTime: workingTime.current(),
          });
        }
        onSaved();
        if (op.isCurrent()) onClose();
      } catch (err: unknown) {
        logger.error("shift_save_failed", {
          staff_id: staffId,
          date,
          mode,
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        if (workingTime.intercept(err, () => latestSaveRef.current())) return;
        await formErrors.show(err, {
          object: "die Schicht",
          retry: () => latestSaveRef.current(),
        });
      } finally {
        if (op.isCurrent()) setScopeQuestion(null);
      }
    });

  const splitSeriesFromHere = async () => {
    const seriesId = shift?.seriesId;
    // The choice stays disabled until the rule and its version are loaded.
    if (!shift || !seriesId || !seriesWriteReady) return;
    await runWrite("save", async (op) => {
      try {
        // The version of the rule on screen since the modal opened.
        const result = await seriesRead.submit((expectedVersion) =>
          staffShiftSeriesService.splitSeries(seriesId, {
            effectiveDate: seriesEffectiveDate,
            occurrenceShiftId: shift.id,
            expectedOccurrenceVersion: day.token?.version ?? "",
            startTime,
            endTime,
            breakMinutes: breakMinutes ?? 0,
            shiftTypeId: shiftTypeId === "" ? null : shiftTypeId,
            workingTime: workingTime.current(),
            expectedVersion,
          }),
        );
        if (result.ok) {
          finishSeriesMutation(result.saved, op);
          return;
        }
        const err = result.error;
        logger.error("shift_series_split_failed", {
          series_id: seriesId,
          date: shift.date,
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        if (result.refused) {
          showSeriesChanged(err, result.reload);
          return;
        }
        if (workingTime.intercept(err, () => latestSaveRef.current())) return;
        await formErrors.show(err, {
          object: "die Serie",
          retry: () => latestSaveRef.current(),
        });
      } finally {
        if (op.isCurrent()) setScopeQuestion(null);
      }
    });
  };

  const handleSubmit = async () => {
    scopeChoiceRef.current = null;
    // Nothing goes out before the stored shift is read (ADR 0311).
    if (!dayForm.begin()) return;
    if (!validateInputs()) return;
    if (mode === "create" && repeatEnabled) {
      await createSeries();
      return;
    }
    // A cancellation (or reactivation) is always a single-occurrence change:
    // the backend detaches the series row, so the "Nur diese Woche / Ab jetzt"
    // scope question does not apply. Plain time edits keep it.
    const cancellationChanged = cancelled !== (shift?.cancelled ?? false);
    if (isSeriesRow && !cancelled && !cancellationChanged) {
      setScopeQuestion("edit");
      return;
    }
    await saveSingleShift();
  };

  const deleteSingleShift = async () => {
    if (!shift) return;
    await runWrite("delete", async (op) => {
      deleteErrors.clear();
      try {
        await staffShiftService.deleteShift(shift.id);
        onSaved();
        if (!op.isCurrent()) return;
        setConfirmDeleteOpen(false);
        onClose();
      } catch (err: unknown) {
        logger.error("shift_delete_failed", {
          shift_id: shift.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        // The confirmation stays open and says why.
        await deleteErrors.show(err, {
          object: "die Schicht",
          retry: () => latestDeleteRef.current(),
        });
      } finally {
        if (op.isCurrent()) setScopeQuestion(null);
      }
    });
  };

  const endSeriesFromHere = async () => {
    const seriesId = shift?.seriesId;
    if (!seriesId) return;
    await runWrite("delete", async (op) => {
      deleteErrors.clear();
      try {
        await staffShiftSeriesService.endSeries(seriesId, seriesEffectiveDate);
        onSaved();
        if (!op.isCurrent()) return;
        setConfirmDeleteOpen(false);
        onClose();
      } catch (err: unknown) {
        logger.error("shift_series_end_failed", {
          series_id: seriesId,
          date: seriesEffectiveDate,
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        await deleteErrors.show(err, {
          object: "die Serie",
          retry: () => latestDeleteRef.current(),
        });
      } finally {
        if (op.isCurrent()) setScopeQuestion(null);
      }
    });
  };

  // Löschen (#3110): ein Dialog; bei einer Serienschicht liegt die Scope-Wahl
  // (nur diese Woche / ab jetzt dauerhaft) als Slot in der ConfirmDeleteModal.
  const handleDeleteClick = () => {
    deleteErrors.clear();
    setDeleteScope(isSeriesRow ? null : "single");
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteScope === "following") await endSeriesFromHere();
    else await deleteSingleShift();
  };

  useLayoutEffect(() => {
    // Retry repeats the action that failed, with what the form holds now.
    latestSaveRef.current = () => {
      if (seriesEditOpen) void saveSeriesRule();
      else if (scopeChoiceRef.current === "following") {
        if (validateInputs()) void splitSeriesFromHere();
      } else if (scopeChoiceRef.current === "single") {
        if (validateInputs()) void saveSingleShift();
      } else void handleSubmit();
    };
    latestDeleteRef.current = () => void handleConfirmDelete();
  });

  const handleScopeSelect = (value: string) => {
    scopeChoiceRef.current = value === "single" ? "single" : "following";
    if (value === "single") void saveSingleShift();
    else void splitSeriesFromHere();
  };

  const title = seriesEditOpen
    ? "Serie bearbeiten"
    : mode === "edit"
      ? `Schicht bearbeiten · ${formatDate(date, true)}`
      : `Schicht anlegen · ${formatDate(date, true)}`;

  // The series editor writes the rule, not this day — so it gets its own
  // footer: no per-day delete, and a back route to the single occurrence.
  const seriesFooter = (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={() => {
          leaveSeriesEdit();
          formErrors.clear();
        }}
        disabled={isSaving}
        tooltip="Zeigt wieder nur diesen Tag, Änderungen an der Serie entfallen."
      >
        Zurück
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => void saveSeriesRule()}
        isLoading={isSaving}
        loadingText="Speichern…"
        disabled={
          isSaving ||
          !timesValid ||
          !breakValid ||
          seriesWeekdays.length === 0 ||
          !seriesWriteReady
        }
        disabledReason={
          timeBlockedReason(timesValid, breakValid) ??
          (seriesWeekdays.length === 0
            ? WEEKDAY_BLOCKED_REASON
            : seriesWaitReason)
        }
        tooltip="Ändert die Serie ab diesem Termin, frühestens ab morgen."
      >
        Serie speichern
      </Button>
    </div>
  );

  const footer = seriesNotice ? (
    <Button
      type="button"
      variant="primary"
      size="md"
      onClick={onClose}
      noTooltip="Schließt nur das Fenster, die Serie ist schon gespeichert."
    >
      Schließen
    </Button>
  ) : seriesEditOpen ? (
    seriesFooter
  ) : (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center">
      {mode === "edit" && shift && (
        <Button
          type="button"
          variant="outline_danger"
          size="md"
          className="sm:mr-auto"
          onClick={handleDeleteClick}
          disabled={isSaving || isDeleting}
          tooltip={
            isSeriesRow
              ? "Löscht die Schicht oder die Serie ab hier, moto fragt vorher nach."
              : "Löscht die Schicht, moto fragt vorher nach."
          }
        >
          Schicht löschen
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={onClose}
        disabled={isSaving || isDeleting}
        noTooltip="Abbrechen schließt den Dialog, ohne etwas zu ändern."
      >
        Abbrechen
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={handleSubmit}
        isLoading={isSaving}
        loadingText="Speichern…"
        disabled={
          isSaving ||
          isDeleting ||
          !timesValid ||
          !breakValid ||
          !seriesValid ||
          (stored !== null && !day.canSubmit)
        }
        disabledReason={
          isDeleting
            ? undefined
            : (timeBlockedReason(timesValid, breakValid) ??
              dayForm.waitReason ??
              (weekdays.length === 0
                ? WEEKDAY_BLOCKED_REASON
                : "Wähle zuerst einen Planungszeitraum aus."))
        }
        tooltip={submitTooltip({
          mode,
          repeatEnabled,
          asksScope:
            isSeriesRow &&
            !cancelled &&
            cancelled === (shift?.cancelled ?? false),
        })}
      >
        {submitLabel(mode, repeatEnabled)}
      </Button>
    </div>
  );

  const scopeOverlayOpen = scopeQuestion !== null;

  /** Binds a plain control to its API field: name for focus, marking. */
  const fieldControl = (name: string) => {
    const invalid = formErrors.fieldError(name) !== undefined;
    return {
      name,
      "aria-invalid": invalid ? true : undefined,
      "aria-describedby": invalid ? `shift-${name}-error` : undefined,
    };
  };
  const fieldHint = (name: string) => {
    const hint = formErrors.fieldError(name);
    return hint ? (
      <p
        id={`shift-${name}-error`}
        className="text-moto-red-strong mt-1 text-xs"
      >
        {hint}
      </p>
    ) : null;
  };

  return (
    <>
      {/* Hidden while another confirmation is open — all use the same fixed
          z-index, so stacking them puts the topmost dialog's buttons behind
          this modal's body. */}
      <SlideOver
        open={!confirmDeleteOpen && !scopeOverlayOpen}
        pending={write}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <SlideOverContent size="lg">
          <SlideOverHeader>
            <SlideOverTitle>{title}</SlideOverTitle>
          </SlideOverHeader>
          <SlideOverBody error={seriesNotice ? null : formErrors.error}>
            {/* The read after a refused save failed; the form's alert
                names it while it shows the refusal. */}
            <LoadErrorAlert error={dayForm.loadError} />
            {seriesNotice ? (
              <div className="space-y-3 text-sm">
                <p className="text-gray-700">Die Serie wurde gespeichert.</p>
                <Alert
                  type="warning"
                  size="compact"
                  announce="off"
                  message={seriesNotice}
                />
              </div>
            ) : (
              <div ref={formRef} className="space-y-4 text-sm">
                <p className="text-sm text-gray-600">{staffName}</p>
                {isSeriesRow && (
                  // The series panel states the rule itself (#2028). Knowing only
                  // "Teil einer Serie" leaves the planner guessing which days the
                  // series covers and how far it runs — and the way to the whole
                  // series used to exist only as a dialog after Speichern.
                  <InsetPanel className="space-y-2">
                    <p className="text-xs text-gray-600">
                      {shift?.detached
                        ? "Diese Schicht gehört zu einer Serie und wurde für diese Woche angepasst."
                        : "Diese Schicht ist Teil einer Serie."}
                    </p>
                    {seriesRule && (
                      <p className="text-xs font-medium text-gray-800">
                        {describeSeriesRule(seriesRule)}
                      </p>
                    )}
                    {/* After a refusal the form's alert already names the
                        failed read, with its retry. */}
                    {seriesRead.status === "loadFailed" && !formErrors.error ? (
                      <LoadErrorAlert error={seriesRuleLoadError} />
                    ) : null}
                    <LoadErrorAlert error={periodsLoadError} />
                    {!seriesEditOpen && (
                      <Button
                        type="button"
                        variant="outline"
                        size="compact"
                        onClick={openSeriesEdit}
                        disabled={
                          !seriesRead.canSubmit || isSaving || isDeleting
                        }
                        tooltip="Öffnet die Regel der ganzen Serie zum Ändern."
                      >
                        Serie bearbeiten
                      </Button>
                    )}
                  </InsetPanel>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Beginn">
                    <Input
                      controlSize="compact"
                      type="time"
                      {...fieldControl("start_time")}
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="tabular-nums"
                    />
                    {fieldHint("start_time")}
                  </Field>
                  <Field label="Ende">
                    <Input
                      controlSize="compact"
                      type="time"
                      {...fieldControl("end_time")}
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="tabular-nums"
                    />
                    {fieldHint("end_time")}
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Pause (Minuten)">
                    <Input
                      controlSize="compact"
                      type="number"
                      {...fieldControl("break_minutes")}
                      min={0}
                      max={breakMaxMinutes}
                      inputMode="numeric"
                      value={breakMinutesStr}
                      onChange={(e) => setBreakMinutesStr(e.target.value)}
                      className="tabular-nums"
                    />
                    {fieldHint("break_minutes")}
                  </Field>
                </div>
                {typeOptions.length > 1 && (
                  <Field label="Dienstart">
                    <CustomSelect
                      value={shiftTypeId}
                      options={typeOptions}
                      onChange={setShiftTypeId}
                      name="shift_type_id"
                      invalid={!!formErrors.fieldError("shift_type_id")}
                      ariaLabel="Dienstart"
                      placeholder="Keine Dienstart"
                    />
                  </Field>
                )}
                {mode === "edit" && !seriesEditOpen && (
                  <Field label="Grund der Änderung (optional)">
                    <Input
                      controlSize="compact"
                      type="text"
                      {...fieldControl("change_reason")}
                      value={changeReason}
                      maxLength={200}
                      onChange={(e) =>
                        setDayFields({ changeReason: e.target.value })
                      }
                      placeholder="z. B. Krankheit, Fortbildung, Tausch"
                    />
                    {fieldHint("change_reason")}
                    {/* A permanent series change ("Ab jetzt dauerhaft") re-plans the
                    series and carries no per-day reason, so be honest that the
                    reason only sticks to a single-occurrence change. */}
                    {isSeriesRow && (
                      <p className="mt-1 text-xs text-gray-500">
                        Der Grund wird nur bei „Nur diese Woche" gespeichert,
                        nicht bei „Ab jetzt dauerhaft".
                      </p>
                    )}
                  </Field>
                )}
                {isReplacementRow && (
                  <Alert
                    type="info"
                    size="compact"
                    announce="off"
                    message="Diese Schicht ist eine Vertretung für eine ausgefallene Schicht."
                  />
                )}
                {seriesEditOpen && seriesRule && (
                  <InsetPanel tone="white" className="space-y-3">
                    <p className="text-xs text-gray-600">
                      {`Die Änderungen gelten ab ${formatDate(seriesAppliesFrom)} für alle weiteren Termine der Serie. Termine davor bleiben unverändert, ebenso Termine bis heute.`}
                    </p>
                    <FieldGroup label="Wochentage">
                      <WeekdayPicker
                        weekdays={seriesWeekdays}
                        onToggle={toggleSeriesWeekday}
                      />
                    </FieldGroup>
                    <FieldGroup label="Wochenrhythmus">
                      <RhythmPicker
                        biweekly={seriesBiweekly}
                        onBiweeklyChange={(next) =>
                          setSeriesFields({ biweekly: next })
                        }
                        abPattern={seriesAbPattern}
                        onAbPatternChange={(next) =>
                          setSeriesFields({ abPattern: next })
                        }
                        periodHasCycle={seriesPeriodHasCycle}
                        weekHint={
                          seriesDefaultAbPattern !== null
                            ? `Die Woche vom ${formatDate(seriesAppliesFrom)} ist Woche ${
                                seriesDefaultAbPattern === 1 ? "A" : "B"
                              }.`
                            : undefined
                        }
                      />
                    </FieldGroup>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* The date the change actually takes effect: the opened
                      occurrence, moved forward to tomorrow when it already
                      passed — the re-plan never touches today or earlier. */}
                      <Field label="Gilt ab">
                        <Input
                          controlSize="compact"
                          type="text"
                          value={formatDate(seriesAppliesFrom)}
                          disabled
                        />
                      </Field>
                      {/* FieldGroup, not Field — see the create block: a label
                      around the DatePicker re-dispatches clicks. */}
                      <FieldGroup label="Gültig bis (optional)">
                        <DatePicker
                          ariaLabel="Gültig bis (optional)"
                          value={
                            seriesValidUntil === ""
                              ? null
                              : parseISODate(seriesValidUntil)
                          }
                          onChange={(picked) =>
                            setSeriesFields({
                              validUntil: picked ? toISODate(picked) : "",
                            })
                          }
                          placeholder="Datum auswählen"
                        />
                      </FieldGroup>
                    </div>
                    <SchoolBreaksCheckbox
                      id="shift-series-edit-school-breaks"
                      checked={seriesIncludeSchoolBreaks}
                      onChange={(next) =>
                        setSeriesFields({ includeSchoolBreaks: next })
                      }
                    />
                    {/* Say it before the save fails: a segment whose last day has
                    arrived has nothing left for the re-plan to change (#2028). */}
                    {!seriesHasRemainingOccurrence && (
                      <Alert
                        type="warning"
                        size="compact"
                        announce="off"
                        message={seriesNoOccurrenceMessage}
                      />
                    )}
                  </InsetPanel>
                )}
                {mode === "edit" &&
                  shift &&
                  !isReplacementRow &&
                  !seriesEditOpen && (
                    <InsetPanel tone="white" className="space-y-3">
                      <label
                        htmlFor="shift-cancel-toggle"
                        className="flex items-center gap-2"
                      >
                        <Checkbox
                          id="shift-cancel-toggle"
                          checked={cancelled}
                          // Keep the replacement rows across an un-check/re-check: the
                          // section is hidden while unchecked and the save only sends
                          // replacements when `cancelled` is true, so clearing here
                          // would erase the existing covers for a reactivation that was
                          // never submitted — and re-checking must bring them back
                          // rather than silently wiping every cover on save (#1841).
                          onChange={(e) =>
                            setDayFields({ cancelled: e.target.checked })
                          }
                        />
                        <span className="text-sm font-medium text-gray-800">
                          Diese Schicht fällt aus
                        </span>
                      </label>
                      {cancelled && (
                        <div className="space-y-3">
                          <p className="text-xs text-gray-500">
                            Die Schicht zählt nicht mehr zur geplanten Zeit.
                            Ohne Vertretung bleibt die Lücke bewusst offen;
                            sonst trage eine oder mehrere Ersatzpersonen ein.
                          </p>
                          {replacements.map((row, index) => (
                            <InsetPanel
                              key={getStableObjectKey(row, "replacement")}
                              framed
                              className="space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <SectionLabel as="p">
                                  Vertretung {index + 1}
                                </SectionLabel>
                                <span className="inline-flex rounded-full">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Vertretung ${index + 1} entfernen`}
                                    tooltip="Nimmt die Vertretung heraus, das gilt erst nach dem Speichern."
                                    onClick={() => removeReplacement(index)}
                                  >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </span>
                              </div>
                              <CustomSelect
                                value={row.staffId}
                                options={replacementStaffOptions}
                                onChange={(value) =>
                                  updateReplacement(index, { staffId: value })
                                }
                                ariaLabel={`Ersatzperson ${index + 1}`}
                                placeholder="Person auswählen"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <Field label="Beginn">
                                  <Input
                                    controlSize="compact"
                                    type="time"
                                    aria-label={`Vertretung ${index + 1} Beginn`}
                                    value={row.startTime}
                                    onChange={(e) =>
                                      updateReplacement(index, {
                                        startTime: e.target.value,
                                      })
                                    }
                                    className="tabular-nums"
                                  />
                                </Field>
                                <Field label="Ende">
                                  <Input
                                    controlSize="compact"
                                    type="time"
                                    aria-label={`Vertretung ${index + 1} Ende`}
                                    value={row.endTime}
                                    onChange={(e) =>
                                      updateReplacement(index, {
                                        endTime: e.target.value,
                                      })
                                    }
                                    className="tabular-nums"
                                  />
                                </Field>
                              </div>
                            </InsetPanel>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="md"
                            onClick={addReplacement}
                            disabled={replacementStaffOptions.length <= 1}
                            disabledReason="Es gibt keine andere Person für eine Vertretung."
                            tooltip="Fügt Felder für eine weitere Ersatzperson hinzu."
                          >
                            + Vertretung hinzufügen
                          </Button>
                          {replacementStaffOptions.length <= 1 && (
                            <p className="text-xs text-gray-500">
                              Keine andere Person verfügbar, um eine Vertretung
                              einzutragen.
                            </p>
                          )}
                        </div>
                      )}
                    </InsetPanel>
                  )}
                {mode === "create" && (
                  <InsetPanel tone="white" className="space-y-3">
                    <label
                      htmlFor="shift-series-toggle"
                      className="flex items-center gap-2"
                    >
                      <Checkbox
                        id="shift-series-toggle"
                        checked={repeatEnabled}
                        onChange={(e) => setRepeatEnabled(e.target.checked)}
                      />
                      <span className="text-sm font-medium text-gray-800">
                        Als Serie wiederholen
                      </span>
                    </label>
                    {repeatEnabled && (
                      <div className="space-y-3">
                        <FieldGroup label="Wochentage">
                          <WeekdayPicker
                            weekdays={weekdays}
                            onToggle={toggleWeekday}
                          />
                        </FieldGroup>
                        <Field label="Kalenderzeitraum">
                          {periodsLoadError ? (
                            <LoadErrorAlert error={periodsLoadError} />
                          ) : periods !== null && periodOptions.length === 0 ? (
                            <Alert
                              type="warning"
                              size="compact"
                              announce="off"
                              message="Kein aktiver Kalenderzeitraum vorhanden. Bitte zuerst unter Planung → Kalenderzeiträume einen Zeitraum anlegen."
                            />
                          ) : (
                            <CustomSelect
                              value={periodId}
                              options={periodOptions}
                              onChange={setPeriodId}
                              name="calendar_period_id"
                              invalid={
                                !!formErrors.fieldError("calendar_period_id")
                              }
                              ariaLabel="Kalenderzeitraum"
                              placeholder={
                                periods === null
                                  ? "Lade Zeiträume…"
                                  : "Auswählen"
                              }
                            />
                          )}
                        </Field>
                        <FieldGroup label="Wochenrhythmus">
                          <RhythmPicker
                            biweekly={biweekly}
                            onBiweeklyChange={setBiweekly}
                            abPattern={abPattern}
                            onAbPatternChange={(next) => {
                              setAbTouched(true);
                              setAbPattern(next);
                            }}
                            periodHasCycle={periodHasCycle}
                            weekHint={
                              defaultAbPattern !== null
                                ? `Die Woche vom ${formatDate(date)} ist Woche ${
                                    defaultAbPattern === 1 ? "A" : "B"
                                  }.`
                                : undefined
                            }
                          />
                        </FieldGroup>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field label="Gültig ab">
                            <Input
                              controlSize="compact"
                              type="text"
                              value={formatDate(date)}
                              disabled
                            />
                          </Field>
                          {/* FieldGroup, not Field: the DatePicker trigger and
                          calendar are buttons — inside Field's <label> a
                          click would re-dispatch onto the first labelable
                          child (see FieldGroup comment below). */}
                          <FieldGroup label="Gültig bis (optional)">
                            <DatePicker
                              ariaLabel="Gültig bis (optional)"
                              value={
                                validUntil === ""
                                  ? null
                                  : parseISODate(validUntil)
                              }
                              onChange={(picked) =>
                                setValidUntil(picked ? toISODate(picked) : "")
                              }
                              placeholder="Datum auswählen"
                            />
                          </FieldGroup>
                        </div>
                        <SchoolBreaksCheckbox
                          id="shift-series-school-breaks"
                          checked={includeSchoolBreaks}
                          onChange={setIncludeSchoolBreaks}
                        />
                        <p className="text-xs text-gray-500">
                          Ohne Enddatum läuft die Serie bis zum Ende des
                          Kalenderzeitraums; mit Enddatum bis einschließlich
                          diesem Tag. Schichten werden ab morgen eingeplant;
                          bestehende Schichten bleiben unverändert.
                        </p>
                      </div>
                    )}
                  </InsetPanel>
                )}
              </div>
            )}
          </SlideOverBody>
          <SlideOverFooter>{footer}</SlideOverFooter>
        </SlideOverContent>
      </SlideOver>
      {workingTime.dialog}
      <ConfirmDeleteModal
        isOpen={confirmDeleteOpen}
        title="Schicht löschen"
        description={
          isSeriesRow ? (
            <>
              Die Schicht am <strong>{formatDate(date, true)}</strong> für{" "}
              <strong>{staffName}</strong> ist Teil einer Serie.
            </>
          ) : (
            <>
              Die geplante Schicht am <strong>{formatDate(date, true)}</strong>{" "}
              für <strong>{staffName}</strong> wird gelöscht.
            </>
          )
        }
        scope={
          isSeriesRow
            ? {
                label: "Was soll gelöscht werden?",
                name: "shift-delete-scope",
                value: deleteScope,
                onChange: (value) =>
                  setDeleteScope(
                    value === "following" ? "following" : "single",
                  ),
                options: [
                  {
                    value: "single",
                    label: "Nur diese Woche",
                    description:
                      "Nur dieser Termin entfällt; die Serie plant ihn nicht erneut ein.",
                  },
                  {
                    value: "following",
                    label: "Ab jetzt dauerhaft",
                    description:
                      "Die Serie endet ab diesem Datum; einzeln angepasste Termine bleiben bestehen.",
                  },
                ],
              }
            : undefined
        }
        gate={{ mode: "twoStep" }}
        confirmLabel={isSeriesRow ? "Löschen" : "Endgültig löschen"}
        loading={isDeleting}
        error={deleteErrors.error}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          deleteErrors.clear();
          setConfirmDeleteOpen(false);
        }}
      />
      <ChoiceModal
        isOpen={scopeQuestion === "edit"}
        onClose={() => setScopeQuestion(null)}
        title="Änderung übernehmen"
        description="Diese Schicht ist Teil einer Serie. Wofür soll die Änderung gelten?"
        options={[
          {
            value: "single",
            label: "Nur diese Woche",
            description:
              "Nur dieser Termin wird angepasst; die Serie bleibt unverändert.",
          },
          {
            value: "following",
            label: "Ab jetzt dauerhaft",
            description:
              "Die Serie wird ab diesem Datum geteilt und mit den neuen Zeiten fortgeführt.",
            disabled: !seriesWriteReady,
            disabledReason:
              seriesRead.status === "loadFailed"
                ? "Lade zuerst die Serie neu."
                : !seriesRead.canSubmit
                  ? "Die Serie wird noch geladen."
                  : seriesWaitReason,
          },
        ]}
        onSelect={handleScopeSelect}
        isBusy={isSaving}
      />
    </>
  );
}

/** One line describing what a series does: "Mo, Mi · 08:00–16:00 · Woche A ·
 *  bis 31.01.2027". Without it "Teil einer Serie" leaves the planner guessing
 *  which days are covered and how long the rule runs (#2028). */
function describeSeriesRule(rule: SeriesRule): string {
  const parts = [
    formatWeekdays(rule.weekdays),
    `${rule.startTime}–${rule.endTime}`,
  ];
  if (rule.weekPattern === 1) parts.push("Woche A");
  if (rule.weekPattern === 2) parts.push("Woche B");
  parts.push(
    rule.validUntil
      ? // valid_until is exclusive; the last day WITH a shift is the day before.
        `bis ${formatDate(dayBeforeISO(rule.validUntil))}`
      : "bis Ende des Kalenderzeitraums",
  );
  return parts.filter(Boolean).join(" · ");
}

function submitLabel(mode: ShiftEditMode, repeatEnabled: boolean): string {
  if (mode === "edit") return "Änderungen speichern";
  return repeatEnabled ? "Serie anlegen" : "Schicht anlegen";
}

const WEEKDAY_BLOCKED_REASON = "Wähle zuerst mindestens einen Wochentag aus.";

/** Warum Beginn, Ende oder Pause das Speichern sperren (#6643). */
function timeBlockedReason(
  timesValid: boolean,
  breakValid: boolean,
): string | undefined {
  if (!timesValid) return "Prüfe zuerst Beginn und Ende.";
  if (!breakValid) return "Prüfe zuerst die Pause.";
  return undefined;
}

function submitTooltip({
  mode,
  repeatEnabled,
  asksScope,
}: {
  readonly mode: ShiftEditMode;
  readonly repeatEnabled: boolean;
  /** Eine Serienschicht fragt beim Speichern nach dem Umfang. */
  readonly asksScope: boolean;
}): string {
  if (mode === "create") {
    return repeatEnabled
      ? "Legt die Schicht an jedem gewählten Wochentag des Zeitraums an."
      : "Trägt die Schicht an diesem Tag in den Dienstplan ein.";
  }
  return asksScope
    ? "Speichert die Änderung, moto fragt vorher nach, für welche Wochen."
    : "Speichert die Änderung an dieser Schicht.";
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

// Field variant for control GROUPS (weekday checkboxes, rhythm buttons).
// Deliberately a div: wrapping a group in a <label> makes clicks on any
// child bubble into the label's activation behavior, which re-dispatches
// the click onto the FIRST labelable descendant and silently toggles the
// wrong control.
function FieldGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

// The "Gültig bis" picker is inclusive; the backend's valid_until is
// exclusive (timetable split convention) — convert by adding one day.
function dayAfterISO(isoDate: string): string {
  const d = parseISODate(isoDate);
  d.setDate(d.getDate() + 1);
  return toISODate(d);
}

function isoWeekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const day = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
  return day === 0 ? 7 : day;
}

/** Ferien und Schließtage je Serie (#3820). Ohne Haken bleiben sie frei;
 *  Feiertage sind immer frei. */
function SchoolBreaksCheckbox({
  id,
  checked,
  onChange,
}: {
  readonly id: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-gray-800">
          Auch in den Ferien und an Schließtagen planen
        </span>
        <span className="block text-xs text-gray-500">
          Ohne Haken bleiben diese Tage frei. An Feiertagen gibt es nie eine
          Schicht.
        </span>
      </span>
    </label>
  );
}

function schoolBreaksNotice(count: number): string {
  return count === 1
    ? "1 Tag liegt in den Ferien, an einem Schließtag oder Feiertag und bleibt frei."
    : `${count} Tage liegen in den Ferien, an Schließtagen oder Feiertagen und bleiben frei.`;
}
