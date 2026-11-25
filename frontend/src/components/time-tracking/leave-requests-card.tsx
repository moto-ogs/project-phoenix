"use client";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { StatCard } from "~/components/ui/stat-card";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { TOUCH_HIT_AREA } from "~/components/ui/button-styles";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionCard } from "~/components/ui/section-card";
import { StatusColorBadge } from "~/components/ui/status-color-badge";
import { Textarea } from "~/components/ui/textarea";
import { SectionLabel } from "~/components/ui/section-label";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import {
  absenceStatusMeta,
  dayCountFor as sharedDayCountFor,
  dispatchAbsencesRefresh,
  formatAbsenceRange,
  formatDayCount,
} from "~/lib/absence-helpers";
import { createLogger } from "~/lib/logger";
import {
  absenceDisplayLabel,
  type StaffAbsence,
} from "~/lib/time-tracking-helpers";
import { timeTrackingService } from "~/lib/time-tracking-api";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import { VacationRequestModal } from "./vacation-request-modal";
import {
  AbsenceRequestMails,
  useOwnAbsenceRequestMails,
} from "~/components/staff/absence-mail-status";
import type { MailOutcomeCounts } from "~/lib/email-delivery-status";
import { useCurrentTimestamp } from "~/lib/hooks/use-current-timestamp";

const logger = createLogger({ component: "LeaveRequestsCard" });

function formatRange(start: string, end: string): string {
  return formatAbsenceRange(start, end);
}

/**
 * App: kurzer Zeitraum („21.09.–13.10.2026“), damit er auch am kleinen
 * Telefon in eine Zeile passt. Über Jahresgrenzen bleibt die lange Form.
 */
function formatRangeShort(start: string, end: string): string {
  const [sy, sm, sd] = start.slice(0, 10).split("-");
  const [ey, em, ed] = end.slice(0, 10).split("-");
  if (!sy || !ey || sy !== ey) return formatRange(start, end);
  if (start.slice(0, 10) === end.slice(0, 10)) return `${sd}.${sm}.${sy}`;
  return `${sd}.${sm}.–${ed}.${em}.${ey}`;
}

function dayCountFor(a: StaffAbsence): number {
  return sharedDayCountFor({
    workingDays: a.workingDays,
    dateStart: a.dateStart,
    dateEnd: a.dateEnd,
    halfDay: a.halfDay,
    startHalfDay: a.startHalfDay,
    endHalfDay: a.endHalfDay,
    hasBoundaryFields: true,
  });
}

function statusMeta(status: string) {
  return absenceStatusMeta(status, { requestedLabel: "Wartet auf Antwort" });
}

function decisionNoteLabel(status: string): string {
  if (status === "question" || status === "canceled") {
    return "Rückfrage der Leitung:";
  }
  if (status === "requested") {
    return "Vorherige Rückfrage der Leitung:";
  }
  return "Anmerkung der Leitung:";
}

/** Urlaub und jeder Antrag einer beantragbaren eigenen Art (#4710). */
function isRequestFlowAbsence(absence: StaffAbsence): boolean {
  return (
    absence.absenceType === "vacation" ||
    (Boolean(absence.absenceTypeId) && absence.status !== "reported")
  );
}

