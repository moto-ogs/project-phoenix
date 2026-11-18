"use client";

// Die Karte „Person“ einer Personalakte (#7379): Vorname, Nachname und
// Geburtstag, wie sie beim Träger stehen. Die Personalverwaltung korrigiert
// sie hier; jeder geänderte Wert steht mit seinem alten Wert im Verlauf.
// Die Schulen behalten ihre eigenen Angaben (ADR 0089 Abschnitt 3).

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { ISODateInput } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { staffConcept } from "~/lib/concepts/staff";
import { formatDate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import {
  updateStaffPerson,
  type StaffPersonInput,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";
import { schoolCount, STAFF_FIELD_LABELS } from "./staff-record-format";

const logger = createLogger({ component: "TraegerStaffPersonCard" });

function draftOf(record: StaffRecordDetail): StaffPersonInput {
  return {
    firstName: record.firstName,
    lastName: record.lastName,
    birthday: record.birthday,
  };
}

function trimmed(draft: StaffPersonInput): StaffPersonInput {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    birthday: draft.birthday,
  };
}

function sameValues(a: StaffPersonInput, b: StaffPersonInput): boolean {
  return (
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.birthday === b.birthday
  );
}

export function StaffPersonCard({
  record,
  onSaved,
}: Readonly<{
  record: StaffRecordDetail;
  onSaved: (record: StaffRecordDetail) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StaffPersonInput>(() => draftOf(record));
  const [birthdayValid, setBirthdayValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const { success } = useToast();
  const today = useBerlinToday();

  const startEdit = () => {
    setDraft(draftOf(record));
    setBirthdayValid(true);
    errors.clear();
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const next = trimmed(draft);
    const missing: Record<string, string> = {};
    if (next.firstName === "") {
      missing.first_name = "Bitte tragen Sie den Vornamen ein.";
    }
    if (next.lastName === "") {
      missing.last_name = "Bitte tragen Sie den Nachnamen ein.";
    }
    if (Object.keys(missing).length > 0) {
      errors.invalid("Bitte prüfen Sie den Namen.", missing);
      return;
    }
    if (sameValues(next, draftOf(record))) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const saved = await updateStaffPerson(record.id, next);
      setEditing(false);
      success(
        "Die Angaben zur Person sind gespeichert. Der Verlauf zeigt die alten Werte.",
      );
      onSaved(saved);
    } catch (err) {
      logger.error("traeger_staff_person_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void errors.show(err, { object: "Die Angaben zur Person" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      concept={staffConcept}
      title="Person"
      description="So steht die Person in Ihren Listen und Exporten. moto prüft damit auch beim Einstellen, ob es die Person schon gibt. Die Schulen pflegen ihre eigenen Angaben selbst."
      action={
        editing ? undefined : (
          <Button
            size="md"
            type="button"
            variant="outline"
            className="gap-2"
            tooltip="Öffnet die Felder für Vorname, Nachname und Geburtstag."
            onClick={startEdit}
          >
            <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
            Ändern
          </Button>
        )
      }
      footer={
        editing ? (
          <EditActions
            onCancel={() => setEditing(false)}
            onSave={() => formRef.current?.requestSubmit()}
            saving={saving}
            cancelDisabled={saving}
            disabled={!birthdayValid}
            disabledReason="Bitte prüfen Sie zuerst den Geburtstag."
            saveTooltip="Speichert die Angaben in der Akte. Die Schulen behalten ihre eigenen."
          />
        ) : undefined
      }
    >
      {editing ? (
        <form
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={(event) => void save(event)}
        >
          <FormErrorAlert message={errors.error} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              id="traeger-staff-first-name"
              name="first_name"
              label={STAFF_FIELD_LABELS.first_name}
              required
              autoComplete="off"
              maxLength={255}
              value={draft.firstName}
              error={errors.fieldError("first_name")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  firstName: event.target.value,
                }))
              }
            />
            <Input
              id="traeger-staff-last-name"
              name="last_name"
              label={STAFF_FIELD_LABELS.last_name}
              required
              autoComplete="off"
              maxLength={255}
              value={draft.lastName}
              error={errors.fieldError("last_name")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  lastName: event.target.value,
                }))
              }
            />
            <ISODateInput
              id="traeger-staff-birthday"
              label={STAFF_FIELD_LABELS.birthday}
              value={draft.birthday}
              max={today}
              maxDateError="Der Geburtstag darf nicht in der Zukunft liegen."
              error={errors.fieldError("birthday")}
              onValidityChange={setBirthdayValid}
              onChange={(birthday) =>
                setDraft((current) => ({ ...current, birthday }))
              }
            />
          </div>
        </form>
      ) : (
        <DataGrid columns={4}>
          <DataField label={STAFF_FIELD_LABELS.first_name}>
            {record.firstName}
          </DataField>
          <DataField label={STAFF_FIELD_LABELS.last_name}>
            {record.lastName}
          </DataField>
          <DataField label={STAFF_FIELD_LABELS.birthday}>
            {record.birthday ? formatDate(record.birthday) : "Nicht hinterlegt"}
          </DataField>
          <DataField label="Schulen">
            {schoolCount(record.employments.length)}
          </DataField>
        </DataGrid>
      )}
    </SectionCard>
  );
}
