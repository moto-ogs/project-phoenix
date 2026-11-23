"use client";

// Beschäftigungen zu einer Personalakte verknüpfen (#4705, ADR 0089
// Abschnitt 5). Der Dialog zeigt, was jede Schule über die Person weiß. Wo
// die Schulen sich unterscheiden, wählt die Personalverwaltung den Wert, der
// gilt; der andere Wert bleibt mit seiner Schule im Verlauf. Bank- und
// Steuerdaten erscheinen nur maskiert und ziehen in die Akte um. Die Vorschau
// steht im Zugriffsprotokoll jeder Schule und wird deshalb bei jedem Öffnen
// neu gelesen; das Verknüpfen trägt ihren Fingerabdruck (ADR 0311).

import { useEffect, useRef } from "react";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FieldLabel } from "~/components/ui/field-label";
import { FormModal } from "~/components/ui/form-modal";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Loading } from "~/components/ui/loading";
import { Radio } from "~/components/ui/radio";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import { traegerStaffKeys } from "~/lib/swr/traeger-staff-keys";
import {
  linkStaff,
  previewStaffLink,
  staffName,
  type StaffLinkInput,
  type StaffLinkPreview,
  type StaffRecordDetail,
  type StaffRecordField,
} from "~/lib/traeger-staff-api";
import { STAFF_FIELD_LABELS, staffFieldValue } from "./staff-record-format";

const logger = createLogger({ component: "StaffLinkModal" });

type Choices = Partial<Record<StaffRecordField, string>>;
const NO_CHOICES: Choices = {};

/** Wo die Werte gleich sind, zeigt der Dialog sie nur zur Kontrolle. */
function agreedValue(preview: StaffLinkPreview, field: StaffRecordField) {
  const option = preview.fields.find((entry) => entry.field === field)
    ?.options[0];
  return option ? staffFieldValue(field, option.value) : "–";
}

