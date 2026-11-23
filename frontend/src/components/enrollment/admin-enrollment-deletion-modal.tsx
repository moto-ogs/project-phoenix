"use client";

import { ShieldAlert } from "lucide-react";
import { InsetPanel } from "~/components/ui/inset-panel";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import NavigationLink from "~/components/ui/navigation-link";
import { useApiFormError } from "~/contexts/ToastContext";
import { ApiError, isChangedSinceRead } from "~/lib/api-error";
import {
  type AdminEnrollmentDeletionImpact,
  deleteAdminChild,
  deleteAdminRequest,
  getAdminChildDeleteImpact,
  getAdminRequestDeleteImpact,
} from "~/lib/enrollment-admin-api";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";

const logger = createLogger({ component: "AdminEnrollmentDeletionModal" });

const COUNT_LABELS = {
  requests: "Anmeldungen",
  request_children: "Kinder in Anmeldungen",
  request_child_offerings: "Ausgewählte Betreuungsangebote",
  request_guardians: "Weitere Erziehungsberechtigte in der Anmeldung",
  change_requests: "Änderungsanfragen",
  change_request_messages: "Nachrichten zu Änderungsanfragen",
  late_invites: "Verwendete Nachzügler-Einladungen",
  offering_adjustments: "Protokolle zu Angebotsänderungen",
  email_outbox: "Abhängige E-Mail-Outbox-Einträge",
  rollover_links_cleared: "Verknüpfungen zu Folgeanmeldungen",
  student_source_links_cleared: "Herkunftsverknüpfungen in Aktivitäten",
} as const;

type CountKey = keyof typeof COUNT_LABELS;

interface Props {
  readonly isOpen: boolean;
  readonly requestId: string;
  /** Set to delete one child; absent, the whole request is deleted. */
  readonly child?: { readonly id: string; readonly label: string };
  readonly studentHref: (studentId: string) => string;
  readonly onClose: () => void;
  readonly onDeleted: (impact: AdminEnrollmentDeletionImpact) => void;
}

