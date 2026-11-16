"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FieldLabel } from "~/components/ui/field-label";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { ClassArrivalExceptionPanel } from "./class-arrival-exception-panel";
import type { Student } from "~/lib/student-helpers";
import { createLogger } from "~/lib/logger";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import {
  type ArrivalScheduleInput,
  type BulkArrivalFilter,
  type SchoolPeriod,
  WEEKDAYS,
  bulkUpsertArrivalSchedules,
  fetchArrivalSettings,
  fetchBulkArrivalScheduleStatus,
  fetchClassArrivalTimes,
} from "~/lib/student-arrival-api";
import { SchoolPeriodSelect } from "./school-period-select";
import { formatDate } from "~/lib/date-helpers";
import { schoolClassLabel } from "~/lib/school-class-label";
import { useWeekendFollowsFriday } from "~/lib/tenant-context";
import { InsetPanel } from "~/components/ui/inset-panel";

const logger = createLogger({ component: "FilteredBulkArrivalModal" });

interface FilteredBulkArrivalModalProps {
  isOpen: boolean;
  onClose: () => void;
  filter: BulkArrivalFilter;
  filterLabel: string;
  studentsInFilter: Student[];
  onSuccess?: () => void;
}

type DraftState = Record<number, string>;

/**
 * The two things a class carries (#2962): its weekly Unterrichtsschluss and
 * single dates on which the whole class arrives at another time.
 */
type ClassArrivalView = "weekly" | "day";

const CLASS_ARRIVAL_VIEWS: readonly {
  value: ClassArrivalView;
  label: string;
}[] = [
  { value: "weekly", label: "Jede Woche" },
  { value: "day", label: "An einem Tag abweichend" },
];

/** ISO weekday to the day code the class timetable is keyed by. */
const DAY_CODES: Record<number, string> = {
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
};

const NO_SCHOOL_PERIODS: readonly SchoolPeriod[] = [];

function childCountLabel(count: number): string {
  return count === 1 ? "1 Kind" : `${count} Kinder`;
}

function initialDraft(): DraftState {
  const draft: DraftState = {};
  for (const day of WEEKDAYS) {
    draft[day.value] = "";
  }
  return draft;
}

function isValidTime(value: string): boolean {
  if (value === "") return true;
  return /^\d{2}:\d{2}$/.test(value);
}

