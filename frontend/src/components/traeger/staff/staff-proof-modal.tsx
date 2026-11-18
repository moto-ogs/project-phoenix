"use client";

// Einen Nachweis an einer Personalakte eintragen oder erneuern (#4707,
// ADR 0238). Beim Führungszeugnis hält moto nur fest, dass es eingesehen
// wurde, wann es ausgestellt ist und dass es keine einschlägige Eintragung
// hat; eine Kopie gibt es nicht. Ohne Ablaufdatum rechnet moto es aus der
// Gültigkeit der Art.

import { useEffect, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { ConsentCheckbox } from "~/components/ui/consent-checkbox";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { berlinTodayISO } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import {
  saveStaffProof,
  type StaffProof,
} from "~/lib/traeger-staff-proofs-api";

const logger = createLogger({ component: "TraegerStaffProofModal" });

/** The proof to record: its kind at one record. */
export interface StaffProofTarget {
  readonly recordId: string;
  readonly personName: string;
  readonly proof: StaffProof;
}

interface Draft {
  presentedOn: string;
  issuedOn: string;
  noRelevantEntry: boolean;
  expiresOn: string;
}

// A renewal starts empty from today: the new proof replaces the old one.
function emptyDraft(today: string): Draft {
  return {
    presentedOn: today,
    issuedOn: "",
    noRelevantEntry: false,
    expiresOn: "",
  };
}

export function StaffProofModal({
  target,
  onClose,
  onSaved,
}: Readonly<{
  /** The kind and record to record a proof for; null keeps it closed. */
  target: StaffProofTarget | null;
  onClose: () => void;
  onSaved: (proofs: StaffProof[]) => void;
}>) {
  const today = berlinTodayISO();
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useFormModalPending(target !== null);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  useEffect(() => {
    if (!target) return;
    setDraft(emptyDraft(today));
    clearErrors();
  }, [target, today, clearErrors]);

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const police = target?.proof.policeCertificate === true;
  const kindName = target?.proof.typeName ?? "Nachweis";

  const submit = async () => {
    if (!target || !draft) return;
    formErrors.clear();
    const fieldErrors: Record<string, string> = {};
    if (!draft.presentedOn) {
      fieldErrors.presented_on = police
        ? "Bitte wähle den Tag der Einsicht."
        : "Bitte wähle den Tag, an dem der Nachweis vorlag.";
    }
    if (police && !draft.issuedOn) {
      fieldErrors.issued_on = "Bitte wähle das Ausstellungsdatum.";
    } else if (police && draft.issuedOn > draft.presentedOn) {
      fieldErrors.issued_on =
        "Das Führungszeugnis kann nicht nach der Einsicht ausgestellt sein.";
    }
    if (police && !draft.noRelevantEntry) {
      fieldErrors.no_relevant_entry =
        "Bitte bestätige, dass es keine einschlägige Eintragung gibt.";
    }
    if (draft.expiresOn && draft.expiresOn < draft.presentedOn) {
      fieldErrors.expires_on = "Das Ablaufdatum liegt vor der Vorlage.";
    }
    if (Object.keys(fieldErrors).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fieldErrors);
      return;
    }
    await save.run(async (op) => {
      try {
        const proofs = await saveStaffProof(
          target.recordId,
          target.proof.typeId,
          {
            presentedOn: draft.presentedOn,
            issuedOn: police ? draft.issuedOn : "",
            noRelevantEntry: police && draft.noRelevantEntry,
            expiresOn: draft.expiresOn,
          },
        );
        if (op.isCurrent()) onSaved(proofs);
        success(`„${kindName}“ von ${target.personName} ist eingetragen.`);
      } catch (err) {
        logger.error("traeger_staff_proof_save_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!op.isCurrent()) return;
        void formErrors.show(err, { object: "der Nachweis" });
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
        target
          ? `${kindName} ${target.proof.held ? "erneuern" : "eintragen"}: ${target.personName}`
          : "Nachweis"
      }
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={save.pending}
          saveLabel="Nachweis speichern"
          saveTooltip="Speichert den Nachweis an der Akte. Alle Einsatzorte sehen danach den neuen Stand."
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
          {police ? (
            <Alert
              type="info"
              size="compact"
              message="moto speichert nur Tag der Einsicht, Ausstellungsdatum und Ergebnis. Behalte keine Kopie. Gib das Zeugnis der Person zurück (§ 72a Abs. 5 SGB VIII)."
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <ISODatePicker
              controlSize="compact"
              id="presented_on"
              monthYearNavigation
              name="presented_on"
              label={police ? "Eingesehen am" : "Vorgelegt am"}
              required
              value={draft.presentedOn}
              max={today}
              onChange={(value) => set({ presentedOn: value })}
              error={formErrors.fieldError("presented_on")}
            />
            {police ? (
              <ISODatePicker
                controlSize="compact"
                id="issued_on"
                monthYearNavigation
                name="issued_on"
                label="Ausgestellt am"
                required
                value={draft.issuedOn}
                max={draft.presentedOn || today}
                onChange={(value) => set({ issuedOn: value })}
                hint="Das Datum oben auf dem Führungszeugnis."
                error={formErrors.fieldError("issued_on")}
              />
            ) : null}
            <ISODatePicker
              controlSize="compact"
              id="expires_on"
              monthYearNavigation
              name="expires_on"
              label="Gültig bis"
              value={draft.expiresOn}
              min={draft.presentedOn}
              onChange={(value) => set({ expiresOn: value })}
              hint={
                police
                  ? "Leer lassen: moto rechnet es aus dem Ausstellungsdatum und der Gültigkeit der Art."
                  : "Leer lassen: moto rechnet es aus der Gültigkeit der Art. Läuft der Nachweis nicht ab, bleibt es leer."
              }
              error={formErrors.fieldError("expires_on")}
            />
          </div>
          {police ? (
            <ConsentCheckbox
              name="no_relevant_entry"
              required
              checked={draft.noRelevantEntry}
              onChange={(checked) => set({ noRelevantEntry: checked })}
              label="Das Führungszeugnis hat keine einschlägige Eintragung."
              description="Gemeint sind Straftaten, die eine Arbeit mit Kindern ausschließen. Hat das Zeugnis eine solche Eintragung, trage hier nichts ein."
              error={formErrors.fieldError("no_relevant_entry")}
            />
          ) : null}
        </form>
      ) : null}
    </FormModal>
  );
}