export function StaffLinkModal({
  request,
  onClose,
  onLinked,
}: Readonly<{
  /** Was verknüpft werden soll; `null` schließt den Dialog. */
  request: Omit<StaffLinkInput, "choices"> | null;
  onClose: () => void;
  onLinked: (record: StaffRecordDetail) => void;
}>) {
  const isOpen = request !== null;
  const previewKey = request
    ? traegerStaffKeys.linkPreview(request.recordId, request.members)
    : null;
  const read = useFreshTraegerResource(
    previewKey,
    () =>
      previewStaffLink({
        recordId: request?.recordId ?? null,
        members: request?.members ?? [],
        choices: {},
      }),
    "die Vorschau",
  );
  // The values the dialog shows are the ones the link confirms (ADR 0311):
  // the choices rest on them, and after a refusal the new values show with
  // the choices starting over; nothing is sent until they are read.
  const link = useDraftOn<StaffLinkPreview, Choices, string, StaffRecordDetail>(
    {
      opening: previewKey,
      data: read.data ?? undefined,
      error: read.data === null ? read.failure : undefined,
      reload: read.reloadOrThrow,
    },
    {
      token: (shown) => shown.fingerprint,
      toDraft: () => NO_CHOICES,
      follow: false,
      // The dialog closes after linking: no further read (each one is an
      // access-log entry at every school).
      answer: (_saved, shown) => shown,
    },
  );
  const preview = link.base ?? null;
  const previewError = read.error;
  const choices = link.draft ?? NO_CHOICES;
  const setChoices = link.setDraft;
  const save = useFormModalPending(isOpen);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;

  // A new request starts without the errors of the one before.
  useEffect(() => {
    if (!request) return;
    clearErrors();
  }, [request, clearErrors]);

  const conflicts = preview?.fields.filter((field) => field.conflict) ?? [];
  const missing = conflicts.filter((field) => !choices[field.field]);
  const joinsRecord = request?.recordId != null;

  const submit = async () => {
    if (!request || !preview) return;
    formErrors.clear();
    if (missing.length > 0) {
      formErrors.invalid(
        "Bitte wähle bei jedem Feld, welcher Wert gilt.",
        Object.fromEntries(
          missing.map((field) => [
            `choice-${field.field}`,
            "Bitte wähle einen Wert.",
          ]),
        ),
      );
      return;
    }
    if (!link.canSubmit) return;
    await save.run(async (op) => {
      const result = await link.submit((fingerprint, chosen) =>
        linkStaff({
          ...request,
          choices: chosen,
          expectedFingerprint: fingerprint,
        }),
      );
      if (result.ok) {
        if (op.isCurrent()) onLinked(result.saved);
        return;
      }
      logger.error("traeger_staff_link_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      if (!op.isCurrent()) return;
      // A school changed a value since the preview: `reload` shows the
      // values again and the choices start over.
      void formErrors.show(result.error, {
        object: "die Personalakte",
        reload: result.reload,
      });
    });
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title={
        joinsRecord ? "Zur Personalakte hinzufügen" : "Personalakte anlegen"
      }
      titleLevel={2}
      size="lg"
      error={formErrors.error ?? previewError}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          disabled={!preview || !link.canSubmit}
          disabledReason={
            link.status === "loadFailed"
              ? "Lade zuerst die Vorschau neu."
              : "Die Vorschau lädt noch."
          }
          saveLabel={joinsRecord ? "Hinzufügen" : "Akte anlegen"}
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {preview ? (
          <>
            <section className="space-y-2">
              <SectionLabel as="h3">
                {preview.record
                  ? `Akte von ${staffName(preview.record)}`
                  : "Diese Beschäftigungen werden eine Akte"}
              </SectionLabel>
              <ul className="grid gap-2 sm:grid-cols-2">
                {preview.members.map((member) => (
                  <li key={`${member.schoolId}-${member.staffId}`}>
                    <InsetPanel tone="white" padding="md" framed>
                      <p className="font-medium text-gray-900">
                        {staffName(member)}
                      </p>
                      <p className="text-sm text-gray-600">
                        {member.schoolName}
                      </p>
                      <p className="mt-1 text-sm text-gray-500 tabular-nums">
                        {member.personnelNumber
                          ? `Personalnummer ${member.personnelNumber}`
                          : "Ohne Personalnummer"}
                      </p>
                    </InsetPanel>
                  </li>
                ))}
              </ul>
            </section>

            {conflicts.length > 0 ? (
              <section className="space-y-4">
                <div className="space-y-1">
                  <SectionLabel as="h3">Welcher Wert gilt?</SectionLabel>
                  <p className="text-sm text-gray-600">
                    Die Schulen haben hier verschiedene Werte. Der andere Wert
                    bleibt mit seiner Schule im Verlauf der Akte.
                  </p>
                </div>
                {conflicts.map((field) => {
                  const labelId = `staff-choice-${field.field}-label`;
                  return (
                    <div key={field.field} className="space-y-2">
                      <FieldLabel id={labelId} required>
                        {STAFF_FIELD_LABELS[field.field]}
                      </FieldLabel>
                      <div
                        role="radiogroup"
                        aria-labelledby={labelId}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        {field.options.map((option) => (
                          <ChoiceTile
                            key={option.source}
                            selected={choices[field.field] === option.source}
                            className="items-start gap-3 px-4 py-3"
                          >
                            <Radio
                              name={`staff-choice-${field.field}`}
                              value={option.source}
                              checked={choices[field.field] === option.source}
                              onChange={() =>
                                setChoices((current) => ({
                                  ...current,
                                  [field.field]: option.source,
                                }))
                              }
                              className="mt-0.5"
                            />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="font-medium wrap-anywhere text-gray-900">
                                {staffFieldValue(field.field, option.value)}
                              </span>
                              <span className="text-sm font-normal text-gray-600">
                                {option.source === "record"
                                  ? "Bisher in der Akte"
                                  : option.schoolName}
                              </span>
                            </span>
                          </ChoiceTile>
                        ))}
                      </div>
                      <FieldErrorHint
                        id={`staff-choice-${field.field}-error`}
                        message={formErrors.fieldError(`choice-${field.field}`)}
                      />
                    </div>
                  );
                })}
              </section>
            ) : null}

            <section className="space-y-2">
              <SectionLabel as="h3">Das steht danach in der Akte</SectionLabel>
              <InsetPanel padding="md">
                <DataGrid columns={2}>
                  {preview.fields
                    .filter((field) => !field.conflict)
                    .map((field) => (
                      <DataField
                        key={field.field}
                        label={STAFF_FIELD_LABELS[field.field]}
                      >
                        {agreedValue(preview, field.field)}
                      </DataField>
                    ))}
                </DataGrid>
              </InsetPanel>
              {preview.fields.some(
                (field) =>
                  ["iban", "tax_id", "social_security_number"].includes(
                    field.field,
                  ) && field.options.length > 0,
              ) ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  <StatusBadge label="Bank und Steuer" tone="blue" size="xs" />
                  Die Schulen geben ihre Bank- und Steuerdaten an die Akte ab.
                  Danach führt sie nur noch der Träger.
                </p>
              ) : null}
            </section>
          </>
        ) : formErrors.error || previewError ? null : (
          <Loading message="Vorschau wird geladen…" compact />
        )}
      </form>
    </FormModal>
  );
}
