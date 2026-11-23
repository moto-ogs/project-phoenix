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
import { ApiError } from "~/lib/api-error";
import {
  type AdminEnrollmentDeletionImpact,
  deleteAdminChild,
  deleteAdminRequest,
  getAdminChildDeleteImpact,
  getAdminRequestDeleteImpact,
} from "~/lib/enrollment-admin-api";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useReadDraft } from "~/lib/swr/read-draft";
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

  // The deletion confirms the preview on screen (ADR 0311): the dialog holds
  // the preview it opened with, also over a later read, and sends its
  // fingerprint; the server refuses it when the impact changed meanwhile.
  const preview = useReadDraft<
    AdminEnrollmentDeletionImpact,
    AdminEnrollmentDeletionImpact,
    string,
    AdminEnrollmentDeletionImpact
  >({
    key: isOpen
      ? childId
        ? enrollmentKeys.childDeleteImpact(requestId, childId)
        : enrollmentKeys.requestDeleteImpact(requestId)
      : null,
    fetcher: () =>
      childId
        ? getAdminChildDeleteImpact(requestId, childId)
        : getAdminRequestDeleteImpact(requestId),
    token: (read) => read.fingerprint,
    follow: false,
    // A deletion leaves no preview to read again.
    answer: (_deleted, shown) => shown,
  });
  // A failed read shows its error, also over a preview from before.
  const previewError = useReadDraftLoadError(
    preview,
    "die Vorschau der Löschung",
  );
  const impact = preview.status === "loadFailed" ? undefined : preview.base;
  const loadingPreview =
    isOpen && !preview.canSubmit && preview.status !== "loadFailed";

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

  const handleDelete = async () => {
    if (!impact || confirmDisabled) return;
    setDeleting(true);
    errors.clear();
    const result = await preview.submit((fingerprint) =>
      childId
        ? deleteAdminChild(requestId, childId, trimmedReason, fingerprint)
        : deleteAdminRequest(requestId, trimmedReason, fingerprint),
    );
    setDeleting(false);
    if (result.ok) {
      onDeleted(result.saved);
      return;
    }
    const deleteError = result.error;
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
    // The impact changed since the preview: the dialog shows the new one
    // and the error says so; deleting again confirms the new preview. A
    // failed read of it is named, with a retry of the read alone.
    await errors.show(deleteError, {
      object: result.refused ? "die Vorschau der Löschung" : "die Löschung",
      retry: () => void latestDeleteRef.current(),
      reload: result.reload,
    });
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

          {/* After a refused deletion the dialog's error already names the
              failed read, with its retry. */}
          {errors.error ? null : <LoadErrorAlert error={previewError} />}

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
