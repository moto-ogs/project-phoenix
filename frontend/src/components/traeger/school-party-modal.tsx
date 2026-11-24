"use client";

// Schulträger oder Gemeinde einer Schule eintragen (#4811): Name und
// Anschrift sind Pflicht, die Ansprechperson freiwillig. Gläubiger-ID und
// Bankverbindung braucht die Stelle nur für die Abrechnung. Das Backend prüft
// IBAN und Gläubiger-ID mit ihren Prüfziffern.

import { useEffect, useRef, useState } from "react";
import { EditActions } from "~/components/ui/edit-actions";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { SectionLabel } from "~/components/ui/section-label";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  EMPTY_SCHOOL_PARTY,
  RESPONSIBLE_BODY_LABELS,
  type SchoolParty,
  type SchoolPartyFields,
  type SchoolPartyKind,
  saveSchoolParty,
} from "~/lib/traeger-responsibilities-api";
import { formatIBAN } from "./traeger-bank-account-format";

const logger = createLogger({ component: "SchoolPartyModal" });

/** The form values of a stored body; the IBAN in groups of four. */
function fieldsOf(party: SchoolParty): SchoolPartyFields {
  const { kind: _kind, version: _version, ...fields } = party;
  return { ...fields, iban: formatIBAN(party.iban) };
}

/** The required fields the form checks before it asks the backend. */
function missingFields(draft: SchoolPartyFields): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!draft.name.trim()) fields.name = "Bitte gib den Namen an.";
  if (!draft.street.trim())
    fields.street = "Bitte gib Straße und Hausnummer an.";
  if (!/^\d{5}$/.test(draft.postalCode.trim()))
    fields.postal_code = "Bitte gib eine Postleitzahl mit 5 Ziffern an.";
  if (!draft.city.trim()) fields.city = "Bitte gib den Ort an.";
  const account = draft.accountHolder.trim() || draft.bic.trim();
  if (draft.iban.trim() && !draft.accountHolder.trim())
    fields.account_holder = "Bitte gib den Kontoinhaber an.";
  if (!draft.iban.trim() && (account || draft.bankName.trim()))
    fields.iban = "Bitte gib die IBAN an.";
  return fields;
}

