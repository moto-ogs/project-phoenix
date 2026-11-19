"use client";

// Eine Nachweisart des Trägers anlegen oder ändern (#4707): Name, wie lange
// ein Nachweis gilt, wie viele Wochen vorher moto warnt und ob jede Person
// ihn braucht. Archivieren statt Löschen: eingetragene Nachweise behalten
// ihre Art.

import { useEffect, useRef, useState } from "react";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { SwitchRow } from "~/components/ui/switch";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  saveStaffProofType,
  type StaffProofType,
} from "~/lib/traeger-staff-proofs-api";

const logger = createLogger({ component: "TraegerStaffProofTypeModal" });

/** The kind to change, or `"new"` for a new one; null keeps it closed. */
export type StaffProofTypeTarget = StaffProofType | "new" | null;

interface Draft {
  name: string;
  validityMonths: string;
  reminderLeadWeeks: string;
  mandatory: boolean;
  archived: boolean;
}

function draftOf(target: StaffProofType | "new"): Draft {
  if (target === "new") {
    return {
      name: "",
      validityMonths: "",
      reminderLeadWeeks: "8",
      mandatory: false,
      archived: false,
    };
  }
  return {
    name: target.name,
    validityMonths:
      target.validityMonths === null ? "" : String(target.validityMonths),
    reminderLeadWeeks: String(target.reminderLeadWeeks),
    mandatory: target.mandatory,
    archived: target.archived,
  };
}

/** A whole number in [min, max] or null. */
function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return number >= min && number <= max ? number : null;
}

export function StaffProofTypeModal({
  target,
  onClose,
  onSaved,
}: Readonly<{
  target: StaffProofTypeTarget;
  onClose: () => void;
  onSaved: (kind: StaffProofType) => void;
}>) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useFormModalPending(target !== null);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  useEffect(() => {
    if (target === null) return;
    setDraft(draftOf(target));
    clearErrors();
  }, [target, clearErrors]);

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const existing = target !== null && target !== "new" ? target : null;

  const submit = async () => {
    if (target === null || !draft) return;
    formErrors.clear();
    const fieldErrors: Record<string, string> = {};
    const name = draft.name.trim();
    if (!name) fieldErrors.name = "Bitte trage einen Namen ein.";
    const validity =
      draft.validityMonths.trim() === ""
        ? null
        : wholeNumber(draft.validityMonths, 1, 240);
    if (draft.validityMonths.trim() !== "" && validity === null) {
      fieldErrors.validity_months =
        "Bitte trage 1 bis 240 Monate ein, oder lass das Feld leer.";
    }
    const lead = wholeNumber(draft.reminderLeadWeeks, 0, 52);
    if (lead === null) {
      fieldErrors.reminder_lead_weeks = "Bitte trage 0 bis 52 Wochen ein.";
    }
    if (Object.keys(fieldErrors).length > 0 || lead === null) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fieldErrors);
      return;
    }
    await save.run(async (op) => {
      try {
        const saved = await saveStaffProofType(existing?.id ?? null, {
          name,
          validityMonths: validity,
          reminderLeadWeeks: lead,
          mandatory: draft.mandatory,
          archived: draft.archived,
        });
        if (op.isCurrent()) onSaved(saved);
        success(`Die Nachweisart „${saved.name}“ ist gespeichert.`);
      } catch (err) {
        logger.error("traeger_staff_proof_type_save_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        void formErrors.show(err, { object: "die Nachweisart" });
      }
    });
  };

  return (
    <FormModal
      isOpen={target !== null}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title={
        existing
          ? `Nachweisart ändern: ${existing.name}`
          : "Nachweisart anlegen"
      }
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          saveLabel={existing ? "Änderungen speichern" : "Nachweisart anlegen"}
          saveTooltip="Speichert die Nachweisart. Stand und Warnung aller Akten richten sich danach."
        />
      }
    >
      {draft ? (
        <form
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            controlSize="compact"
            id="name"
            name="name"
            label="Name"
            required
            maxLength={100}
            placeholder="z. B. Belehrung nach § 43 IfSG"
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            error={formErrors.fieldError("name")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              controlSize="compact"
              id="validity_months"
              name="validity_months"
              label="Gültig für (Monate)"
              inputMode="numeric"
              value={draft.validityMonths}
              onChange={(event) => set({ validityMonths: event.target.value })}
              hint={
                existing?.policeCertificate
                  ? "Gezählt ab dem Ausstellungsdatum. Leer lassen, wenn der Nachweis nicht abläuft."
                  : "moto schlägt damit das Ablaufdatum vor. Leer lassen, wenn der Nachweis nicht abläuft."
              }
              error={formErrors.fieldError("validity_months")}
            />
            <Input
              controlSize="compact"
              id="reminder_lead_weeks"
              name="reminder_lead_weeks"
              label="Warnung vor Ablauf (Wochen)"
              required
              inputMode="numeric"
              value={draft.reminderLeadWeeks}
              onChange={(event) =>
                set({ reminderLeadWeeks: event.target.value })
              }
              hint="Dann bekommen die Leitung jedes Einsatzorts und die Person eine Nachricht und eine E-Mail. Am Ablauftag kommt eine zweite."
              error={formErrors.fieldError("reminder_lead_weeks")}
            />
          </div>
          <SwitchRow
            framed
            label="Pflicht für alle Personen mit Akte"
            description="Fehlt der Nachweis, steht die Person auf der Liste als „Fehlt“."
            checked={draft.mandatory}
            onCheckedChange={(checked) => set({ mandatory: checked })}
          />
          {existing ? (
            <SwitchRow
              framed
              label="Archiviert"
              description="Eine archivierte Art bieten die Akten nicht mehr an. Eingetragene Nachweise bleiben."
              checked={draft.archived}
              onCheckedChange={(checked) => set({ archived: checked })}
            />
          ) : null}
        </form>
      ) : null}
    </FormModal>
  );
}