export function FilteredBulkArrivalModal({
  isOpen,
  onClose,
  filter,
  filterLabel,
  studentsInFilter,
  onSuccess,
}: FilteredBulkArrivalModalProps) {
  const { success: toastSuccess } = useToast();
  const weekendOpen = useWeekendFollowsFriday();
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const save = useFormModalPending(isOpen);
  const saving = save.pending;
  // Validation and save errors of the form (Bauart 2 Regel 5): shown in the
  // FormModal error slot, not as a toast.
  const formErrors = useApiFormError();
  const clearFormErrors = formErrors.clear;
  // „Wiederholen“ speichert den aktuellen Entwurf, nicht den vom Fehler.
  const latestSubmitRef = useRef<() => Promise<void>>(async () => undefined);
  const [
    arrivalExceptionConfirmationOpen,
    setArrivalExceptionConfirmationOpen,
  ] = useState(false);
  const [lastChanged, setLastChanged] = useState<string | null>(null);
  // Bewusst still: der Hinweis auf eigene Ankunftszeiten ist nur eine
  // Zusatzinfo, das Speichern hängt nicht davon ab.
  const collisionStudentIds = useMemo(
    () => studentsInFilter.map(({ id }) => id),
    [studentsInFilter],
  );
  const { data: collisionCount = 0 } = useSWRAuth(
    isOpen
      ? tenantStudentKeys.arrivalScheduleCollisions(collisionStudentIds)
      : null,
    () => fetchBulkArrivalScheduleStatus(collisionStudentIds),
    { keepPreviousData: false },
  );
  // Lessons a time can be picked by (#3372). The modal works without them, so
  // a failed read only leaves the choice out.
  const { data: arrivalSettings } = useSWRAuth(
    isOpen ? tenantStudentKeys.arrivalSettings() : null,
    fetchArrivalSettings,
  );
  const schoolPeriods = arrivalSettings?.schoolPeriods ?? NO_SCHOOL_PERIODS;
  const [view, setView] = useState<ClassArrivalView>("weekly");
  // A school class sets the class timetable once for everyone (#2414); a group
  // is not a class, so there it still sets a time per child.
  const isClassTimetable = filter.type === "school_class";
  const showDayView = isClassTimetable && view === "day";

  // Open with what the class already carries, so nobody has to retype it blind
  // or guess whether anything is set at all (#2414).
  const schoolClass =
    filter.type === "school_class" ? filter.schoolClass : null;

  const classTimes = useSWRAuth(
    isOpen && schoolClass
      ? tenantStudentKeys.classArrivalTimes(schoolClass)
      : null,
    () => fetchClassArrivalTimes(schoolClass ?? ""),
    { keepPreviousData: false },
  );
  const classTimesLoad = useSwrResourceLoadError(
    [classTimes],
    "die Klassenzeit",
    () => classTimes.mutate(),
  );
  // The class the draft was filled from in this opening; null = not yet.
  const [seededClass, setSeededClass] = useState<string | null>(null);
  const classTimesError = classTimesLoad.failure !== undefined;
  const classTimesLoading =
    schoolClass !== null && seededClass !== schoolClass && !classTimesError;

  useEffect(() => {
    if (!isOpen) {
      setSeededClass(null);
      return;
    }
    setDraft(initialDraft());
    setLastChanged(null);
    setView("weekly");
  }, [isOpen, schoolClass]);

  // Fill the draft once per opening, from an answer read in this opening
  // (not while it still revalidates), so later refreshes never replace
  // what is being typed.
  const classTimesData = classTimes.data;
  const classTimesValidating = classTimes.isValidating;
  useEffect(() => {
    if (
      !isOpen ||
      !schoolClass ||
      seededClass === schoolClass ||
      !classTimesData ||
      classTimesValidating
    )
      return;
    const next = initialDraft();
    for (const day of WEEKDAYS) {
      next[day.value] = classTimesData.times[DAY_CODES[day.value] ?? ""] ?? "";
    }
    setDraft(next);
    setLastChanged(classTimesData.updated_at ?? null);
    setSeededClass(schoolClass);
  }, [isOpen, schoolClass, seededClass, classTimesData, classTimesValidating]);

  const targetTitle =
    filter.type === "school_class"
      ? schoolClassLabel(filterLabel)
      : filter.type === "group"
        ? `Gruppe ${filterLabel}`
        : filterLabel;

  const hasAnyTime = useMemo(
    () => Object.values(draft).some((value) => value.trim() !== ""),
    [draft],
  );
  const hasInvalidEntry = useMemo(
    () => Object.values(draft).some((value) => !isValidTime(value)),
    [draft],
  );
  // Warum Speichern gesperrt ist; ohne Grund ist es frei (#6765).
  const blockReason = classTimesError
    ? "Laden Sie zuerst die Zeiten der Klasse neu."
    : !hasAnyTime
      ? "Tragen Sie zuerst mindestens eine Zeit ein."
      : hasInvalidEntry
        ? "Schreiben Sie jede Uhrzeit so: 14:30."
        : undefined;
  const collisionMessage = `${childCountLabel(collisionCount)} ${collisionCount === 1 ? "hat" : "haben"} eigene Ankunftszeiten. ${
    isClassTimetable
      ? "Diese Zeiten bleiben bestehen."
      : "Die gewählten Zeiten können sie ersetzen."
  }`;

  const handleSubmit = async () => {
    if (isClassTimetable && (classTimesLoading || classTimesError)) return;
    formErrors.clear();
    if (!hasAnyTime) {
      formErrors.invalid("Bitte tragen Sie mindestens eine Zeit ein.");
      return;
    }
    if (hasInvalidEntry) {
      formErrors.invalid(
        "Eine Uhrzeit stimmt nicht. Bitte schreiben Sie sie so: 14:30.",
      );
      return;
    }

    const schedules: ArrivalScheduleInput[] = WEEKDAYS.filter(
      ({ value }) => (draft[value] ?? "").trim() !== "",
    ).map(({ value }) => ({
      weekday: value,
      expected_arrival: draft[value] ?? "",
    }));

    await save.run(async (op) => {
      try {
        await bulkUpsertArrivalSchedules(filter, schedules);
        toastSuccess(
          isClassTimetable
            ? `Der Unterrichtsschluss für ${targetTitle} ist gespeichert.`
            : `Die Ankunftszeiten für ${childCountLabel(studentsInFilter.length)} aus ${targetTitle} sind gespeichert.`,
        );
        onSuccess?.();
        if (op.isCurrent()) {
          if (isClassTimetable) void classTimes.mutate();
          onClose();
        }
      } catch (err) {
        logger.error("failed to bulk upsert arrival schedules", {
          filter_type: filter.type,
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        await formErrors.show(err, {
          object: isClassTimetable ? "die Klassenzeit" : "die Ankunftszeit",
          retry: () => void latestSubmitRef.current(),
        });
      }
    });
  };
  useLayoutEffect(() => {
    latestSubmitRef.current = handleSubmit;
  });

  useEffect(() => {
    if (!isOpen) {
      setArrivalExceptionConfirmationOpen(false);
      clearFormErrors();
    }
  }, [isOpen, clearFormErrors]);

  return (
    <FormModal
      isOpen={isOpen}
      suspended={arrivalExceptionConfirmationOpen}
      onClose={onClose}
      pending={save}
      error={formErrors.error}
      title={
        showDayView
          ? `Ankunftszeit an einem Tag für ${targetTitle}`
          : isClassTimetable
            ? `Unterrichtsschluss für ${targetTitle}`
            : `Ankunftszeiten für ${targetTitle}`
      }
      size="md"
      mobilePosition="bottom"
      footer={
        <div className="flex items-center justify-end gap-2 p-4">
          {showDayView ? (
            <Button
              type="button"
              variant="outline"
              size="md"
              noTooltip="Schließt nur das Fenster, Tagesausnahmen sind schon gespeichert."
              onClick={onClose}
            >
              Schließen
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="md"
                noTooltip="Schließt nur das Fenster, nichts wird gespeichert."
                onClick={onClose}
                disabled={saving}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="success"
                size="md"
                tooltip={
                  isClassTimetable
                    ? "Speichert den Unterrichtsschluss jeder Woche für die ganze Klasse."
                    : "Speichert die Ankunftszeiten jeder Woche für alle gezeigten Kinder."
                }
                disabledReason={
                  saving || classTimesLoading ? undefined : blockReason
                }
                onClick={handleSubmit}
                disabled={
                  saving || classTimesLoading || blockReason !== undefined
                }
              >
                {saving ? "Speichern..." : "Speichern"}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {isClassTimetable ? (
          <SegmentedControl
            items={CLASS_ARRIVAL_VIEWS}
            value={view}
            onChange={setView}
            fullWidth
            ariaLabel="Klassenzeit oder Tagesabweichung"
          />
        ) : null}
        {showDayView && schoolClass ? (
          <ClassArrivalExceptionPanel
            schoolClass={schoolClass}
            classLabel={targetTitle}
            onChanged={onSuccess}
            pending={save}
            onConfirmationVisibilityChange={setArrivalExceptionConfirmationOpen}
            weekendOpen={weekendOpen}
          />
        ) : null}
        {showDayView ? null : isClassTimetable ? (
          <div className="space-y-2 text-sm text-gray-600">
            <p>Tragen Sie den Unterrichtsschluss für jeden Wochentag ein.</p>
            <p>
              Die Klassenzeit gilt, wenn ein Kind keine eigene Ankunftszeit hat.
            </p>
            <p>Die Betreuungstage der Kinder ändern sich nicht.</p>
            <p>Leere Felder bleiben unverändert.</p>
            {lastChanged ? (
              <p className="text-gray-500">
                Zuletzt geändert am {formatDate(lastChanged)}.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            Die Zeiten gelten für {childCountLabel(studentsInFilter.length)} aus{" "}
            {targetTitle}. Leere Felder bleiben unverändert.
          </p>
        )}
        {showDayView ? null : (
          <>
            {classTimesLoading ? (
              <Alert type="info" message="Klassenzeiten werden geladen." />
            ) : null}
            {classTimesError ? (
              <LoadErrorAlert error={classTimesLoad.error} />
            ) : null}
            {collisionCount > 0 ? (
              <Alert type="info" message={collisionMessage} />
            ) : null}
            <div className="space-y-2">
              {WEEKDAYS.map((day) => {
                const value = draft[day.value] ?? "";
                const invalid = !isValidTime(value);
                return (
                  <InsetPanel
                    key={day.value}
                    tone={invalid ? "danger" : "muted"}
                    framed
                    padding="compact"
                    className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-x-3 gap-y-1"
                  >
                    <FieldLabel
                      htmlFor={`bulk-arrival-${day.value}`}
                      className="mb-0 min-w-0"
                    >
                      {day.label}
                    </FieldLabel>
                    <Input
                      id={`bulk-arrival-${day.value}`}
                      type="time"
                      controlSize="compact"
                      value={value}
                      disabled={
                        isClassTimetable &&
                        (classTimesLoading || classTimesError)
                      }
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          [day.value]: event.target.value.slice(0, 5),
                        }))
                      }
                      className="disabled:cursor-not-allowed"
                    />
                    <div className="col-start-2 empty:hidden">
                      <SchoolPeriodSelect
                        id={`bulk-arrival-period-${day.value}`}
                        periods={schoolPeriods}
                        time={value}
                        ariaLabel={`${day.label}: Zeit nach Schulstunde`}
                        disabled={
                          isClassTimetable &&
                          (classTimesLoading || classTimesError)
                        }
                        onSelect={(endTime) =>
                          setDraft((prev) => ({
                            ...prev,
                            [day.value]: endTime,
                          }))
                        }
                      />
                    </div>
                    {invalid ? (
                      <span className="text-moto-red col-start-2 text-xs">
                        Format HH:MM
                      </span>
                    ) : value === "" ? (
                      <span className="col-start-2 text-xs text-gray-500 italic">
                        nicht ändern
                      </span>
                    ) : null}
                  </InsetPanel>
                );
              })}
            </div>
          </>
        )}
      </div>
    </FormModal>
  );
}
