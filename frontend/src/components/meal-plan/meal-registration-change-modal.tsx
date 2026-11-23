"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";

import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Skeleton } from "~/components/ui/skeleton";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatDate, parseISODate, toISODate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useLocalizedDatePicker } from "~/lib/hooks/use-localized-date-picker";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { useReadDraft } from "~/lib/swr/read-draft";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import { createLogger } from "~/lib/logger";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import {
  clearChildMealDay,
  getChildMealSchedule,
  replaceChildMealSchedule,
  setChildMealDay,
  type DailyMealParticipant,
} from "~/lib/meal-plan-api";

const logger = createLogger({ component: "MealRegistrationChangeModal" });

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

type ChangeScope = "day" | "regular";
// "regular" gibt den Tag an die festen Tage zurück.
type DayChoice = "eats" | "skips" | "regular";
type ScheduleState = "idle" | "loading" | "loaded" | "failed";
const NO_WEEKDAYS: readonly number[] = [];

/**
 * Die Schule ändert die Anmeldung eines Kindes, auch nach der Frist (#3873):
 * einen Tag, den Tag zurück auf die festen Tage, oder die festen Tage ab
 * einem Datum. Eltern sehen die Änderung im Elternportal.
 *
 * `initialStudentId` wählt das Kind beim Öffnen vor (Zeilenmenü der
 * Tagesliste); ohne wird das Kind erst im Fenster gewählt.
 */
