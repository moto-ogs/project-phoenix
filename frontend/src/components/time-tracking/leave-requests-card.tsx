"use client";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { StatCard } from "~/components/ui/stat-card";
import { Button } from "~/components/ui/button";
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
import { absenceDisplayLabel } from "~/lib/time-tracking-helpers";
import { timeTrackingService } from "~/lib/time-tracking-api";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import { staffAbsenceKeys } from "~/lib/swr/staff-keys";
import { timeTrackingKeys } from "~/lib/swr/portal-keys";
import { mapOwnAbsence, type OwnAbsence } from "~/lib/own-time-tracking-view";
import { useOwnTimeRefresh } from "~/lib/hooks/use-own-time-refresh";
import { OwnAllowancesCard } from "./own-allowances-card";
import { ApiError } from "~/lib/api-error";
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

function dayCountFor(a: OwnAbsence): number {
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

async function readLeave(year: number) {
  const overview = await timeTrackingService.getLeaveOverview();
  if (overview.year !== year) {
    throw new ApiError("Own leave year changed", undefined, {
      code: "general.unavailable",
    });
  }
  return {
    ...overview,
    recent: (overview.recent ?? []).map(mapOwnAbsence),
    questions: (overview.questions ?? []).map(mapOwnAbsence),
  };
}

export function LeaveRequestsCard() {
  const currentTimestamp = useCurrentTimestamp();
  const [modalOpen, setModalOpen] = useState(false);
  const toast = useToast();
  const cancelErrors = useApiFormError();
  const today = useBerlinToday();
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const refresh = useOwnTimeRefresh();
  const read = useSWRAuth(
    timeTrackingKeys.leaveOverview(year),
    () => readLeave(year),
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
    },
  );
  const { data, error, mutate } = read;
  const afterWrite = useRefreshAfterWrite("die Urlaubsübersicht", async () => {
    await refresh("leave");
    const failure = read.readCurrent?.().error;
    if (failure) throw failure;
  });
  const loadError = useSwrLoadError(
    afterWrite.error ? undefined : error,
    "die Urlaubsübersicht",
    mutate,
  );
  const refreshAfterWrite = afterWrite.refresh;

  const quota = data?.quota;
  const loading = data === undefined && error === undefined;
  const counts = data?.counts ?? {
    reserved: 0,
    question: 0,
    approved: 0,
    declined: 0,
  };
  const recentVacations = data?.recent ?? [];
  const sortedQuestionedVacations = data?.questions ?? [];
  const waiting = recentVacations
    .filter((vacation) => vacation.status === "requested")
    .map((vacation) => `${vacation.id}-${vacation.requestedAt}`)
    .sort();
  const requestMails = useOwnAbsenceRequestMails(waiting, data?.mails);

  const absences = useSWRAuth(
    modalOpen ? staffAbsenceKeys.ownList(yearStart, yearEnd) : null,
    () => timeTrackingService.getAbsences(yearStart, yearEnd),
    { keepPreviousData: false },
  );
  const overlapLoadError = useSwrLoadError(
    absences.error,
    "deine Abwesenheiten für den Kalender",
    absences.mutate,
  );
  const blockingVacations = useMemo(() => {
    if (!absences.data) return undefined;
    return Array.from(
      new Map(
        [...absences.data, ...(data?.questions ?? [])].map((vacation) => [
          vacation.id,
          vacation,
        ]),
      ).values(),
    );
  }, [absences.data, data]);

  const [cancelTarget, setCancelTarget] = useState<OwnAbsence | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const handleCancel = (absence: OwnAbsence) => {
    cancelErrors.clear();
    setCancelTarget(absence);
  };

  const handleResubmitted = useCallback(() => {
    dispatchAbsencesRefresh();
    void refreshAfterWrite();
  }, [refreshAfterWrite]);

  const confirmCancel = async () => {
    if (!cancelTarget || error) return;
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
        description="Urlaubsanträge stellen, Status verfolgen und stornieren."
        // Ohne shrink-0 staucht die Flex-Spalte der Seite die Karte auf die
        // Kopfhöhe: unten fehlt der Innenabstand und die Kacheln (#4363).
        className="shrink-0"
        actions={
          // min-h-13 ist die Höhe von Titel und Untertitel; so steht der
          // Knopf auf deren Mitte statt an der Oberkante.
          <div className="flex items-center sm:min-h-13">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setModalOpen(true)}
              disabled={loading || error !== undefined}
              tooltip="Öffnet ein Formular für einen neuen Urlaubsantrag."
            >
              Urlaub beantragen
            </Button>
          </div>
        }
        bodyClassName="compact:mt-4 mt-5 max-sm:mt-4"
      >
        <LoadErrorAlert
          error={afterWrite.error ?? (error ? loadError : null)}
        />
        {(data || loading) && (
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
                      disabled={error !== undefined}
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
                      disabled={error !== undefined}
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

      {data && (
        <OwnAllowancesCard allowances={data.allowances ?? []} year={year} />
      )}

      {modalOpen && (
        <VacationRequestModal
          isOpen
          onClose={() => setModalOpen(false)}
          onSubmitted={() => {
            void refreshAfterWrite();
          }}
          remainingDays={remainingDays}
          existingVacations={
            absences.error || error ? undefined : blockingVacations
          }
          overlapError={overlapLoadError ?? afterWrite.error ?? loadError}
        />
      )}

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
  disabled,
  mailCounts,
}: {
  readonly absence: OwnAbsence;
  readonly currentTimestamp: number;
  readonly onCancel: (absence: OwnAbsence) => void;
  readonly onResubmitted?: () => void;
  readonly showResubmit?: boolean;
  readonly disabled: boolean;
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
    <li className="moto-content-surface rounded-xl border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">
            {absence.absenceType !== "vacation" && (
              <span className="mr-2">{absenceDisplayLabel(absence)} ·</span>
            )}
            {formatRange(absence.dateStart, absence.dateEnd)}
            <span className="ml-2 text-xs text-gray-500">
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
        <div className="flex items-center gap-3">
          <StatusColorBadge label={meta.label} color={meta.color} />
          {cancelable && (
            <Button
              type="button"
              variant="ghost_danger"
              size="compact"
              disabled={disabled}
              onClick={() => onCancel(absence)}
              tooltip="Zieht den Antrag zurück, auch genehmigten Urlaub. moto fragt vorher nach."
            >
              Stornieren
            </Button>
          )}
        </div>
      </div>
      {!disabled && showResubmit && onResubmitted && (
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
  readonly absence: OwnAbsence;
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
