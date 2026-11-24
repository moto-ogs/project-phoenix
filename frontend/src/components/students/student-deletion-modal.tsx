"use client";

import type {
  Counts,
  studentDeleteImpactResponse,
} from "~/lib/contract/students.generated";
import { Database } from "lucide-react";
import { ApiError } from "~/lib/api-error";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { useEffect, useMemo, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useApiFormError } from "~/contexts/ToastContext";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { InfoSection } from "~/components/ui/info-section";
import { InfoText } from "~/components/ui/detail-modal-components";
import {
  deleteStudentWithData,
  fetchStudentDeletionImpact,
  type StudentDeletionReason,
} from "~/lib/student-api";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useReadDraft } from "~/lib/swr/read-draft";
import { tenantStudentKeys } from "~/lib/swr/tenant-student-keys";
import { permissionsConcept } from "~/lib/concepts/permissions";

const logger = createLogger({ component: "StudentDeletionModal" });

const COUNT_LABELS: Record<keyof Counts, string> = {
  timetable_assignments: "Stundenplan-Zuordnungen",
  activity_enrollments: "Angebotsanmeldungen",
  attendance_records: "Anwesenheits- und Statusdaten",
  care_schedules: "Ankunfts- und Abholpläne",
  guardian_links: "Verknüpfungen zu Erziehungsberechtigten",
  companion_links: "Laufgemeinschaften",
  communications: "Nachrichten und Änderungsanfragen",
  consents: "Einwilligungen",
  enrollment_references: "Von Anmeldungen gelöste Verknüpfungen",
  other_records: "Weitere kindbezogene Datensätze",
};

const REASON_OPTIONS: ReadonlyArray<{
  value: StudentDeletionReason | "";
  label: string;
}> = [
  { value: "", label: "Bitte auswählen" },
  { value: "test_data", label: "Testdaten" },
  { value: "incorrect_entry", label: "Fehlerhafte Erfassung" },
  { value: "duplicate", label: "Doppelter Datensatz" },
  { value: "privacy_request", label: "Datenschutz-/Löschanfrage" },
];

// Zusätzlicher Grund für Kinder, deren Betreuung beendet ist (#2487). Er
// steht nur dort zur Wahl: bei einem Kind, das noch betreut wird, läuft keine
// Aufbewahrungsfrist, und der Grund wäre eine falsche Angabe im Protokoll.
const RETENTION_REASON_OPTION = {
  value: "retention_expired" as StudentDeletionReason,
  label: "Aufbewahrungsfrist abgelaufen",
};

interface StudentDeletionModalProps {
  readonly isOpen: boolean;
  readonly studentId: string;
  readonly displayName: string;
  readonly completionId?: string;
  /** Die Betreuung dieses Kindes ist beendet — nur dann gibt es den Grund
   *  "Aufbewahrungsfrist abgelaufen" (#2487). */
  readonly careEnded?: boolean;
  /** Aus einer offenen Abmeldung heraus: das Kind wird sofort gelöscht, ein
   *  späterer letzter Betreuungstag wird nicht abgewartet (#2434). */
  readonly skipsLastCareDay?: boolean;
  readonly onClose: () => void;
  /** Closes the dialog and updates the shown lists; a reload goes through
   *  `useRefreshAfterWrite` and never rejects (#6652). */
  readonly onDeleted: () => void | ReturnType<RefreshAfterWrite>;
}

