"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTenantRouter } from "~/lib/tenant-router";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataField } from "~/components/ui/data-field";
import { ISODatePicker } from "~/components/ui/date-picker";
import { FieldLabel } from "~/components/ui/field-label";
import { Input } from "~/components/ui/input";
import { Modal } from "~/components/ui/modal";
import {
  SlideOver,
  SlideOverContent,
  SlideOverDescription,
  SlideOverFooter,
  SlideOverHeader,
  SlideOverTitle,
} from "~/components/ui/slide-over";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Textarea } from "~/components/ui/textarea";
import { InsetPanel } from "~/components/ui/inset-panel";
import { ToggleChip } from "~/components/ui/toggle-chip";
import { Switch } from "~/components/ui/switch";
import {
  berlinClockFromISO,
  berlinDateTimeISO,
  berlinTodayISO,
  berlinWallClockProblem,
  formatDate,
  parseISODate,
  toISODate,
} from "~/lib/date-helpers";
import { useApiErrorDisplay, useApiFormError } from "~/contexts/ToastContext";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { useTenantMutate } from "~/lib/swr";
import {
  adaptAbsenceForMetrics,
  isEffectiveAbsenceStatus,
  isHalfAbsenceBoundary,
} from "~/lib/staff-metrics-helpers";
import { dayLaborHints } from "~/lib/labor-time-hints";
import type { CreateAbsenceRequest } from "~/lib/time-tracking-api";
import type { UpdateAbsenceRequest } from "~/lib/contract/time-tracking.generated";
import { isReadStateRefusal } from "~/lib/api-error";
import {
  type WorkDayLaborHint,
  formatTime,
  STORED_END_NOT_CLEARABLE_HINT,
  TIME_REQUIRED_HINT,
} from "~/lib/time-tracking-helpers";
import {
  CatalogManageLink,
  useCatalogRefreshOnFocus,
} from "~/components/database/catalog/catalog-manage-link";
import { useAbsenceTypeSelect } from "~/components/staff/use-absence-type-select";
import {
  STANDARD_ABSENCE_OPTIONS,
  useAbsenceTypeOptions,
} from "~/components/staff/use-absence-type-options";
import { absenceRequestFor, selectValueFor } from "~/lib/absence-type-select";
import { createLogger } from "~/lib/logger";
import type { OwnAbsence, OwnBlock } from "~/lib/own-time-tracking-view";