export function SchoolPartyModal({
  open,
  schoolId,
  schoolName,
  kind,
  party,
  reload,
  onClose,
  onSaved,
}: Readonly<{
  open: boolean;
  schoolId: string;
  schoolName: string;
  kind: SchoolPartyKind;
  /** The stored body; undefined while the school has none of this kind. */
  party: SchoolParty | undefined;
  /** Reads the body again after a refused save; rejects on failure. */
  reload: () => Promise<SchoolParty | undefined>;
  onClose: () => void;
  /** Reloads the page; never rejects (#6652). */
  onSaved: RefreshAfterWrite;
}>) {
  const label = RESPONSIBLE_BODY_LABELS[kind];
  const [created, setCreated] = useState<SchoolPartyFields>(EMPTY_SCHOOL_PARTY);
  // A change rests on the version of the body it opened with (ADR 0311): a
  // refused save shows the stored body, nothing goes out until it was read,
  // and a newer read refills only an untouched form.
  const change = useDraftOn<
    SchoolParty,
    SchoolPartyFields,
    string,
    SchoolParty
  >(
    {
      opening: open && party ? `school-party:${schoolId}:${kind}` : null,
      data: party,
      reload,
    },
    {
      token: (read) => read.version,
      toDraft: fieldsOf,
      answer: (saved) => saved,
    },
  );
  const draft = party ? (change.draft ?? fieldsOf(party)) : created;
  const setDraft = party ? change.setDraft : setCreated;
  const save = useFormModalPending(open);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const form = useReadDraftForm(
    party ? change : null,
    formErrors,
    `die Angaben: ${label}`,
  );
  const { success } = useToast();

  useEffect(() => {
    if (!open) return;
    setCreated(EMPTY_SCHOOL_PARTY);
    clearErrors();
  }, [open, clearErrors]);

  const set = (field: keyof SchoolPartyFields) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const field = (name: keyof SchoolPartyFields, wire: string, id: string) => ({
    controlSize: "compact" as const,
    id: `school-party-${id}`,
    name: wire,
    value: draft[name],
    onChange: (event: { target: { value: string } }) =>
      set(name)(event.target.value),
    error: formErrors.fieldError(wire),
  });

  const submit = async () => {
    // Enter submits too: a change goes out only after the stored body is
    // read, and the shown error stays until then.
    if (!form.begin()) return;
    const fields = missingFields(draft);
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe deine Angaben.", fields);
      return;
    }
    await save.run(async (op) => {
      const failed = (error: unknown, retry?: () => Promise<unknown>) => {
        logger.error("school_party_save_failed", {
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!op.isCurrent()) return;
        void formErrors.show(error, {
          object: `die Angaben: ${label}`,
          reload: retry,
        });
      };
      if (party) {
        const result = await change.submit((version, submitted) =>
          saveSchoolParty(schoolId, kind, submitted, version),
        );
        if (!result.ok) {
          failed(result.error, result.reload);
          return;
        }
      } else {
        try {
          await saveSchoolParty(schoolId, kind, draft, "");
        } catch (error) {
          // A colleague stored this body meanwhile: the reload shows it,
          // and the form continues on the stored version.
          failed(error, () => onSaved());
          return;
        }
      }
      success(`${label}: Die Angaben sind gespeichert.`);
      if (op.isCurrent()) onClose();
      await onSaved();
    });
  };

  return (
    <FormModal
      isOpen={open}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      // The window names its object, not the verb of the button
      // (bauart/no-edit-overlay).
      title={`${label} der Schule ${schoolName}`}
      size="lg"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          disabled={party !== undefined && !change.canSubmit}
          disabledReason={form.waitReason}
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
        <LoadErrorAlert error={form.loadError} />
        <fieldset className="space-y-4">
          <SectionLabel as="legend">Name und Anschrift</SectionLabel>
          <Input
            {...field("name", "name", "name")}
            label="Name der Stelle"
            placeholder={
              kind === "gemeinde"
                ? "zum Beispiel Gemeinde Bissendorf"
                : "zum Beispiel Stadt Osnabrück"
            }
            hint="So steht die Stelle als Absender auf dem Brief."
            maxLength={140}
            required
          />
          <Input
            {...field("street", "street", "street")}
            label="Straße und Hausnummer"
            autoComplete="off"
            maxLength={140}
            required
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              {...field("postalCode", "postal_code", "postal-code")}
              label="Postleitzahl"
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              required
            />
            <div className="sm:col-span-2">
              <Input
                {...field("city", "city", "city")}
                label="Ort"
                autoComplete="off"
                maxLength={120}
                required
              />
            </div>
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <SectionLabel as="legend">Ansprechperson (freiwillig)</SectionLabel>
          <Input
            {...field("contactName", "contact_name", "contact-name")}
            label="Name der Ansprechperson"
            autoComplete="off"
            maxLength={120}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              {...field("contactPhone", "contact_phone", "contact-phone")}
              label="Telefon"
              type="tel"
              autoComplete="off"
              maxLength={40}
            />
            <Input
              {...field("contactEmail", "contact_email", "contact-email")}
              label="E-Mail"
              type="email"
              autoComplete="off"
              spellCheck={false}
              maxLength={254}
            />
          </div>
        </fieldset>
        <fieldset className="space-y-4">
          <SectionLabel as="legend">
            Für die Abrechnung (freiwillig)
          </SectionLabel>
          <p className="text-sm text-gray-600">
            Nur nötig, wenn diese Stelle mit den Eltern abrechnet.
          </p>
          <Input
            {...field("creditorId", "creditor_id", "creditor-id")}
            label="Gläubiger-ID"
            placeholder="DE98ZZZ09999999999"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              {...field("accountHolder", "account_holder", "account-holder")}
              label="Kontoinhaber"
              autoComplete="off"
              maxLength={140}
            />
            <Input
              {...field("iban", "iban", "iban")}
              label="IBAN"
              autoComplete="off"
              spellCheck={false}
              maxLength={42}
            />
            <Input
              {...field("bic", "bic", "bic")}
              label="BIC"
              autoComplete="off"
              spellCheck={false}
              maxLength={14}
            />
            <Input
              {...field("bankName", "bank_name", "bank-name")}
              label="Bank"
              autoComplete="off"
              maxLength={120}
            />
          </div>
        </fieldset>
      </form>
    </FormModal>
  );
}