export function LeaveRequestsCard({
  app = false,
}: {
  /**
   * App (#8070): Zahlen und Anträge als Liste in der Karte statt Kacheln
   * und Karten in der Karte; Zahlen ohne Antrag bleiben weg.
   */
  readonly app?: boolean;
} = {}) {
  const currentTimestamp = useCurrentTimestamp();
  const [modalOpen, setModalOpen] = useState(false);
  const toast = useToast();
  const cancelErrors = useApiFormError();

  const today = useBerlinToday();
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const quotaResource = useSWRAuth(
    staffAbsenceKeys.ownVacationQuota(year),
    () => timeTrackingService.getVacationQuota(year),
  );
  const absencesResource = useSWRAuth(
    staffAbsenceKeys.ownList(yearStart, yearEnd),
    () => timeTrackingService.getAbsences(yearStart, yearEnd),
  );
  const questionsResource = useSWRAuth(staffAbsenceKeys.ownQuestioned(), () =>
    timeTrackingService.getQuestionedAbsences(),
  );
  const { mutate: mutateQuota } = quotaResource;
  const { mutate: mutateAbsences } = absencesResource;
  const { mutate: mutateQuestions } = questionsResource;
  const loadAll = useCallback(
    () =>
      Promise.all([mutateQuota(), mutateAbsences(), mutateQuestions()]).then(
        () => undefined,
      ),
    [mutateQuota, mutateAbsences, mutateQuestions],
  );
  // A failed load stays in the card (#2514): without the quota the tiles
  // would read as "0 Tage", which is wrong, not empty.
  const load = useSwrResourceLoadError(
    [quotaResource, absencesResource, questionsResource],
    "die Urlaubsübersicht",
    loadAll,
  );
  const afterWrite = useRefreshAfterWrite("die Urlaubsübersicht", () =>
    Promise.all([
      mutateQuota(timeTrackingService.getVacationQuota(year), {
        revalidate: false,
      }),
      mutateAbsences(timeTrackingService.getAbsences(yearStart, yearEnd), {
        revalidate: false,
      }),
      mutateQuestions(timeTrackingService.getQuestionedAbsences(), {
        revalidate: false,
      }),
    ]),
  );
  const refreshAfterWrite = afterWrite.refresh;
  const quota = quotaResource.data ?? null;
  const loading =
    !load.failure &&
    (quotaResource.data === undefined ||
      absencesResource.data === undefined ||
      questionsResource.data === undefined);
  // Neben Urlaub laufen Anträge beantragbarer Arten hier mit (#4710): alles,
  // was nicht direkt eingetragen ist.
  const vacations = useMemo(
    () => (absencesResource.data ?? []).filter(isRequestFlowAbsence),
    [absencesResource.data],
  );
  const questionedVacations = useMemo(
    () =>
      (questionsResource.data ?? []).filter(
        (a) => isRequestFlowAbsence(a) && a.status === "question",
      ),
    [questionsResource.data],
  );

  const counts = useMemo(() => {
    const reserved = vacations.filter((v) => v.status === "requested").length;
    const question = questionedVacations.length;
    const approved = vacations.filter(
      (v) =>
        (v.status === "approved" || v.status === "reported") &&
        v.dateEnd >= today,
    ).length;
    const declined = vacations.filter((v) => v.status === "declined").length;
    return { reserved, question, approved, declined };
  }, [questionedVacations.length, vacations, today]);

  const recentVacations = useMemo(
    () =>
      vacations
        .filter((vacation) => vacation.status !== "question")
        .sort(
          (a, b) =>
            new Date(b.requestedAt ?? b.dateStart).getTime() -
            new Date(a.requestedAt ?? a.dateStart).getTime(),
        )
        .slice(0, 8),
    [vacations],
  );

  // Ob die Leitung die wartenden Anträge per Mail bekam (#7058).
  const waitingIds = useMemo(
    () =>
      vacations
        .filter((vacation) => vacation.status === "requested")
        .map((vacation) => vacation.id)
        .sort(),
    [vacations],
  );
  const requestMails = useOwnAbsenceRequestMails(waitingIds);

  const sortedQuestionedVacations = useMemo(
    () =>
      questionedVacations
        .slice()
        .sort(
          (a, b) =>
            new Date(b.requestedAt ?? b.dateStart).getTime() -
            new Date(a.requestedAt ?? a.dateStart).getTime(),
        ),
    [questionedVacations],
  );

  const blockingVacations = useMemo(
    () =>
      Array.from(
        new Map(
          [...vacations, ...questionedVacations].map((vacation) => [
            vacation.id,
            vacation,
          ]),
        ).values(),
      ),
    [questionedVacations, vacations],
  );

  const [cancelTarget, setCancelTarget] = useState<StaffAbsence | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const handleCancel = (absence: StaffAbsence) => {
    cancelErrors.clear();
    setCancelTarget(absence);
  };

  const handleResubmitted = useCallback(() => {
    dispatchAbsencesRefresh();
    void refreshAfterWrite();
  }, [refreshAfterWrite]);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelSubmitting(true);
    cancelErrors.clear();
    try {
      await timeTrackingService.cancelAbsence(cancelTarget.id);
    } catch (err) {
      logger.error("cancel_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      // The dialog stays open and shows why (#2514).
      await cancelErrors.show(err, {
        object: "die Stornierung",
        retry: () => void confirmCancel(),
      });
      return;
    } finally {
      setCancelSubmitting(false);
    }
    toast.success("Der Antrag ist storniert.");
    setCancelTarget(null);
    dispatchAbsencesRefresh();
    await refreshAfterWrite();
  };

  const remainingDays = quota?.remaining_days ?? 0;

  return (
    <>
      <SectionCard
        title="Urlaub"
        description={
          app
            ? undefined
            : "Urlaubsanträge stellen, Status verfolgen und stornieren."
        }
        // Ohne shrink-0 staucht die Flex-Spalte der Seite die Karte auf die
        // Kopfhöhe: unten fehlt der Innenabstand und die Kacheln (#4363).
        className="shrink-0"
        actions={
          app ? undefined : (
            // min-h-13 ist die Höhe von Titel und Untertitel; so steht der
            // Knopf auf deren Mitte statt an der Oberkante.
            <div className="flex items-center sm:min-h-13">
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => setModalOpen(true)}
                disabled={loading || Boolean(load.failure)}
                tooltip="Öffnet ein Formular für einen neuen Urlaubsantrag."
              >
                Urlaub beantragen
              </Button>
            </div>
          )
        }
        bodyClassName={app ? "mt-3" : "compact:mt-4 mt-5 max-sm:mt-4"}
      >
        <LoadErrorAlert error={afterWrite.error} />
        {load.failure ? (
          <LoadErrorAlert error={load.error} />
        ) : app ? (
          <ul className="-mb-1 divide-y divide-gray-100">
            <AppFigureRow
              label="Resturlaub"
              hint={
                quota
                  ? `von ${quota.entitled_days + quota.carryover_days} Tagen für ${year}`
                  : undefined
              }
              value={loading ? "–" : formatDayCount(remainingDays)}
            />
            {/* Die Kacheln des Desktops, auch bei 0 (#8070, Runde 7), als
                eine Zeile statt Karten in der Karte (Runde 9). */}
            <li
              className="flex flex-wrap gap-x-1 py-3 text-sm text-gray-500 tabular-nums"
              data-app-leave-counts=""
            >
              {[
                {
                  label: "beantragt",
                  value: counts.reserved,
                  tone: counts.reserved > 0 ? "text-moto-orange-strong" : "",
                },
                ...(counts.question > 0
                  ? [
                      {
                        label: "mit Rückfrage",
                        value: counts.question,
                        tone: "text-moto-orange-strong",
                      },
                    ]
                  : []),
                {
                  label: "genehmigt",
                  value: counts.approved,
                  tone: counts.approved > 0 ? "text-moto-green-strong" : "",
                },
                { label: "abgelehnt", value: counts.declined, tone: "" },
              ].map((item, index) => (
                <span key={item.label} className="whitespace-nowrap">
                  {index > 0 ? "· " : ""}
                  <span
                    className={cn("font-semibold text-gray-900", item.tone)}
                  >
                    {loading ? "–" : item.value}
                  </span>{" "}
                  {item.label}
                </span>
              ))}
            </li>
            {sortedQuestionedVacations.map((vacation) => (
              <AbsenceRequestItem
                key={vacation.id}
                flat
                absence={vacation}
                currentTimestamp={currentTimestamp}
                onCancel={handleCancel}
                onResubmitted={handleResubmitted}
                showResubmit
              />
            ))}
            {requestMails.loadError ? (
              <li className="py-3">
                <LoadErrorAlert
                  error={requestMails.loadError}
                  actionLayout="responsive"
                />
              </li>
            ) : null}
            {recentVacations.map((vacation) => (
              <AbsenceRequestItem
                key={vacation.id}
                flat
                absence={vacation}
                currentTimestamp={currentTimestamp}
                onCancel={handleCancel}
                mailCounts={
                  vacation.status === "requested"
                    ? requestMails.mails[vacation.id]
                    : undefined
                }
              />
            ))}
            {/* App: die Aktion als breite Zeile am Ende der Liste, gut mit
                dem Daumen zu treffen, statt klein oben rechts. */}
            <li className="pt-3 pb-1">
              <Button
                type="button"
                variant="outline"
                size="md"
                className="w-full"
                onClick={() => setModalOpen(true)}
                disabled={loading}
                tooltip="Öffnet ein Formular für einen neuen Urlaubsantrag."
              >
                Urlaub beantragen
              </Button>
            </li>
          </ul>
        ) : (
          <>
            <div
              className={`grid grid-cols-2 gap-4 ${counts.question > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
            >
              <StatCard
                label="Resturlaub"
                value={loading ? "-" : `${remainingDays} Tage`}
                hint={
                  quota
                    ? `${quota.entitled_days + quota.carryover_days} Tage Anspruch für ${year}`
                    : "lädt…"
                }
                tone="neutral"
              />
              <StatCard
                label="Beantragt"
                value={loading ? "-" : String(counts.reserved)}
                hint="wartet auf Antwort"
                tone={counts.reserved > 0 ? "orange" : "gray"}
              />
              {counts.question > 0 && (
                <StatCard
                  label="Rückfrage"
                  value={String(counts.question)}
                  hint="Antwort nötig"
                  tone="orange"
                />
              )}
              <StatCard
                label="Genehmigt"
                value={loading ? "-" : String(counts.approved)}
                hint="kommende Tage"
                tone={counts.approved > 0 ? "green" : "gray"}
              />
              <StatCard
                label="Abgelehnt"
                value={loading ? "-" : String(counts.declined)}
                hint="dieses Jahr"
                tone="gray"
              />
            </div>

            {sortedQuestionedVacations.length > 0 && (
              <div className="mt-5 border-t border-gray-100 pt-5">
                <SectionLabel className="mb-3">Rückfragen</SectionLabel>
                <ul className="space-y-2">
                  {sortedQuestionedVacations.map((vacation) => (
                    <AbsenceRequestItem
                      key={vacation.id}
                      absence={vacation}
                      currentTimestamp={currentTimestamp}
                      onCancel={handleCancel}
                      onResubmitted={handleResubmitted}
                      showResubmit
                    />
                  ))}
                </ul>
              </div>
            )}

            {recentVacations.length > 0 && (
              <div className="mt-5 border-t border-gray-100 pt-5">
                <SectionLabel className="mb-3">Meine Anträge</SectionLabel>
                <LoadErrorAlert
                  error={requestMails.loadError}
                  actionLayout="responsive"
                  className="mb-3"
                />
                <ul className="space-y-2">
                  {recentVacations.map((vacation) => (
                    <AbsenceRequestItem
                      key={vacation.id}
                      absence={vacation}
                      currentTimestamp={currentTimestamp}
                      onCancel={handleCancel}
                      mailCounts={
                        vacation.status === "requested"
                          ? requestMails.mails[vacation.id]
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </SectionCard>

      <VacationRequestModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitted={() => {
          void refreshAfterWrite();
        }}
        remainingDays={remainingDays}
        existingVacations={blockingVacations}
      />

      <ConfirmationModal
        isOpen={cancelTarget !== null}
        onClose={() => !cancelSubmitting && setCancelTarget(null)}
        onConfirm={() => {
          void confirmCancel();
        }}
        title="Antrag stornieren"
        confirmText="Stornieren"
        cancelText="Behalten"
        isConfirmLoading={cancelSubmitting}
        loadingText="Wird storniert …"
        confirmVariant="danger"
      >
        {cancelTarget && (
          <div className="space-y-2 text-sm text-gray-700">
            <FormErrorAlert message={cancelErrors.error} />
            <p>Möchtest du diesen Urlaubsantrag wirklich stornieren?</p>
            <p className="text-xs text-gray-500">
              {formatRange(cancelTarget.dateStart, cancelTarget.dateEnd)}
              {cancelTarget.status === "approved" && " (bereits genehmigt)"}
            </p>
          </div>
        )}
      </ConfirmationModal>
    </>
  );
}

function AbsenceRequestItem({
  absence,
  currentTimestamp,
  onCancel,
  onResubmitted,
  showResubmit = false,
  mailCounts,
  flat = false,
}: {
  /** App: eine Zeile der Liste statt einer Karte in der Karte. */
  readonly flat?: boolean;
  readonly absence: StaffAbsence;
  readonly currentTimestamp: number;
  readonly onCancel: (absence: StaffAbsence) => void;
  readonly onResubmitted?: () => void;
  readonly showResubmit?: boolean;
  /** The notice of a waiting request to the Leitung (#7058). */
  readonly mailCounts?: MailOutcomeCounts;
}) {
  const meta = statusMeta(absence.status);
  const cancelable =
    absence.status === "requested" ||
    absence.status === "question" ||
    (absence.status === "approved" &&
      new Date(absence.dateStart).getTime() > currentTimestamp);

  return (
    <li
      className={
        flat ? "py-3" : "moto-content-surface rounded-xl border px-4 py-3"
      }
    >
      <div
        className={`flex items-center justify-between gap-3 ${
          // App: der Zustand bleibt rechts neben dem Zeitraum, statt als
          // eigene Zeile darunter zu rutschen.
          flat ? "" : "flex-wrap"
        }`}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">
            {absence.absenceType !== "vacation" && (
              <span className="mr-2">{absenceDisplayLabel(absence)} ·</span>
            )}
            {flat
              ? formatRangeShort(absence.dateStart, absence.dateEnd)
              : formatRange(absence.dateStart, absence.dateEnd)}
            <span
              className={`ml-2 text-xs text-gray-500 ${flat ? "whitespace-nowrap" : ""}`}
            >
              · {formatDayCount(dayCountFor(absence))}
            </span>
          </p>
          {absence.note && (
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {absence.note}
            </p>
          )}
          {absence.decisionNote && (
            <p className="mt-0.5 text-xs text-gray-500">
              <span className="font-medium">
                {decisionNoteLabel(absence.status)}
              </span>{" "}
              {absence.decisionNote}
            </p>
          )}
          <AbsenceRequestMails counts={mailCounts} />
        </div>
        <div className={`flex items-center gap-3 ${flat ? "shrink-0" : ""}`}>
          <StatusColorBadge label={meta.label} color={meta.color} />
          {cancelable && (
            <Button
              type="button"
              variant="ghost_danger"
              size="compact"
              className={flat ? TOUCH_HIT_AREA : undefined}
              onClick={() => onCancel(absence)}
              tooltip="Zieht den Antrag zurück, auch genehmigten Urlaub. moto fragt vorher nach."
            >
              Stornieren
            </Button>
          )}
        </div>
      </div>
      {showResubmit && onResubmitted && (
        <ResubmitAbsenceForm absence={absence} onResubmitted={onResubmitted} />
      )}
    </li>
  );
}

// Inline answer form for a Rückfrage (#1419): the MA amends their note and
// resubmits, moving the request back to "requested" for a final decision.
function ResubmitAbsenceForm({
  absence,
  onResubmitted,
}: {
  readonly absence: StaffAbsence;
  readonly onResubmitted: () => void;
}) {
  const [note, setNote] = useState(absence.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  // Fehler stehen am Formular (Alert oben, Feldfehler am Feld), nicht als
  // Toast: Bauart 2 Regel 5.
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  // „Wiederholen“ sendet die aktuelle Antwort.
  const latestSubmitRef = useRef<() => Promise<void>>(async () => undefined);
  const toast = useToast();

  const handleSubmit = async () => {
    formErrors.clear();
    if (note.trim().length < 3) {
      formErrors.invalid("Bitte prüfe das markierte Feld.", {
        note: "Bitte gib eine kurze Antwort ein.",
      });
      return;
    }
    setSubmitting(true);
    try {
      await timeTrackingService.resubmitAbsence(absence.id, note.trim());
    } catch (err) {
      logger.error("resubmit_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await formErrors.show(err, {
        object: "die Antwort",
        retry: () => void latestSubmitRef.current(),
      });
      return;
    } finally {
      setSubmitting(false);
    }
    toast.success("Deine Antwort ist gesendet.");
    onResubmitted();
  };
  useLayoutEffect(() => {
    latestSubmitRef.current = handleSubmit;
  });

  return (
    <div ref={formRef} className="mt-3 border-t border-gray-100 pt-3">
      <FormErrorAlert message={formErrors.error} className="mb-3" />
      <Textarea
        id={`resubmit-note-${absence.id}`}
        name="note"
        label="Deine Antwort"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Antwort auf die Rückfrage ergänzen…"
        error={formErrors.fieldError("note")}
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="primary"
          size="compact"
          onClick={handleSubmit}
          disabled={submitting}
          tooltip="Sendet deine Antwort sofort an die Leitung zur Entscheidung."
        >
          {submitting ? "…" : "Antwort senden & erneut einreichen"}
        </Button>
      </div>
    </div>
  );
}

/** App: eine Zahl der Urlaubskarte als Listenzeile, Wert rechts. */
function AppFigureRow({
  label,
  hint,
  value,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-base leading-6 font-medium text-gray-900">{label}</p>
        {hint ? <p className="text-sm text-gray-500">{hint}</p> : null}
      </div>
      <p className="shrink-0 text-base font-semibold text-gray-900 tabular-nums">
        {value}
      </p>
    </li>
  );
}