type SessionStatus = OwnBlock["status"];
const logger = createLogger({ component: "OwnTimeDialogs" });
const ABSENCE_RANGE_MISSING = "Wähle zuerst Von und Bis.";
function formatDateGerman(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

const DAY_NAMES_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

const BREAK_DURATION_OPTIONS = [0, 15, 30, 45, 60] as const;

const EDIT_SECTION_ITEMS: readonly SegmentedControlItem<
  "session" | "absence"
>[] = [
  { value: "session", label: "Arbeitszeit" },
  { value: "absence", label: "Abwesenheit" },
];

// One-tap presets for the mandatory "Grund der Änderung" field.
const EDIT_REASON_PRESETS = [
  "Vergessen auszustempeln",
  "Vergessen einzustempeln",
  "Zeitkorrektur",
  "Krankheit",
  "Ort-Änderung",
] as const;

function timeInputToMinutes(value: string): number | null {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

/** Get modal title based on content */
function getEditModalTitle(hasSession: boolean, hasAbsence: boolean): string {
  if (hasSession && hasAbsence) return "Tag bearbeiten";
  if (hasAbsence) return "Abwesenheit bearbeiten";
  return "Eintrag bearbeiten";
}

// Shared Abbrechen/confirm footer for every Modal on this page — six
// hand-rolled copies of the same two <button> elements before. Uses the kit
// Button at size "md", the modal-footer height documented in the UI-kit rule.
export function ModalActions({
  onCancel,
  onConfirm,
  confirmLabel,
  cancelLabel = "Abbrechen",
  confirmTooltip,
  confirmDisabled = false,
  confirmDisabledReason,
  cancelDisabled = false,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** What confirming does, in one sentence (#6643). */
  readonly confirmTooltip: string;
  readonly confirmDisabled?: boolean;
  /** Why confirming is blocked; leave unset while saving. */
  readonly confirmDisabledReason?: string;
  readonly cancelDisabled?: boolean;
}) {
  return (
    <div className="flex w-full flex-col-reverse gap-3 sm:flex-row">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={onCancel}
        disabled={cancelDisabled}
        noTooltip="Schließt nur das Fenster, ohne etwas zu speichern."
        className="flex-1"
      >
        {cancelLabel}
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={onConfirm}
        disabled={confirmDisabled}
        disabledReason={confirmDisabledReason}
        tooltip={confirmTooltip}
        className="flex-1"
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

/** Get modal footer based on context */
function getEditModalFooter(
  hasBothSections: boolean,
  hasAbsence: boolean,
  activeTab: "session" | "absence",
  sessionFooter: React.ReactNode,
  absenceFooter: React.ReactNode,
): React.ReactNode {
  if (hasBothSections) {
    return activeTab === "session" ? sessionFooter : absenceFooter;
  }
  return hasAbsence ? absenceFooter : sessionFooter;
}

function MissingSessionHint({
  date,
  canManage,
}: {
  readonly date: Date;
  readonly canManage: boolean;
}) {
  const dayIndex = (date.getDay() + 6) % 7;
  const dayName = DAY_NAMES_LONG[dayIndex] ?? "";

  return (
    <div className="space-y-3 py-2 text-sm text-gray-600">
      <p>
        Für {dayName}, den {formatDate(toISODate(date))} ist keine Arbeitszeit
        eingetragen.
      </p>
      {canManage ? (
        <p>
          Mit „Nachtragen“ öffnest du die passende Seite. Dort trägst du die
          Arbeitszeit für diesen Tag ein.
        </p>
      ) : (
        <p>
          Nur die Leitung kann fehlende Tage nachtragen. Bitte melde dich dort.
        </p>
      )}
    </div>
  );
}

function BackfillFooter({
  onClose,
  onBackfill,
}: {
  readonly onClose: () => void;
  readonly onBackfill: (() => void) | null;
}) {
  return (
    <div className="flex w-full flex-col-reverse gap-3 sm:flex-row">
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={onClose}
        noTooltip="Schließt nur das Fenster."
        className="flex-1"
      >
        Schließen
      </Button>
      {onBackfill && (
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={onBackfill}
          tooltip="Öffnet deine Zeiterfassung in der Verwaltung, um den Tag nachzutragen."
          className="flex-1"
        >
          Nachtragen
        </Button>
      )}
    </div>
  );
}

export function EditSessionModal({
  isOpen,
  onClose,
  session,
  date,
  onSave,
  onReload,
  absence,
  onUpdateAbsence,
  onDeleteAbsence,
  canManage,
  ownStaffId,
  laborDay,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly session: OwnBlock | null;
  /** ArbZG-Sicht des gespeicherten Arbeitstags vom Server (#4804). */
  readonly laborDay?: WorkDayLaborHint;
  readonly date: Date | null;
  // Nachtragen ist bewusst admin-only (#2361). Mit time_tracking:manage
  // bietet der Hinweis-Dialog den Absprung in die eigene Verwaltungs-Ansicht.
  readonly canManage: boolean;
  readonly ownStaffId: string | null;
  readonly onSave: (
    id: string,
    updates: {
      checkInTime?: string;
      checkOutTime?: string;
      breakMinutes?: number;
      status?: SessionStatus;
      notes?: string;
      breaks?: Array<{ id: string; durationMinutes: number }>;
      expectedVersion: string;
    },
  ) => Promise<void>;
  /** Reads the history again; rejects when that fails. */
  readonly onReload: () => Promise<unknown>;
  readonly absence: OwnAbsence | null;
  readonly onUpdateAbsence: (
    id: string,
    req: UpdateAbsenceRequest,
  ) => Promise<void>;
  readonly onDeleteAbsence: (id: string) => Promise<void>;
}) {
  // Session state
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [breakMins, setBreakMins] = useState("0");
  const [breakDurations, setBreakDurations] = useState<Map<string, number>>(
    new Map(),
  );
  const [status, setStatus] = useState<SessionStatus>("present");
  const [notes, setNotes] = useState("");
  // Der Stand des Blocks, den der Dialog zeigt (ADR 0311): gesetzt mit den
  // Feldern beim Öffnen, gesendet mit der Korrektur.
  const [readVersion, setReadVersion] = useState("");
  const refusals = useApiErrorDisplay();
  const [saving, setSaving] = useState(false);

  // Absence state. absType is an option value, not an AbsenceType: it also
  // carries the school's own Abwesenheitsarten (#2403).
  const [absType, setAbsType] = useState<string>("sick");
  const [absDateStart, setAbsDateStart] = useState("");
  const [absDateEnd, setAbsDateEnd] = useState("");
  const [absHalfDay, setAbsHalfDay] = useState(false);
  const [absNote, setAbsNote] = useState("");
  const [absenceSaving, setAbsenceSaving] = useState(false);
  const [absenceDeleting, setAbsenceDeleting] = useState(false);
  // Speichern, Abwesenheit speichern und löschen sperren das Panel (#6593);
  // der Tag ist der Vorgang, an dem eine Antwort hängt.
  const save = useFormModalPending(isOpen, date ? toISODate(date) : null);
  const absenceTypeSelect = useAbsenceTypeSelect({
    value: absType,
    onChange: setAbsType,
    canManage,
  });
  const tenantMutate = useTenantMutate();
  const refreshAbsenceTypes = useCallback(async () => {
    await tenantMutate("staff-absence-types");
  }, [tenantMutate]);
  useCatalogRefreshOnFocus(refreshAbsenceTypes, isOpen && canManage);

  const [activeTab, setActiveTab] = useState<"session" | "absence">("session");
  const router = useTenantRouter();
  // A failed save or delete stays in this slide-over, which stays open.
  const formAreaRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formAreaRef);
  const clearFormErrors = formErrors.clear;

  const hasIndividualBreaks = (session?.breaks.length ?? 0) > 0;
  const hasSession = session !== null;
  const hasAbsence = absence !== null;
  const hasBoth = hasSession && hasAbsence;
  const isManagerControlledAbsence = absence?.absenceType === "comp_time";

  useEffect(() => {
    if (isOpen) {
      setActiveTab("session");
      clearFormErrors();
    }
  }, [isOpen, clearFormErrors]);

  // The stored times as the fields show them: Berlin wall clock of the
  // session (#6293). Prefill and the "unchanged" check below share them.
  const initialStart = session ? berlinClockFromISO(session.checkInTime) : "";
  const initialEnd = session?.checkOutTime
    ? berlinClockFromISO(session.checkOutTime)
    : "";

  useEffect(() => {
    if (session && isOpen) {
      setStartTime(initialStart);
      setEndTime(initialEnd);
      setBreakMins(session.breakMinutes.toString());
      setStatus(session.status);
      setNotes("");
      setReadVersion(session.version);

      // Initialize per-break durations
      if (session.breaks.length > 0) {
        const durations = new Map<string, number>();
        for (const brk of session.breaks) {
          durations.set(brk.id, brk.durationMinutes);
        }
        setBreakDurations(durations);
      } else {
        setBreakDurations(new Map());
      }
    }
  }, [session, isOpen, initialStart, initialEnd]);

  // Initialize absence state when modal opens
  useEffect(() => {
    if (absence && isOpen) {
      setAbsType(selectValueFor(absence.absenceType, absence.absenceTypeId));
      setAbsDateStart(absence.dateStart);
      setAbsDateEnd(absence.dateEnd);
      setAbsHalfDay(absence.halfDay);
      setAbsNote(absence.note);
    }
  }, [absence, isOpen]);

  // Clamp absDateEnd when absDateStart moves past it
  useEffect(() => {
    if (absDateStart && absDateEnd && absDateEnd < absDateStart) {
      setAbsDateEnd(absDateStart);
    }
  }, [absDateStart, absDateEnd]);

  if (!date) return null;

  const dayIndex = (date.getDay() + 6) % 7;
  const dayName = DAY_NAMES_LONG[dayIndex] ?? "";
  const dateKey = toISODate(date);
  const absenceIsHalfDay = absence
    ? isHalfAbsenceBoundary(
        adaptAbsenceForMetrics({ ...absence, staffId: ownStaffId ?? "" }),
        dateKey,
        absence.dateStart.slice(0, 10),
        absence.dateEnd.slice(0, 10),
      )
    : false;
  const onBackfill =
    canManage && ownStaffId
      ? () =>
          router.push(`/staff/${ownStaffId}?tab=zeiterfassung&date=${dateKey}`)
      : null;
  const hasBackfillableAbsence =
    !hasSession &&
    hasAbsence &&
    (absenceIsHalfDay || !isEffectiveAbsenceStatus(absence.status)) &&
    onBackfill !== null;
  const hasBothSections = hasBoth || hasBackfillableAbsence;

  // Tag ohne Buchung und ohne Abwesenheit: kein stiller No-Op mehr (#2361).
  // Nachtragen bleibt admin-only — der Dialog erklärt den Weg, Berechtigte
  // springen direkt in die eigene Verwaltungs-Ansicht ab.
  if (!hasSession && !hasAbsence) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Kein Eintrag vorhanden"
        footer={<BackfillFooter onClose={onClose} onBackfill={onBackfill} />}
      >
        <MissingSessionHint date={date} canManage={onBackfill !== null} />
      </Modal>
    );
  }

  // Calculate total break from individual breaks or fallback dropdown
  const editedBreak = hasIndividualBreaks
    ? Array.from(breakDurations.values()).reduce((sum, d) => sum + d, 0)
    : Number.parseInt(breakMins, 10) || 0;

  // Hinweise zum gespeicherten Tag, vom Server bewertet (#4804). Sie gelten
  // für den Stand vor dieser Änderung; nach dem Speichern prüft der Server
  // den Tag neu.
  const laborHints = dayLaborHints(laborDay);
  const startMinutes = timeInputToMinutes(startTime);
  const endMinutes = timeInputToMinutes(endTime);
  const hasInvalidTimeRange =
    startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;

  // Times are school times on the session's own day: the offset comes from
  // that day, not from today (#6293). A field left as prefilled is not sent,
  // so a reason-only edit never rewrites the stored instants. The session's
  // own date, not the clicked day: they may differ.
  const sessionDay = session ? parseISODate(session.date) : null;
  const startChanged = session !== null && startTime !== initialStart;
  const endChanged = session !== null && endTime !== initialEnd;
  const startProblem =
    sessionDay && startChanged && startTime
      ? berlinWallClockProblem(sessionDay, startTime)
      : null;
  const endProblem =
    sessionDay && endChanged && endTime
      ? berlinWallClockProblem(sessionDay, endTime)
      : null;
  // Every reason the save stays blocked stands at its field (#6293).
  const startMissingProblem =
    session !== null && !startTime ? TIME_REQUIRED_HINT : null;
  const endClearedProblem =
    endChanged && !endTime && initialEnd ? STORED_END_NOT_CLEARABLE_HINT : null;
  const hasUnresolvableTime =
    startProblem !== null || endProblem !== null || endClearedProblem !== null;
  // Der Grund steht auch am Feld; die Blase am Knopf sagt, was zuerst fehlt.
  const sessionSaveBlockedReason = saving
    ? undefined
    : !startTime || hasInvalidTimeRange || hasUnresolvableTime
      ? "Prüfe zuerst die markierten Uhrzeiten."
      : "Wähle oder schreibe zuerst einen Grund.";

  const handleBreakDurationChange = (breakId: string, minutes: number) => {
    setBreakDurations((prev) => {
      const next = new Map(prev);
      next.set(breakId, minutes);
      return next;
    });
  };

  const handleSave = async () => {
    if (!session || !sessionDay) return;
    if (hasInvalidTimeRange || hasUnresolvableTime) return;
    await save.run(async (op) => {
      setSaving(true);
      formErrors.clear();
      try {
        const checkInTime =
          startChanged && startTime
            ? berlinDateTimeISO(sessionDay, startTime)
            : undefined;
        const checkOutTime =
          endChanged && endTime
            ? berlinDateTimeISO(sessionDay, endTime)
            : undefined;

        if (hasIndividualBreaks) {
          // Build breaks array with only changed durations
          const changedBreaks = session.breaks
            .filter((brk) => {
              const newDuration = breakDurations.get(brk.id);
              return (
                newDuration !== undefined && newDuration !== brk.durationMinutes
              );
            })
            .map((brk) => ({
              id: brk.id,
              durationMinutes: breakDurations.get(brk.id)!,
            }));

          await onSave(session.id, {
            checkInTime,
            checkOutTime,
            status,
            notes: notes || undefined,
            breaks: changedBreaks.length > 0 ? changedBreaks : undefined,
            expectedVersion: readVersion,
          });
        } else {
          await onSave(session.id, {
            checkInTime,
            checkOutTime,
            breakMinutes: editedBreak,
            status,
            notes: notes || undefined,
            expectedVersion: readVersion,
          });
        }
        if (op.isCurrent()) onClose();
      } catch (err) {
        logger.error("session_edit_failed", {
          error: err instanceof Error ? err.message : String(err),
          session_id: session.id,
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        if (isReadStateRefusal(err)) {
          // Der Block hat sich inzwischen geändert: Der Dialog schließt,
          // die Ansicht zeigt den gespeicherten Stand mit der Meldung.
          onClose();
          await refusals.show(err, {
            object: "die Arbeitszeit",
            reload: onReload,
          });
          return;
        }
        // No retry link: the handlers live below the early returns, so a
        // latest-ref is not possible; „Speichern“ resends the current draft.
        await formErrors.show(err, { object: "die Arbeitszeit" });
      } finally {
        if (op.isCurrent()) setSaving(false);
      }
    });
  };

  const handleAbsenceSave = async () => {
    if (!absence) return;
    await save.run(async (op) => {
      setAbsenceSaving(true);
      formErrors.clear();
      try {
        await onUpdateAbsence(absence.id, {
          ...absenceRequestFor(absType),
          date_start: absDateStart,
          date_end: absDateEnd,
          half_day: absHalfDay,
          note: absNote.trim() || undefined,
        });
        if (op.isCurrent()) onClose();
      } catch (err) {
        logger.error("update_absence_failed", {
          error: err instanceof Error ? err.message : String(err),
          absence_id: absence.id,
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        // „Speichern“ resends the current draft (see handleSave).
        await formErrors.show(err, { object: "die Abwesenheit" });
      } finally {
        if (op.isCurrent()) setAbsenceSaving(false);
      }
    });
  };

  const handleAbsenceDelete = async () => {
    if (!absence) return;
    await save.run(async (op) => {
      setAbsenceDeleting(true);
      formErrors.clear();
      try {
        await onDeleteAbsence(absence.id);
        if (op.isCurrent()) onClose();
      } catch (err) {
        logger.error("delete_absence_failed", {
          error: err instanceof Error ? err.message : String(err),
          absence_id: absence.id,
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        await formErrors.show(err, {
          object: "die Abwesenheit",
          retry: () => void handleAbsenceDelete(),
        });
      } finally {
        if (op.isCurrent()) setAbsenceDeleting(false);
      }
    });
  };

  const modalTitle = getEditModalTitle(
    hasSession || hasBackfillableAbsence,
    hasAbsence,
  );

  // With only one of the two present there is no switcher, and the visible
  // section is pinned to whichever exists — `activeTab` alone would keep an
  // absence-only day on the (empty) "session" section.
  const effectiveTab: "session" | "absence" = hasBothSections
    ? activeTab
    : hasAbsence
      ? "absence"
      : "session";

  // Footer: tab-aware for dual-section, standard for single-section
  const sessionFooter = (
    <ModalActions
      onCancel={onClose}
      onConfirm={handleSave}
      confirmLabel={saving ? "Speichern…" : "Speichern"}
      confirmTooltip="Speichert die Korrektur im Verlauf. Du und die Leitung sehen ihn."
      confirmDisabled={
        saving ||
        !startTime ||
        !notes.trim() ||
        hasInvalidTimeRange ||
        hasUnresolvableTime
      }
      confirmDisabledReason={sessionSaveBlockedReason}
    />
  );

  const backfillFooter = (
    <BackfillFooter onClose={onClose} onBackfill={onBackfill} />
  );

  const absenceFooter = (
    <ModalActions
      onCancel={onClose}
      onConfirm={handleAbsenceSave}
      confirmLabel={absenceSaving ? "Speichern…" : "Speichern"}
      confirmTooltip="Übernimmt die Änderungen an dieser Abwesenheit."
      confirmDisabled={absenceSaving || !absDateStart || !absDateEnd}
      confirmDisabledReason={absenceSaving ? undefined : ABSENCE_RANGE_MISSING}
    />
  );

  const readOnlyAbsenceFooter = (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={onClose}
      noTooltip="Schließt nur das Fenster."
    >
      Schließen
    </Button>
  );

  const footer = getEditModalFooter(
    hasBothSections,
    hasAbsence,
    activeTab,
    hasSession ? sessionFooter : backfillFooter,
    isManagerControlledAbsence ? readOnlyAbsenceFooter : absenceFooter,
  );

  return (
    <SlideOver
      open={isOpen}
      pending={save}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SlideOverContent size="md">
        <SlideOverHeader>
          <SlideOverTitle>{modalTitle}</SlideOverTitle>
          <SlideOverDescription>
            {dayName}, {formatDateGerman(date)}
          </SlideOverDescription>
        </SlideOverHeader>
        <div
          ref={formAreaRef}
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
        >
          <FormErrorAlert message={formErrors.error} />
          {/* Section switcher for a session or a backfillable half-day alongside
            an absence. The kit
            SegmentedControl, NOT ui/Tabs: Radix tabs activate on mousedown, and
            the existing modal tests drive this switcher with fireEvent.click. */}
          {hasBothSections && (
            <SegmentedControl
              ariaLabel="Abschnitt"
              fullWidth
              items={EDIT_SECTION_ITEMS}
              value={effectiveTab}
              onChange={setActiveTab}
            />
          )}

          {!hasSession &&
            hasBackfillableAbsence &&
            effectiveTab === "session" && (
              <MissingSessionHint date={date} canManage={onBackfill !== null} />
            )}

          {/* ── Session section ──────────────────────────────────────────── */}
          {hasSession && effectiveTab === "session" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  id="edit-start"
                  name="check_in_time"
                  label="Start"
                  controlSize="compact"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  error={
                    startMissingProblem ??
                    startProblem ??
                    formErrors.fieldError("check_in_time")
                  }
                />
                <Input
                  id="edit-end"
                  name="check_out_time"
                  label="Ende"
                  controlSize="compact"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  error={
                    hasInvalidTimeRange
                      ? "Das Ende muss nach dem Beginn liegen."
                      : (endProblem ??
                        endClearedProblem ??
                        formErrors.fieldError("check_out_time"))
                  }
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Break section */}
                <div>
                  {hasIndividualBreaks ? (
                    <div>
                      <FieldLabel id="edit-breaks-label">Pausen</FieldLabel>
                      <div
                        role="group"
                        aria-labelledby="edit-breaks-label"
                        className="space-y-2"
                      >
                        {session.breaks.map((brk) => (
                          <div key={brk.id} className="flex items-center gap-2">
                            <span className="w-12 shrink-0 text-xs text-gray-500 tabular-nums">
                              {formatTime(brk.startedAt)}
                            </span>
                            <div className="flex-1">
                              <CustomSelect
                                ariaLabel={`Pausendauer ab ${formatTime(brk.startedAt)}`}
                                value={(
                                  breakDurations.get(brk.id) ??
                                  brk.durationMinutes
                                ).toString()}
                                onChange={(next) =>
                                  handleBreakDurationChange(
                                    brk.id,
                                    Number.parseInt(next, 10),
                                  )
                                }
                                options={BREAK_DURATION_OPTIONS.map((m) => ({
                                  value: m.toString(),
                                  label: `${m} min`,
                                }))}
                              />
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-gray-100 pt-1.5">
                          <span className="text-xs font-medium text-gray-500">
                            Gesamt
                          </span>
                          <span className="text-sm font-medium text-gray-700 tabular-nums">
                            {editedBreak} min
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <CustomSelect
                      id="edit-break"
                      label="Pause (Min)"
                      value={breakMins}
                      onChange={setBreakMins}
                      options={[0, 15, 30, 45, 60].map((m) => ({
                        value: m.toString(),
                        label: `${m} min`,
                      }))}
                    />
                  )}
                </div>
                <CustomSelect
                  id="edit-status"
                  label="Ort"
                  value={status}
                  onChange={(next) => setStatus(next as SessionStatus)}
                  options={[
                    { value: "present", label: "In der OGS" },
                    { value: "home_office", label: "Unterwegs" },
                  ]}
                />
              </div>

              <div>
                <FieldLabel
                  htmlFor="edit-notes"
                  required
                  invalid={Boolean(formErrors.fieldError("notes"))}
                  className="mb-1"
                >
                  Grund der Änderung
                </FieldLabel>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {EDIT_REASON_PRESETS.map((reason) => (
                    <ToggleChip
                      key={reason}
                      pressed={notes === reason}
                      onPressedChange={() => setNotes(reason)}
                    >
                      {reason}
                    </ToggleChip>
                  ))}
                </div>
                <Textarea
                  id="edit-notes"
                  name="notes"
                  aria-required
                  error={formErrors.fieldError("notes")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Oder eigenen Grund eingeben…"
                />
              </div>

              {laborHints.length > 0 && (
                <div className="space-y-2">
                  {laborHints.map((hint) => (
                    <Alert key={hint.key} type="warning" message={hint.text} />
                  ))}
                  <p className="text-xs text-gray-500">
                    So ist der Tag bisher gespeichert. Nach dem Speichern wird
                    er neu geprüft.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Absence section ──────────────────────────────────────────── */}
          {hasAbsence && effectiveTab === "absence" && (
            <div className="space-y-4">
              {isManagerControlledAbsence ? (
                <div className="space-y-4">
                  <Alert
                    type="info"
                    message="Freizeitausgleich wird von der Leitung eingetragen und kann hier nicht geändert oder gelöscht werden."
                  />
                  {/* Felder zur Einordnung im Formular-Slide-over, kein
                      Detailbaum: nur DataField, kein DataGrid
                      (bauart/one-detail-per-type, #3115). */}
                  <InsetPanel
                    as="dl"
                    framed
                    padding="md"
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <DataField label="Zeitraum">
                      {absence.dateStart} bis {absence.dateEnd}
                    </DataField>
                    <DataField label="Umfang">
                      {absence.halfDay ? "Halber Tag" : "Ganzer Tag"}
                    </DataField>
                    {absence.note && (
                      <DataField label="Bemerkung" fullWidth>
                        {absence.note}
                      </DataField>
                    )}
                  </InsetPanel>
                </div>
              ) : (
                <>
                  {/* Absence type */}
                  <div>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <FieldLabel
                        id="edit-abs-type-label"
                        htmlFor="edit-abs-type"
                        className="mb-0"
                      >
                        Art der Abwesenheit
                      </FieldLabel>
                      {/* Eigene Namen pflegt die Datenverwaltung (#3114); der
                          Link öffnet ein zweites Fenster, damit dieser Eintrag
                          stehen bleibt. */}
                      {canManage && (
                        <CatalogManageLink
                          href="/database/absence-types"
                          label="Abwesenheitsarten verwalten"
                        />
                      )}
                    </div>
                    <CustomSelect
                      {...absenceTypeSelect}
                      id="edit-abs-type"
                      ariaLabelledBy="edit-abs-type-label"
                      testId="edit-absence-type-select"
                    />
                  </div>

                  {/* Date range */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <ISODatePicker
                      id="edit-abs-start"
                      name="date_start"
                      label="Von"
                      error={formErrors.fieldError("date_start")}
                      value={absDateStart}
                      onChange={setAbsDateStart}
                      calendarLayout="popover"
                      hideClearButton
                    />
                    <ISODatePicker
                      id="edit-abs-end"
                      name="date_end"
                      label="Bis"
                      error={formErrors.fieldError("date_end")}
                      value={absDateEnd}
                      min={absDateStart || undefined}
                      onChange={setAbsDateEnd}
                      calendarLayout="popover"
                      hideClearButton
                    />
                  </div>

                  {/* Half day toggle */}
                  <div className="flex items-center gap-3">
                    <Switch
                      ariaLabel="Halber Tag"
                      checked={absHalfDay}
                      onCheckedChange={setAbsHalfDay}
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Halber Tag
                    </span>
                  </div>

                  {/* Absence note */}
                  <Textarea
                    id="edit-abs-note"
                    name="note"
                    label="Bemerkung (optional)"
                    error={formErrors.fieldError("note")}
                    value={absNote}
                    onChange={(e) => setAbsNote(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="z. B. Arzttermin, Schulung …"
                  />

                  {/* Destructive action */}
                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="ghost_danger"
                      size="compact"
                      onClick={handleAbsenceDelete}
                      disabled={save.pending}
                      tooltip="Löscht die Abwesenheit sofort, moto protokolliert die Löschung."
                    >
                      {absenceDeleting
                        ? "Abwesenheit wird gelöscht…"
                        : "Abwesenheit löschen"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <SlideOverFooter>{footer}</SlideOverFooter>
      </SlideOverContent>
    </SlideOver>
  );
}

// ─── CreateAbsenceModal ───────────────────────────────────────────────────────

export function CreateAbsenceModal({
  isOpen,
  onClose,
  onSave,
  canManageAbsenceTypes,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (req: CreateAbsenceRequest) => Promise<void>;
  /** Gates the "Name hinzufügen" affordance on time_tracking:manage (#2403). */
  readonly canManageAbsenceTypes: boolean;
}) {
  const todayStr = berlinTodayISO();
  // One option space for the standard types and the school's own names — see
  // absence-type-select for why the value is a string, not an AbsenceType.
  const [absenceType, setAbsenceType] = useState<string>("sick");
  const [dateStart, setDateStart] = useState(todayStr);
  const [dateEnd, setDateEnd] = useState(todayStr);
  const [halfDay, setHalfDay] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // A failed save stays in this dialog, which stays open.
  const formAreaRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formAreaRef);
  const clearFormErrors = formErrors.clear;
  // „Wiederholen“ sendet den aktuellen Entwurf, nicht den vom Fehlerzeitpunkt.
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const absenceTypeSelect = useAbsenceTypeSelect({
    value: absenceType,
    onChange: setAbsenceType,
    canManage: canManageAbsenceTypes,
  });
  // Eine beantragbare Art (#4710) geht als Antrag an die Leitung; der
  // Dialog sagt das, bevor gespeichert wird.
  const { options: absenceTypeOptions } = useAbsenceTypeOptions(
    canManageAbsenceTypes,
    STANDARD_ABSENCE_OPTIONS,
    absenceType,
  );
  const isRequest =
    absenceTypeOptions.find((option) => option.value === absenceType)
      ?.requestable === true;
  const tenantMutate = useTenantMutate();
  const refreshAbsenceTypes = useCallback(async () => {
    await tenantMutate("staff-absence-types");
  }, [tenantMutate]);
  useCatalogRefreshOnFocus(
    refreshAbsenceTypes,
    isOpen && canManageAbsenceTypes,
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const today = berlinTodayISO();
      setAbsenceType("sick");
      setDateStart(today);
      setDateEnd(today);
      setHalfDay(false);
      setNote("");
      clearFormErrors();
    }
  }, [isOpen, clearFormErrors]);

  // Clamp dateEnd when dateStart moves past it
  useEffect(() => {
    if (dateStart && dateEnd && dateEnd < dateStart) {
      setDateEnd(dateStart);
    }
  }, [dateStart, dateEnd]);

  const handleSave = async () => {
    setSaving(true);
    formErrors.clear();
    try {
      await onSave({
        ...absenceRequestFor(absenceType),
        date_start: dateStart,
        date_end: dateEnd,
        half_day: halfDay || undefined,
        note: note.trim() || undefined,
      });
    } catch (err) {
      logger.error("create_absence_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await formErrors.show(err, {
        object: "die Abwesenheit",
        retry: () => void latestSaveRef.current(),
      });
    } finally {
      setSaving(false);
    }
  };
  useLayoutEffect(() => {
    latestSaveRef.current = handleSave;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Abwesenheit melden"
      footer={
        <ModalActions
          onCancel={onClose}
          onConfirm={handleSave}
          confirmLabel={
            isRequest
              ? saving
                ? "Wird beantragt…"
                : "Beantragen"
              : saving
                ? "Speichern…"
                : "Speichern"
          }
          confirmTooltip={
            isRequest
              ? "Schickt den Antrag an die Leitung. Sie entscheidet."
              : "Trägt die Abwesenheit sofort in deine Zeiterfassung ein."
          }
          confirmDisabled={saving || !dateStart || !dateEnd}
          confirmDisabledReason={saving ? undefined : ABSENCE_RANGE_MISSING}
        />
      }
    >
      <div ref={formAreaRef} className="space-y-4">
        <FormErrorAlert message={formErrors.error} />
        {/* Absence type */}
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <FieldLabel
              id="absence-type-label"
              htmlFor="absence-type"
              className="mb-0"
            >
              Art der Abwesenheit
            </FieldLabel>
            {canManageAbsenceTypes && (
              <CatalogManageLink
                href="/database/absence-types"
                label="Abwesenheitsarten verwalten"
              />
            )}
          </div>
          <CustomSelect
            {...absenceTypeSelect}
            id="absence-type"
            ariaLabelledBy="absence-type-label"
            testId="absence-type-select"
          />
          {isRequest && (
            <p className="mt-2 text-sm text-gray-600">
              Diese Art beantragst du. Die Leitung entscheidet. Bis dahin sind
              die Tage für dich vorgemerkt.
            </p>
          )}
        </div>

        {/* Date range */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ISODatePicker
            id="absence-start"
            name="date_start"
            label="Von"
            error={formErrors.fieldError("date_start")}
            value={dateStart}
            onChange={setDateStart}
            calendarLayout="popover"
            hideClearButton
          />
          <ISODatePicker
            id="absence-end"
            name="date_end"
            label="Bis"
            error={formErrors.fieldError("date_end")}
            value={dateEnd}
            min={dateStart || undefined}
            onChange={setDateEnd}
            calendarLayout="popover"
            hideClearButton
          />
        </div>

        {/* Half day toggle */}
        <div className="flex items-center gap-3">
          <Switch
            ariaLabel="Halber Tag"
            checked={halfDay}
            onCheckedChange={setHalfDay}
          />
          <span className="text-sm font-medium text-gray-700">Halber Tag</span>
        </div>

        {/* Note */}
        <Textarea
          id="absence-note"
          name="note"
          label="Bemerkung (optional)"
          error={formErrors.fieldError("note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="z. B. Arzttermin, Schulung …"
        />
      </div>
    </Modal>
  );
}