export function MealRegistrationChangeModal({
  isOpen,
  onClose,
  onSaved,
  date,
  participants,
  others,
  initialStudentId,
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  /** After a saved change, with the child it changed. */
  onSaved: (studentId: string) => void;
  date: string;
  participants: readonly DailyMealParticipant[];
  others: readonly DailyMealParticipant[];
  initialStudentId?: string;
}>) {
  const t = useCareTermTranslations("mealParticipantList");
  const locale = useLocale();
  const today = useBerlinToday();
  const datePicker = useLocalizedDatePicker();
  const { success } = useToast();
  const { error, show: showError, clear: clearError } = useApiFormError();
  const [studentId, setStudentId] = useState("");
  const [scope, setScope] = useState<ChangeScope>("day");
  const [choice, setChoice] = useState<DayChoice | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(date);
  const submission = useFormModalPending(isOpen);
  const saving = submission.pending;

  const eating = useMemo(
    () => new Set(participants.map((child) => child.studentId)),
    [participants],
  );
  const options = useMemo(
    () =>
      [...participants, ...others]
        .sort(
          (a, b) =>
            a.lastName.localeCompare(b.lastName, locale) ||
            a.firstName.localeCompare(b.firstName, locale),
        )
        .map((child) => ({
          value: child.studentId,
          // Name, Klasse und ob das Kind isst; das Muster hat keine Wörter.
          label: [
            `${child.lastName}, ${child.firstName}`,
            child.schoolClass || "–",
            eating.has(child.studentId) ? t("eats") : t("skips"),
          ].join(" · "),
        })),
    [eating, locale, others, participants, t],
  );

  // Die festen Tage des gewählten Kindes vorbelegen. Bis sie da sind, bleiben
  // die Tage leer und Speichern gesperrt, damit nie die Tage eines anderen
  // Kindes gespeichert werden. Ein Wiederöffnen zeigt den gemerkten Stand und
  // liest beim Öffnen nach. Die Tage, die jemand ändert, behalten die
  // Version, auf der er sie geändert hat; das Speichern schickt genau diese,
  // und der Server lehnt veraltete Tage ab (ADR 0311).
  const scheduleKey =
    isOpen && studentId
      ? tenantContactKeys.childMealSchedule(studentId, effectiveFrom)
      : null;
  const schedule = useReadDraft({
    key: scheduleKey,
    fetcher: () => getChildMealSchedule(studentId, effectiveFrom),
    token: (read) => read.version,
    toDraft: (read): readonly number[] => read.weekdays,
  });
  // Auch über gemerkten Tagen: bis ein Lesen gelingt, geht nichts raus.
  const scheduleError = useReadDraftLoadError(
    schedule,
    t("errorObjectSchedule"),
  );
  const scheduleState: ScheduleState =
    scheduleKey === null
      ? "idle"
      : schedule.status === "loadFailed"
        ? "failed"
        : schedule.base && schedule.canSubmit
          ? "loaded"
          : "loading";
  const weekdays = schedule.draft ?? NO_WEEKDAYS;
  const toggleWeekday = (weekday: number) => {
    if (scheduleKey === null || scheduleState !== "loaded") return;
    schedule.setDraft((current) =>
      current.includes(weekday)
        ? current.filter((value) => value !== weekday)
        : [...current, weekday].sort((a, b) => a - b),
    );
  };

  // Die Vorbelegung liest, wer an dem Tag isst, ohne das Fenster bei jedem
  // Neuladen der Tagesliste zurückzusetzen.
  const eatingRef = useRef(eating);
  useLayoutEffect(() => {
    eatingRef.current = eating;
  });

  useEffect(() => {
    if (!isOpen) return;
    const start = date < today ? today : date;
    setScope("day");
    setEffectiveFrom(start);
    clearError();
    if (initialStudentId) {
      setStudentId(initialStudentId);
      setChoice(eatingRef.current.has(initialStudentId) ? "skips" : "eats");
      return;
    }
    setStudentId("");
    setChoice(null);
  }, [clearError, date, initialStudentId, isOpen, today]);

  function chooseChild(child: string) {
    setStudentId(child);
    setChoice(eating.has(child) ? "skips" : "eats");
  }

  // Die Schule legt feste Tage höchstens ein Jahr im Voraus fest.
  const latestStart = useMemo(() => {
    const date = parseISODate(today);
    date.setDate(date.getDate() + 365);
    return toISODate(date);
  }, [today]);
  const ready =
    studentId !== "" &&
    (scope === "day"
      ? choice !== null
      : effectiveFrom >= today &&
        effectiveFrom <= latestStart &&
        scheduleState === "loaded");
  const childName = useMemo(() => {
    const child = [...participants, ...others].find(
      (candidate) => candidate.studentId === studentId,
    );
    return child ? `${child.firstName} ${child.lastName}` : "";
  }, [others, participants, studentId]);

  async function sendChange(): Promise<
    | { ok: true }
    | { ok: false; error: unknown; reload?: () => Promise<unknown> }
  > {
    if (scope === "regular") {
      return schedule.submit((version, days) =>
        replaceChildMealSchedule(studentId, [...days], effectiveFrom, version),
      );
    }
    try {
      if (choice === "regular") await clearChildMealDay(studentId, date);
      else await setChildMealDay(studentId, date, choice === "eats");
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  async function save() {
    if (!ready) return;
    clearError();
    await submission.run(async (op) => {
      const sent = await sendChange();
      if (!sent.ok) {
        const cause = sent.error;
        logger.error("meal_registration_change_failed", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        if (!op.isCurrent()) return;
        // Someone changed the regular days since they were read: the
        // stored days show again, the message waits for them and offers
        // no retry of the same request.
        void showError(cause, {
          object: t("errorObjectChange"),
          reload: sent.reload,
        });
        return;
      }
      success(t("changeSaved", { name: childName }));
      onSaved(studentId);
      // Eine späte Antwort schließt keinen inzwischen neuen Dialog (#6533).
      if (op.isCurrent()) onClose();
    });
  }

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("changeTitle")}
      size="md"
      pending={submission}
      isBackdropDismissDisabled
      error={error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          disabled={!ready}
        />
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-gray-600">{t("changeHint")}</p>
        <CustomSelect
          label={t("child")}
          value={studentId}
          options={options}
          onChange={chooseChild}
          placeholder={t("childPlaceholder")}
        />
        <SegmentedControl<ChangeScope>
          items={[
            {
              value: "day",
              label: t("scopeDay", { date: formatDate(date, false, locale) }),
            },
            { value: "regular", label: t("scopeRegular") },
          ]}
          value={scope}
          onChange={setScope}
          ariaLabel={t("scopeAria")}
          fullWidth
        />
        {scope === "day" ? (
          <SegmentedControl<DayChoice>
            items={[
              { value: "eats", label: t("eats") },
              { value: "skips", label: t("skips") },
              { value: "regular", label: t("asRegular") },
            ]}
            value={choice}
            onChange={setChoice}
            ariaLabel={t("choiceAria")}
            fullWidth
          />
        ) : (
          <div className="space-y-3">
            {/* Nach einer Ablehnung nennt die Meldung oben das gescheiterte
                Lesen schon, mit „Wiederholen“. */}
            {scheduleError && !(scope === "regular" && error) ? (
              <LoadErrorAlert error={scheduleError} />
            ) : null}
            <fieldset disabled={scheduleState !== "loaded"}>
              <legend className="text-sm font-medium text-gray-700">
                {t("regularDays")}
              </legend>
              {/* Bis die festen Tage da sind, stehen Platzhalter an ihrer
                  Stelle: kein Ladetext, und kein Tag, der falsch leer wirkt. */}
              {scheduleState === "loading" ? (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <span className="sr-only" role="status">
                    {t("scheduleLoading")}
                  </span>
                  {WEEKDAYS.map((weekday) => (
                    <Skeleton
                      key={weekday}
                      shape="control"
                      className="h-11"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {WEEKDAYS.map((weekday) => (
                    <ChoiceTile
                      key={weekday}
                      selected={weekdays.includes(weekday)}
                      className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm font-medium"
                    >
                      <Checkbox
                        checked={weekdays.includes(weekday)}
                        onChange={() => toggleWeekday(weekday)}
                      />
                      {t(`weekday${weekday}`)}
                    </ChoiceTile>
                  ))}
                </div>
              )}
            </fieldset>
            <ISODatePicker
              label={t("effectiveFrom")}
              value={effectiveFrom}
              onChange={setEffectiveFrom}
              min={today}
              max={latestStart}
              hideClearButton
              required
              {...datePicker}
            />
          </div>
        )}
      </div>
    </FormModal>
  );
}
