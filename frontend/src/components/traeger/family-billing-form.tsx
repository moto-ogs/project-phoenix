"use client";

// Empfänger und Zahlung einer Familie (#4689): wer die Rechnung bekommt
// (die Person im Vertrag, beide Eltern oder eine andere Person mit eigener
// Anschrift), ein eigener Zahlungsweg und ein eigener Zahltag. Die Familie
// ist die E-Mail-Adresse der Person im Vertrag; die Abweichung gilt für alle
// ihre Rechnungen ab dem nächsten Lauf. Weicht nichts mehr ab, ist sie
// entfernt. Die Debitorennummer gehört der Familie, nicht dem Vertrag:
// „Wieder wie im Vertrag“ lässt sie stehen (#6692), und sie hat das Format
// des Trägers (#6675).

import { useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { CustomSelect } from "~/components/ui/custom-select";
import { EditActions } from "~/components/ui/edit-actions";
import { FieldLabel } from "~/components/ui/field-label";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { Radio } from "~/components/ui/radio";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import {
  DEBTOR_NUMBER_MAX_LENGTH,
  type DebtorNumberFormat,
  NO_DEBTOR_NUMBER_FORMAT,
  debtorNumberFormatError,
  debtorNumberFormatHint,
} from "~/lib/debtor-number-format";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  type FamilyBilling,
  type FamilyBillingInput,
  MAX_DUE_DAY,
  PAYMENT_METHODS,
  type PaymentMethod,
  type RecipientKind,
  saveFamilyBilling,
} from "~/lib/traeger-billing-terms-api";
import { PAYMENT_METHOD_LABELS } from "./billing-payment-format";

const logger = createLogger({ component: "FamilyBillingForm" });

/** The contract whose family the dialog sets. */
export interface FamilyBillingTarget {
  readonly contractId: string;
  /** The person in the contract, e.g. "Anna Muster". */
  readonly applicantName: string;
  /** The child of the invoice the dialog was opened from. */
  readonly childName: string;
  /** The invoice is issued: the change reaches only the next run. */
  readonly issued: boolean;
  /**
   * The form was opened for the family itself, not from an invoice of a
   * run (#7770): no invoice exists yet or none is in view.
   */
  readonly withoutRun?: boolean;
}

export interface FamilyBillingDraft {
  /** undefined: a stored kind this build does not know; the office picks one. */
  recipientKind: RecipientKind | undefined;
  secondFirstName: string;
  secondLastName: string;
  payerFirstName: string;
  payerLastName: string;
  payerEmail: string;
  street: string;
  postalCode: string;
  city: string;
  /** undefined: a stored method this build does not know. */
  paymentMethod: PaymentMethod | "" | undefined;
  dueDay: string;
  debtorNumber: string;
}

export const EMPTY_FAMILY_BILLING: FamilyBillingDraft = {
  recipientKind: "applicant",
  secondFirstName: "",
  secondLastName: "",
  payerFirstName: "",
  payerLastName: "",
  payerEmail: "",
  street: "",
  postalCode: "",
  city: "",
  paymentMethod: "",
  dueDay: "",
  debtorNumber: "",
};

