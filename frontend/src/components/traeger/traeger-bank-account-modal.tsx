"use client";

import { useEffect, useRef, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import type { RefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  createTraegerBankAccount,
  type TraegerBankAccount,
  type TraegerBankAccountInput,
  updateTraegerBankAccount,
} from "~/lib/traeger-api";
import { formatIBAN } from "./traeger-bank-account-format";

const logger = createLogger({ component: "TraegerBankAccountModal" });

const EMPTY: TraegerBankAccountInput = {
  label: "",
  accountHolder: "",
  iban: "",
  bic: "",
  bankName: "",
  isDefault: false,
};

/** Which bank account the modal writes: a new one or an existing one. */
export type BankAccountEdit =
  | { readonly kind: "create"; readonly first: boolean }
  | { readonly kind: "change"; readonly account: TraegerBankAccount };

/** The form values of a stored account; the IBAN in groups of four. */
function inputOf(account: TraegerBankAccount): TraegerBankAccountInput {
  return {
    label: account.label,
    accountHolder: account.accountHolder,
    iban: formatIBAN(account.iban),
    bic: account.bic,
    bankName: account.bankName,
    isDefault: account.isDefault,
  };
}

/**
 * Adds or changes a bank account of the Träger (#4653). The backend checks
 * the IBAN with its check digits and keeps exactly one default.
 */
export function TraegerBankAccountModal({
  edit,
  accounts,
  reload,
  onClose,
  onSaved,
}: Readonly<{
  edit: BankAccountEdit | null;
  /** The accounts as the card shows them now. */
  accounts: readonly TraegerBankAccount[];
  /** Reads the accounts again after a refused change; rejects on failure. */
  reload: () => Promise<readonly TraegerBankAccount[]>;
  onClose: () => void;
  /** Reloads the card; never rejects (#6652). */
  onSaved: RefreshAfterWrite;
}>) {
  const [created, setCreated] = useState<TraegerBankAccountInput>(EMPTY);
  // A change rests on the version of the account it opened with (ADR
  // 0311): a refused save shows the stored account, nothing goes out until
  // it was read, and a newer read refills only an untouched form.
  const changing = edit?.kind === "change" ? edit.account : undefined;
  const stored = changing
    ? (accounts.find((account) => account.id === changing.id) ?? changing)
    : undefined;
  const change = useDraftOn<
    TraegerBankAccount,
    TraegerBankAccountInput,
    string,
    TraegerBankAccount
  >(
    {
      opening: stored ? `bank-account:${stored.id}` : null,
      data: stored,
      reload: async () =>
        (await reload()).find((account) => account.id === changing?.id),
    },
    {
      token: (read) => read.version,
      toDraft: inputOf,
      answer: (saved) => saved,
    },
  );
  const draft = changing ? (change.draft ?? inputOf(changing)) : created;
  const setDraft = changing ? change.setDraft : setCreated;
  const save = useFormModalPending(edit !== null);
  const saving = save.pending;
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  useEffect(() => {
    if (!edit) return;
    if (edit.kind === "create") setCreated(EMPTY);
    clearErrors();
  }, [edit, clearErrors]);

  const set = (field: keyof TraegerBankAccountInput) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    if (!edit) return;
    formErrors.clear();
    const fields: Record<string, string> = {};
    if (!draft.label.trim()) fields.label = "Bitte gib eine Bezeichnung an.";
    if (!draft.accountHolder.trim())
      fields.account_holder = "Bitte gib den Kontoinhaber an.";
    if (!draft.iban.trim()) fields.iban = "Bitte gib die IBAN an.";
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe deine Angaben.", fields);
      return;
    }
    if (edit.kind === "change" && !change.canSubmit) return;
    await save.run(async (op) => {
      if (edit.kind === "change") {
        const id = edit.account.id;
        const result = await change.submit((version, submitted) =>
          updateTraegerBankAccount(id, submitted, version),
        );
        if (!result.ok) {
          logger.error("traeger_bank_account_save_failed", {
            kind: edit.kind,
            error:
              result.error instanceof Error
                ? result.error.message
                : String(result.error),
          });
          if (!op.isCurrent()) return;
          // A colleague changed the account since: `reload` shows it in
          // the form instead of the draft over it.
          void formErrors.show(result.error, {
            object: "die Bankverbindung",
            reload: result.reload,
          });
          return;
        }
        success(`Die Bankverbindung „${draft.label.trim()}“ ist geändert.`);
      } else {
        try {
          await createTraegerBankAccount(draft);
          success(
            `Die Bankverbindung „${draft.label.trim()}“ ist gespeichert.`,
          );
        } catch (err) {
          logger.error("traeger_bank_account_save_failed", {
            kind: edit.kind,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!op.isCurrent()) return;
          void formErrors.show(err, { object: "die Bankverbindung" });
          return;
        }
      }
      if (op.isCurrent()) onClose();
      await onSaved();
    });
  };

  const isDefault = edit?.kind === "change" && edit.account.isDefault;
  const isFirst = edit?.kind === "create" && edit.first;

  return (
    <FormModal
      isOpen={edit !== null}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title={
        // The window names its object, not the verb of the menu entry „Bearbeiten“
        // (bauart/no-edit-overlay, #7417).
        edit?.kind === "change"
          ? edit.account.label
            ? `Bankverbindung „${edit.account.label}“`
            : "Bankverbindung"
          : "Bankverbindung hinzufügen"
      }
      size="md"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
          disabled={changing !== undefined && !change.canSubmit}
        />
      }
    >
      <form
        ref={formRef}
        id="traeger-bank-account-form"
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          controlSize="compact"
          id="traeger-bank-account-label"
          label="Bezeichnung"
          name="label"
          placeholder="zum Beispiel Elternbeiträge"
          value={draft.label}
          onChange={(e) => set("label")(e.target.value)}
          error={formErrors.fieldError("label")}
          maxLength={80}
          required
        />
        <Input
          controlSize="compact"
          id="traeger-bank-account-holder"
          label="Kontoinhaber"
          name="account_holder"
          value={draft.accountHolder}
          onChange={(e) => set("accountHolder")(e.target.value)}
          error={formErrors.fieldError("account_holder")}
          maxLength={140}
          required
        />
        <Input
          controlSize="compact"
          id="traeger-bank-account-iban"
          label="IBAN"
          name="iban"
          autoComplete="off"
          spellCheck={false}
          value={draft.iban}
          onChange={(e) => set("iban")(e.target.value)}
          error={formErrors.fieldError("iban")}
          maxLength={42}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            controlSize="compact"
            id="traeger-bank-account-bic"
            label="BIC (freiwillig)"
            name="bic"
            autoComplete="off"
            spellCheck={false}
            value={draft.bic}
            onChange={(e) => set("bic")(e.target.value)}
            error={formErrors.fieldError("bic")}
            maxLength={14}
          />
          <Input
            controlSize="compact"
            id="traeger-bank-account-bank"
            label="Bank (freiwillig)"
            name="bank_name"
            value={draft.bankName}
            onChange={(e) => set("bankName")(e.target.value)}
            error={formErrors.fieldError("bank_name")}
            maxLength={120}
          />
        </div>
        {isDefault || isFirst ? (
          <p className="text-sm text-gray-600">
            {isFirst
              ? "Die erste Bankverbindung ist der Standard. Sie steht auf allen Briefen und Rechnungen."
              : "Das ist der Standard. Wähle eine andere Bankverbindung als Standard, um das zu ändern."}
          </p>
        ) : (
          <label
            htmlFor="traeger-bank-account-default"
            className="flex items-start gap-3 text-sm text-gray-900"
          >
            <Checkbox
              id="traeger-bank-account-default"
              name="is_default"
              checked={draft.isDefault}
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  isDefault: e.target.checked,
                }))
              }
            />
            <span>
              Als Standard verwenden. Diese Bankverbindung steht dann auf allen
              Briefen und Rechnungen.
            </span>
          </label>
        )}
      </form>
    </FormModal>
  );
}