// Endgültiges Löschen eines Kindes (#3110): Vorschau der Folgen, Löschgrund
// und Bestätigungshaken liegen im Dialog. Das zweistufige Gate verlangt nach
// diesen Voraussetzungen eine weitere bewusste Löschbestätigung.
export function StudentDeletionModal({
  isOpen,
  studentId,
  displayName,
  completionId,
  careEnded = false,
  skipsLastCareDay = false,
  onClose,
  onDeleted,
}: StudentDeletionModalProps) {
  const [reason, setReason] = useState<StudentDeletionReason | "">("");
  const [deleting, setDeleting] = useState(false);
  const errors = useApiFormError();
  const clearErrors = errors.clear;
  // Bumped after a 409 so the dialog returns to its first confirmation step.
  const [gateReset, setGateReset] = useState(0);
  // The impact the person confirms (ADR 0311): each opening reads it again
  // (the cached one shows meanwhile) and follows a newer read until the
  // person acknowledges it; the acknowledgement is the draft. From then on
  // it stays fixed, and the delete carries its fingerprint. After a 409 the
  // stored impact shows without the acknowledgement; nothing is sent until
  // it is read.
  const preview = useReadDraft<
    studentDeleteImpactResponse,
    boolean,
    string,
    unknown
  >({
    key: isOpen
      ? tenantStudentKeys.deletionImpact(studentId, completionId)
      : null,
    fetcher: () => fetchStudentDeletionImpact(studentId, completionId),
    token: (shown) => shown.fingerprint,
    toDraft: () => false,
    // The dialog closes after a deletion: no read of the old impact.
    answer: (_saved, shown) => shown,
  });
  const previewError = useReadDraftLoadError(
    preview,
    "die Vorschau der Löschung",
  );
  const previewFailed = preview.status === "loadFailed";
  const impact = previewFailed ? null : (preview.base ?? null);
  const acknowledged = preview.draft === true;
  const setAcknowledged = (value: boolean) => preview.setDraft(value);
  const loadingPreview =
    isOpen &&
    !previewFailed &&
    (preview.status === "loading" ||
      preview.status === "refused" ||
      preview.status === "reloading");

  useEffect(() => {
    if (isOpen) return;
    setReason("");
    clearErrors();
  }, [clearErrors, isOpen]);

  const countRows = useMemo(() => {
    if (!impact) return [];
    return (Object.keys(COUNT_LABELS) as Array<keyof Counts>)
      .map((key) => ({
        key,
        label: COUNT_LABELS[key],
        value: impact.counts[key],
      }))
      .filter((row) => row.value > 0);
  }, [impact]);

  const reasonOptions = useMemo(
    () =>
      careEnded ? [...REASON_OPTIONS, RETENTION_REASON_OPTION] : REASON_OPTIONS,
    [careEnded],
  );

  const prerequisitesMet = Boolean(impact && reason && acknowledged);

  const handleDelete = async () => {
    if (!impact || !reason || !acknowledged || !preview.canSubmit) return;
    setDeleting(true);
    errors.clear();
    const result = await preview.submit((fingerprint, shown) =>
      shown
        ? deleteStudentWithData(
            studentId,
            {
              expected_fingerprint: fingerprint,
              confirmation_name: impact.confirmation_name,
              reason,
              acknowledged: true as const,
            },
            completionId,
          )
        : Promise.reject(new Error("deletion not acknowledged")),
    );
    if (!result.ok) {
      const deleteError = result.error;
      logger.error("student_delete_failed", {
        student_id: studentId,
        status:
          deleteError instanceof ApiError ? deleteError.status : undefined,
        error:
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
      });
      // The backend re-checks the preview under a row lock. A 409 means the
      // person must see a fresh impact before confirming again: `reload`
      // shows it without the acknowledgement, and the dialog remounts
      // (`key` below), which returns the two-step gate to its first step.
      if (result.refused) setGateReset((count) => count + 1);
      // Kein „Wiederholen“: ein erneutes Löschen geht wieder durch beide
      // Bestätigungsschritte, nicht über einen Knopf im Fehlerkasten.
      await errors.show(deleteError, {
        object: "die Löschung",
        reload: result.reload,
      });
      setDeleting(false);
      return;
    }
    setDeleting(false);
    // The deletion holds. A failed refresh of the lists is the caller's load
    // error, never a failed deletion with a retry that can only answer 404
    // (#6652).
    await onDeleted();
  };

  return (
    <ConfirmDeleteModal
      key={gateReset}
      isOpen={isOpen}
      title={`${displayName} löschen`}
      description={
        <Alert
          type="warning"
          message={`${displayName} wird dauerhaft entfernt. Die unten aufgeführten Daten werden je nach Art gelöscht oder vom Kind gelöst.${
            skipsLastCareDay
              ? " Das Kind wird sofort gelöscht. Auch ein späterer letzter Betreuungstag wird nicht abgewartet."
              : ""
          } Dieser Schritt kann nicht rückgängig gemacht werden.`}
        />
      }
      warningSlot={
        <div className="space-y-4">
          {/* After a refusal the form's alert already names the failed read. */}
          {previewFailed && !errors.error ? (
            <LoadErrorAlert error={previewError} />
          ) : null}
          {loadingPreview ? (
            <p className="text-sm text-gray-500">
              Auswirkungen werden geladen…
            </p>
          ) : null}

          {impact ? (
            <>
              <InfoSection
                title={`Was wird gelöscht oder gelöst? (${impact.total})`}
                icon={<Database className="h-full w-full" strokeWidth={2} />}
              >
                {countRows.length > 0 ? (
                  <DataGrid>
                    {countRows.map((row) => (
                      <DataField key={row.key} label={row.label}>
                        {row.value}
                      </DataField>
                    ))}
                  </DataGrid>
                ) : (
                  <InfoText>
                    Keine weiteren verknüpften Daten gefunden.
                  </InfoText>
                )}
              </InfoSection>

              <InfoSection
                title="Was bleibt erhalten?"
                icon={
                  <MotoConceptIcon concept={permissionsConcept} size="100%" />
                }
              >
                <InfoText>
                  Elternkonten und Profile der Erziehungsberechtigten, andere
                  Kinder sowie gemeinsam genutzte Stundenplan-Termine bleiben
                  bestehen. Anmeldungen und Zugriffsprotokolle bleiben erhalten
                  und verlieren nur die Kindzuordnung.
                </InfoText>
              </InfoSection>

              <CustomSelect
                label="Löschgrund"
                id="student-deletion-reason"
                value={reason}
                options={reasonOptions}
                onChange={(value) =>
                  setReason(value as StudentDeletionReason | "")
                }
                disabled={deleting}
                required
              />

              <ChoiceTile
                htmlFor="student-deletion-acknowledgement"
                disabled={deleting}
                tone="red"
                selected={acknowledged}
                className="items-start p-4 font-normal"
              >
                <Checkbox
                  id="student-deletion-acknowledgement"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={deleting}
                />
                <span>
                  Ich habe geprüft, welche Daten entfernt werden, und möchte das
                  Kind dauerhaft löschen.
                </span>
              </ChoiceTile>
            </>
          ) : null}
        </div>
      }
      gate={{ mode: "twoStep" }}
      confirmDisabled={
        loadingPreview || !prerequisitesMet || !preview.canSubmit
      }
      confirmLabel="Kind endgültig löschen"
      onConfirm={handleDelete}
      onClose={onClose}
      loading={deleting}
      error={errors.error}
    />
  );
}