function draftOf(existing: FamilyBilling | null): FamilyBillingDraft {
  if (!existing) return EMPTY_FAMILY_BILLING;
  return {
    recipientKind: existing.recipientKind,
    secondFirstName: existing.secondFirstName,
    secondLastName: existing.secondLastName,
    payerFirstName: existing.payerFirstName,
    payerLastName: existing.payerLastName,
    payerEmail: existing.payerEmail,
    street: existing.payerAddress?.street ?? "",
    postalCode: existing.payerAddress?.postalCode ?? "",
    city: existing.payerAddress?.city ?? "",
    paymentMethod: existing.paymentMethod,
    dueDay: existing.dueDay === null ? "" : String(existing.dueDay),
    debtorNumber: existing.debtorNumber,
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The field hints of a draft the backend would refuse, keyed like the
 * backend's `errors[]`; empty when the draft may be sent.
 */
export function familyBillingErrors(
  draft: FamilyBillingDraft,
  format: DebtorNumberFormat = NO_DEBTOR_NUMBER_FORMAT,
  storedNumber = "",
): Record<string, string> {
  const errors: Record<string, string> = {};
  const debtorNumberError =
    draft.debtorNumber.trim() === storedNumber
      ? null
      : debtorNumberFormatError(draft.debtorNumber, format);
  if (debtorNumberError) errors.debtor_number = debtorNumberError;
  const need = (field: string, value: string, hint: string) => {
    if (!value.trim()) errors[field] = hint;
  };
  if (draft.recipientKind === undefined) {
    errors.recipient_kind = "Bitte wähle aus, wer die Rechnung bekommt.";
  }
  if (draft.paymentMethod === undefined) {
    errors.payment_method = "Bitte wähle aus, wie die Familie zahlt.";
  }
  if (draft.recipientKind === "both") {
    need(
      "second_first_name",
      draft.secondFirstName,
      "Bitte den Vornamen eingeben.",
    );
    need(
      "second_last_name",
      draft.secondLastName,
      "Bitte den Nachnamen eingeben.",
    );
  }
  if (draft.recipientKind === "payer") {
    need(
      "payer_first_name",
      draft.payerFirstName,
      "Bitte den Vornamen eingeben.",
    );
    need(
      "payer_last_name",
      draft.payerLastName,
      "Bitte den Nachnamen eingeben.",
    );
    if (!EMAIL_PATTERN.test(draft.payerEmail.trim())) {
      errors.payer_email =
        "Bitte eine E-Mail-Adresse wie name@beispiel.de eingeben.";
    }
    need(
      "payer_address.street",
      draft.street,
      "Bitte Straße und Hausnummer eingeben.",
    );
    if (!/^\d{5}$/.test(draft.postalCode.trim())) {
      errors["payer_address.postal_code"] =
        "Bitte eine Postleitzahl mit 5 Ziffern eingeben.";
    }
    need("payer_address.city", draft.city, "Bitte den Ort eingeben.");
  }
  return errors;
}

/**
 * The request of a draft for the contract. familyBillingErrors refuses a
 * draft without a recipient kind or payment method before it is sent.
 */
export function familyBillingInput(
  contractId: string,
  draft: FamilyBillingDraft,
): FamilyBillingInput {
  return {
    contractId,
    recipientKind: draft.recipientKind ?? "applicant",
    secondFirstName: draft.secondFirstName,
    secondLastName: draft.secondLastName,
    payerFirstName: draft.payerFirstName,
    payerLastName: draft.payerLastName,
    payerEmail: draft.payerEmail,
    payerAddress:
      draft.recipientKind === "payer"
        ? {
            street: draft.street,
            postalCode: draft.postalCode,
            city: draft.city,
          }
        : null,
    paymentMethod: draft.paymentMethod ?? "",
    dueDay: draft.dueDay === "" ? null : Number(draft.dueDay),
    debtorNumber: draft.debtorNumber,
  };
}

/** Which invoices the saved choice reaches, said above the fields. */
function scopeText(target: FamilyBillingTarget): string {
  if (target.withoutRun) {
    return "Gilt für alle neuen Rechnungen dieser Familie, auch für Geschwister. Speichern erstellt keine Rechnung und bucht nichts ab.";
  }
  return target.issued
    ? "Gilt für alle Rechnungen dieser Familie ab dem nächsten Lauf. Diese Rechnung ist schon ausgestellt und bleibt, wie sie ist."
    : "Gilt für alle Rechnungen dieser Familie, auch für Geschwister. Die Vorschau zeigt die Änderung gleich.";
}

const RECIPIENT_ITEMS: readonly { value: RecipientKind; label: string }[] = [
  { value: "applicant", label: "Person im Vertrag" },
  { value: "both", label: "Beide Eltern" },
  { value: "payer", label: "Andere Person" },
];

const DUE_DAY_OPTIONS = [
  { value: "", label: "Wie im Lauf" },
  ...Array.from({ length: MAX_DUE_DAY }, (_, index) => ({
    value: String(index + 1),
    label: `Am ${index + 1}. des Monats`,
  })),
];

/** The stored deviation the form rests on, with its read-state token. */
interface StoredFamily {
  readonly existing: FamilyBilling | null;
  readonly version: string;
}

/** The form of a family's recipient and payment, on its own page. */
export function FamilyBillingForm({
  target,
  existing,
  version,
  reload,
  runDueText,
  termsText,
  mandateInForce,
  format = NO_DEBTOR_NUMBER_FORMAT,
  onCancel,
  onSaved,
}: Readonly<{
  /** The contract whose family is set. */
  target: FamilyBillingTarget;
  /** The format of the Träger's debtor numbers (#6675). */
  format?: DebtorNumberFormat;
  /** The family's deviation as stored, null without one. */
  existing: FamilyBilling | null;
  /** Read-state token of `existing`; the save sends it back (ADR 0311). */
  version: string;
  /**
   * Reads the family again after a save was refused because its deviation
   * changed since; rejects when the read fails (ADR 0311). The stored state
   * arrives as `existing` and `version`, and the form shows it.
   */
  reload: () => Promise<undefined>;
  /**
   * The run's due dates as the run page names them („Überweisung am …“),
   * so „Wie im Lauf“ says which dates it takes. Missing outside a run.
   */
  runDueText?: string | null;
  /**
   * What „Wie in den Abrechnungsvorgaben“ takes today, e.g. „Überweisung“
   * (#7770); missing where the page does not read the Vorgaben.
   */
  termsText?: string | null;
  /**
   * Whether the family has a SEPA mandate in force for the creditor of
   * today; null or missing while unknown. The choice „Lastschrift“ names a
   * missing mandate where the person makes it.
   */
  mandateInForce?: boolean | null;
  onCancel: () => void;
  onSaved: (family: FamilyBilling | null) => void;
}>) {
  // The draft starts from the state the form read and saves over its
  // version (ADR 0311): a newer read refills it only while untouched; after
  // a refused save the stored state shows, and nothing is sent until it is
  // read.
  const edit = useDraftOn<StoredFamily, FamilyBillingDraft, string, unknown>(
    {
      opening: target.contractId,
      data: { existing, version },
      reload,
    },
    {
      token: (stored) => stored.version,
      toDraft: (stored) => draftOf(stored.existing),
      // The page leaves after a save.
      answer: (_saved, shown) => shown,
    },
  );
  const base = edit.base ?? { existing, version };
  const draft = edit.draft ?? draftOf(existing);
  const setDraft = edit.setDraft;
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { success } = useToast();

  const set = (patch: Partial<FamilyBillingDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const fieldError = (name: string) => formErrors.fieldError(name) ?? undefined;

  const submit = async () => {
    if (!edit.canSubmit) return;
    formErrors.clear();
    const errors = familyBillingErrors(
      draft,
      format,
      base.existing?.debtorNumber,
    );
    if (Object.keys(errors).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", errors);
      return;
    }
    setSaving(true);
    const result = await edit.submit((token, sent) =>
      saveFamilyBilling(familyBillingInput(target.contractId, sent), token),
    );
    setSaving(false);
    if (!result.ok) {
      logger.error("family_billing_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Changed since the read: `reload` shows the stored state, without a
      // retry of the refused version.
      void formErrors.show(result.error, {
        object: "die Angabe zu Empfänger und Zahlung",
        reload: result.reload,
      });
      return;
    }
    const saved = result.saved as FamilyBilling | null;
    success(
      saved
        ? "Empfänger und Zahlung sind gespeichert."
        : "Die Familie hat wieder die Angaben aus dem Vertrag.",
    );
    onSaved(saved);
  };

  const id = (field: string) => `family-billing-${field}`;
  // The number is the family's, not a deviation from the contract.
  const deviates =
    draft.recipientKind !== "applicant" ||
    draft.paymentMethod !== "" ||
    draft.dueDay !== "";

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-gray-600">{scopeText(target)}</p>
      <div className="space-y-2">
        <FieldLabel id={id("recipient-label")}>Rechnung an</FieldLabel>
        <div
          role="radiogroup"
          aria-labelledby={id("recipient-label")}
          className="grid gap-2 sm:grid-cols-3"
        >
          {RECIPIENT_ITEMS.map((item) => (
            <ChoiceTile
              key={item.value}
              selected={draft.recipientKind === item.value}
            >
              <Radio
                name={id("recipient")}
                value={item.value}
                checked={draft.recipientKind === item.value}
                onChange={() => set({ recipientKind: item.value })}
              />
              {item.label}
            </ChoiceTile>
          ))}
        </div>
        <p className="text-sm text-gray-600">
          {draft.recipientKind === "applicant"
            ? `Die Rechnung geht an ${target?.applicantName || "die Person im Vertrag"}.`
            : draft.recipientKind === "both"
              ? "Beide Namen stehen auf der Rechnung. Sie geht an die E-Mail-Adresse aus dem Vertrag."
              : "Die Rechnung geht an diese Person, mit ihrer Anschrift und E-Mail-Adresse."}
        </p>
      </div>
      {draft.recipientKind === "both" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            controlSize="compact"
            id={id("second-first")}
            name="second_first_name"
            label="Vorname des zweiten Elternteils"
            required
            maxLength={100}
            value={draft.secondFirstName}
            error={fieldError("second_first_name")}
            onChange={(event) => set({ secondFirstName: event.target.value })}
          />
          <Input
            controlSize="compact"
            id={id("second-last")}
            name="second_last_name"
            label="Nachname des zweiten Elternteils"
            required
            maxLength={100}
            value={draft.secondLastName}
            error={fieldError("second_last_name")}
            onChange={(event) => set({ secondLastName: event.target.value })}
          />
        </div>
      ) : null}
      {draft.recipientKind === "payer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            controlSize="compact"
            id={id("payer-first")}
            name="payer_first_name"
            label="Vorname"
            required
            maxLength={100}
            value={draft.payerFirstName}
            error={fieldError("payer_first_name")}
            onChange={(event) => set({ payerFirstName: event.target.value })}
          />
          <Input
            controlSize="compact"
            id={id("payer-last")}
            name="payer_last_name"
            label="Nachname"
            required
            maxLength={100}
            value={draft.payerLastName}
            error={fieldError("payer_last_name")}
            onChange={(event) => set({ payerLastName: event.target.value })}
          />
          <div className="sm:col-span-2">
            <Input
              controlSize="compact"
              id={id("payer-email")}
              name="payer_email"
              type="email"
              label="E-Mail-Adresse"
              required
              maxLength={320}
              value={draft.payerEmail}
              error={fieldError("payer_email")}
              onChange={(event) => set({ payerEmail: event.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              controlSize="compact"
              id={id("street")}
              name="payer_address.street"
              label="Straße und Hausnummer"
              required
              maxLength={100}
              value={draft.street}
              error={fieldError("payer_address.street")}
              onChange={(event) => set({ street: event.target.value })}
            />
          </div>
          <Input
            controlSize="compact"
            id={id("postal-code")}
            name="payer_address.postal_code"
            label="Postleitzahl"
            required
            inputMode="numeric"
            maxLength={5}
            value={draft.postalCode}
            error={fieldError("payer_address.postal_code")}
            onChange={(event) => set({ postalCode: event.target.value })}
          />
          <Input
            controlSize="compact"
            id={id("city")}
            name="payer_address.city"
            label="Ort"
            required
            maxLength={100}
            value={draft.city}
            error={fieldError("payer_address.city")}
            onChange={(event) => set({ city: event.target.value })}
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <FieldLabel id={id("payment-label")}>Zahlungsweg</FieldLabel>
        <div
          role="radiogroup"
          aria-labelledby={id("payment-label")}
          className="grid gap-2 sm:grid-cols-3"
        >
          {[
            { value: "" as const, label: "Wie in den Abrechnungsvorgaben" },
            ...PAYMENT_METHODS.map((method) => ({
              value: method,
              label: PAYMENT_METHOD_LABELS[method],
            })),
          ].map((item) => (
            <ChoiceTile
              key={item.value}
              selected={draft.paymentMethod === item.value}
            >
              <Radio
                name={id("payment")}
                value={item.value}
                checked={draft.paymentMethod === item.value}
                onChange={() => set({ paymentMethod: item.value })}
              />
              {item.label}
            </ChoiceTile>
          ))}
        </div>
        {/* What the first choice takes today, right under the choices. */}
        {termsText ? (
          <p className="text-sm text-gray-600">
            In den Abrechnungsvorgaben steht: {termsText}.
          </p>
        ) : null}
        {/* The precondition where the person chooses the debit. */}
        <p className="text-sm text-gray-600">
          Lastschrift geht nur mit gültigem Mandat. Ein Mandat allein ändert den
          Zahlungsweg nicht. Den Stand siehst du unten unter
          „SEPA-Lastschriftmandat“.
        </p>
        {draft.paymentMethod === "direct_debit" && mandateInForce === false ? (
          <Alert
            type="warning"
            size="compact"
            message="Diese Familie hat kein gültiges Mandat. Abgebucht wird erst, wenn du unten eins erfasst."
          />
        ) : null}
      </div>
      <CustomSelect
        id={id("due-day")}
        name="due_day"
        label="Zahltag"
        value={draft.dueDay}
        options={DUE_DAY_OPTIONS}
        hint={`Fällig ist der nächste gewählte Tag nach dem Rechnungsdatum. ${
          runDueText
            ? `„Wie im Lauf“: ${runDueText}.`
            : "„Wie im Lauf“ nimmt die Fälligkeit des Laufs."
        }`}
        error={fieldError("due_day")}
        onChange={(dueDay) => set({ dueDay })}
      />
      <Input
        id={id("debtor-number")}
        name="debtor_number"
        label="Debitorennummer"
        autoComplete="off"
        controlSize="compact"
        inputMode={format.digitsOnly ? "numeric" : undefined}
        maxLength={DEBTOR_NUMBER_MAX_LENGTH}
        value={draft.debtorNumber}
        hint={`${debtorNumberFormatHint(format)} Die Nummer der Familie in deiner Buchhaltung. Sie steht auf jeder neuen Monats- und Ferienrechnung und in der Sollstellung. Hat eine Ferienanmeldung eine eigene Nummer, gilt diese.`.trim()}
        error={fieldError("debtor_number")}
        onChange={(event) => set({ debtorNumber: event.target.value })}
      />
      {deviates ? (
        <Button
          type="button"
          variant="outline"
          size="compact"
          className="self-start"
          tooltip="Leert alle Abweichungen im Formular, gespeichert wird erst mit „Speichern“."
          onClick={() =>
            setDraft((current) => ({
              ...EMPTY_FAMILY_BILLING,
              debtorNumber: current.debtorNumber,
            }))
          }
        >
          Felder wie im Vertrag ausfüllen
        </Button>
      ) : null}
      <FormErrorAlert message={formErrors.error} />
      <EditActions
        onCancel={onCancel}
        saving={saving}
        disabled={!edit.canSubmit}
        disabledReason={
          edit.status === "loadFailed"
            ? "Lade zuerst den gespeicherten Stand neu."
            : "Der gespeicherte Stand wird geladen."
        }
      />
    </form>
  );
}