export function AdminEnrollmentDeletionModal({
  isOpen,
  requestId,
  child,
  studentHref,
  onClose,
  onDeleted,
}: Props) {
  const childId = child?.id;
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const errors = useApiFormError();
  const clearErrors = errors.clear;
  // „Wiederholen“ löscht mit dem aktuellen Grund, nicht dem vom Fehler.
  const latestDeleteRef = useRef<() => Promise<void>>(async () => undefined);

  // A reopened dialog may show the cached preview while it reads again; the
  // deletion sends the fingerprint of the preview on screen, and the server
  // refuses it when the impact changed meanwhile (ADR 0311).
  const readImpact = () =>
    childId
      ? getAdminChildDeleteImpact(requestId, childId)
      : getAdminRequestDeleteImpact(requestId);
  const impactRead = useSWRAuth(
    isOpen
      ? childId
        ? enrollmentKeys.childDeleteImpact(requestId, childId)
        : enrollmentKeys.requestDeleteImpact(requestId)
      : null,
    readImpact,
  );
  // Reads the preview again after a refusal; a failure comes back, so the
  // dialog names it instead of claiming the new preview is shown.
  const adoptCurrentImpact = async (): Promise<{ error: unknown } | null> => {
    try {
      await impactRead.mutate(readImpact(), { revalidate: false });
      return null;
    } catch (error) {
      logger.warn("enrollment_delete_preview_read_failed", {
        error: error instanceof Error ? error.message : String(error),
        request_id: requestId,
        child_id: childId,
      });
      return { error };
    }
  };
  // A failed load shows the error, not the earlier preview.
  const impact = impactRead.error ? undefined : impactRead.data;
  const previewError = useSwrResourceLoadError(
    [{ data: impact, error: impactRead.error }],
    "die Vorschau der Löschung",
    () => impactRead.mutate(),
  );
  const loadingPreview = isOpen && !impact && !previewError.failure;

  useEffect(() => {
    if (isOpen) return;
    setReason("");
    clearErrors();
  }, [isOpen, clearErrors]);

  const countRows = useMemo(() => {
    if (!impact) return [];
    return (Object.keys(COUNT_LABELS) as CountKey[])
      .map((key) => ({
        key,
        label: COUNT_LABELS[key],
        value: impact.counts[key],
      }))
      .filter((row) => row.value > 0);
  }, [impact]);

  const trimmedReason = reason.trim();
  const reasonValid =
    [...trimmedReason].length >= 3 && [...trimmedReason].length <= 500;
  const confirmDisabled =
    loadingPreview || deleting || !impact?.can_delete || !reasonValid;

  // The impact changed since the preview: the dialog shows the new one and
  // the error says so; deleting again confirms the new preview. Without the
  // new preview the dialog names the failed read, whose retry reads again.
  const showRefusalWithCurrentImpact = async (refusal: unknown) => {
    const readFailure = await adoptCurrentImpact();
    if (readFailure) {
      await errors.show(readFailure.error, {
        object: "die Vorschau der Löschung",
        retry: () => void showRefusalWithCurrentImpact(refusal),
      });
      return;
    }
    await errors.show(refusal, { object: "die Vorschau der Löschung" });
  };

  const handleDelete = async () => {
    if (!impact || confirmDisabled) return;
    setDeleting(true);
    errors.clear();
    try {
      const result = childId
        ? await deleteAdminChild(
            requestId,
            childId,
            trimmedReason,
            impact.fingerprint,
          )
        : await deleteAdminRequest(
            requestId,
            trimmedReason,
            impact.fingerprint,
          );
      onDeleted(result);
    } catch (deleteError) {
      const changed = isChangedSinceRead(deleteError);
      const failure = {
        error: deleteError instanceof Error ? deleteError.message : "unknown",
        request_id: requestId,
        child_id: childId,
      };
      // A refusal is expected; only server failures are errors.
      const expected =
        deleteError instanceof ApiError && (deleteError.status ?? 500) < 500;
      if (expected) logger.warn("enrollment_delete_failed", failure);
      else logger.error("enrollment_delete_failed", failure);
      if (changed) {
        await showRefusalWithCurrentImpact(deleteError);
      } else {
        await errors.show(deleteError, {
          object: "die Löschung",
          retry: () => void latestDeleteRef.current(),
        });
      }
    } finally {
      setDeleting(false);
    }
  };
  useLayoutEffect(() => {
    latestDeleteRef.current = handleDelete;
  });

  const title = childId
    ? "Kind aus Anmeldung löschen"
    : "Gesamte Anmeldung löschen";
  const targetLabel = child
    ? `${child.label} · Anmeldung #${requestId}`
    : `Anmeldung #${requestId}`;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      title={title}
      description={
        <>
          <span className="block font-semibold text-gray-900">
            {targetLabel}
          </span>
          <span className="mt-1 block">
            Diese Löschung lässt sich nicht rückgängig machen. Hat sich seit der
            Vorschau etwas geändert, löscht moto nichts und zeigt dir die neue
            Vorschau.
          </span>
        </>
      }
      warningSlot={
        <div className="space-y-4">
          {loadingPreview ? (
            <p className="text-sm text-gray-500">
              Auswirkungen werden geladen…
            </p>
          ) : null}

          <LoadErrorAlert error={previewError.error} />

          {impact ? (
            <>
              <section>
                <h4 className="text-sm font-semibold text-gray-900">
                  Betroffene Datensätze ({impact.counts.total})
                </h4>
                <div className="mt-2">
                  <DataGrid>
                    {countRows.map((row) => (
                      <DataField key={row.key} label={row.label}>
                        {row.value}
                      </DataField>
                    ))}
                  </DataGrid>
                </div>
              </section>

              {impact.deletes_request && childId ? (
                <Alert
                  type="info"
                  message="Dies ist das letzte Kind der Anmeldung. Deshalb wird auch der gemeinsame Anmeldungsdatensatz gelöscht."
                />
              ) : null}

              {impact.blocking_student_ids.length > 0 ? (
                <Alert
                  type="warning"
                  announce="off"
                  icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
                  title="Löschung blockiert"
                  message="Mindestens ein angelegtes Kind besteht noch. Lösche das Kind zuerst über die Kindverwaltung; die Anmeldung löscht niemals still einen Kind-Datensatz."
                  details={
                    <div className="mt-2 flex flex-wrap gap-2">
                      {impact.blocking_student_ids.map((studentId) => (
                        <NavigationLink
                          key={studentId}
                          href={studentHref(studentId)}
                          className="text-sm font-semibold underline underline-offset-2"
                        >
                          Kind #{studentId} öffnen
                        </NavigationLink>
                      ))}
                    </div>
                  }
                />
              ) : null}

              {impact.preserved_guardian_profiles > 0 ||
              impact.preserved_parent_accounts > 0 ? (
                <InsetPanel
                  as="section"
                  framed
                  padding="md"
                  className="text-sm text-gray-700"
                >
                  <h4 className="font-semibold text-gray-900">
                    Erziehungsberechtigte bleiben erhalten
                  </h4>
                  <p className="mt-1">
                    {impact.preserved_guardian_profiles} Profile und{" "}
                    {impact.preserved_parent_accounts} Elternkonten werden nicht
                    gelöscht. Davon sind {impact.unlinked_guardian_profiles}{" "}
                    Profile und {impact.parent_accounts_without_students} Konten
                    aktuell keinem Kind zugeordnet. Nutze dafür bei Bedarf den
                    separaten Löschworkflow in der Kind- bzw. Kontoverwaltung.
                  </p>
                </InsetPanel>
              ) : null}

              {impact.can_delete ? (
                <>
                  <Input
                    name="reason"
                    label="Löschgrund (Pflichtfeld)"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="z. B. fehlerhafte Testanmeldung"
                    maxLength={500}
                    error={
                      reason.length > 0 && !reasonValid
                        ? "Bitte 3 bis 500 Zeichen eingeben."
                        : errors.fieldError("reason")
                    }
                    disabled={deleting}
                  />
                  <p className="text-xs text-gray-500">
                    Bitte keine Namen, Kontaktdaten oder Gesundheitsangaben in
                    den Löschgrund schreiben.
                  </p>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      }
      gate={{ mode: "twoStep" }}
      confirmDisabled={confirmDisabled}
      onConfirm={handleDelete}
      onClose={onClose}
      loading={deleting}
      error={errors.error}
    />
  );
}
