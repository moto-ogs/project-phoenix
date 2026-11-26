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
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { staffConcept } from "~/lib/concepts/staff";
import { formatDate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
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
  reload,
  onSaved,
}: Readonly<{
  record: StaffRecordDetail;
  /** Reads the record again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<StaffRecordDetail>;
  /** Loads the corrected record; the card closes once it is there. */
  onSaved: () => Promise<unknown>;
}>) {
  const [editing, setEditing] = useState(false);
  const [birthdayValid, setBirthdayValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useApiFormError(formRef);
  const { success } = useToast();
  const today = useBerlinToday();
  const afterWrite = useRefreshAfterWrite("die Person", onSaved);
  // The draft rests on the record as it was when editing began (ADR 0311):
  // a newer read refills it only while untouched, a refused save shows the
  // stored person with the message, and nothing goes out until it is read.
  // After a save the card closes and loads the record itself.
  const edit = useDraftOn<StaffRecordDetail, StaffPersonInput, string, void>(
    {
      opening: editing ? record.id : null,
      data: record,
      reload,
    },
    {
      token: (read) => read.personVersion,
      toDraft: draftOf,
      answer: (_saved, base) => base,
      same: sameValues,
    },
  );
  const form = useReadDraftForm(editing ? edit : null, errors, "die Person");
  const draft = edit.draft ?? draftOf(record);

  const startEdit = () => {
    setBirthdayValid(true);
    errors.clear();
    setEditing(true);
  };

  // A refusal belongs to the values it refused: the first real change
  // after it takes the marks away, the next save checks again. Leaving the
  // date field reports its value again; that is no change.
  const change = (patch: Partial<StaffPersonInput>) => {
    const changed = (Object.keys(patch) as (keyof StaffPersonInput)[]).some(
      (key) => patch[key] !== draft[key],
    );
    if (!changed) return;
    edit.setDraft((current) => ({ ...current, ...patch }));
    if (errors.error) errors.clear();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    // Enter submits too: nothing goes out before the stored person is
    // read, and the shown error stays until then.
    if (!form.begin()) return;
    const next = trimmed(draft);
    const missing: Record<string, string> = {};
    if (next.firstName === "") {
      missing.first_name = "Bitte trage den Vornamen ein.";
    }
    if (next.lastName === "") {
      missing.last_name = "Bitte trage den Nachnamen ein.";
    }
    if (Object.keys(missing).length > 0) {
      errors.invalid("Bitte prüfe den Namen.", missing);
      return;
    }
    // An untouched draft saves nothing, even when the record was refreshed
    // by another save meanwhile.
    if (edit.base && sameValues(next, trimmed(draftOf(edit.base)))) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await edit.submit((version) =>
      updateStaffPerson(record.id, next, version),
    );
    if (!result.ok) {
      setSaving(false);
      if (result.skipped) return;
      logger.error("traeger_staff_person_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Changed since editing began: the card stays open on the stored
      // person and says so, without a retry (ADR 0311).
      void errors.show(result.error, {
        object: "die Person",
        reload: result.reload,
      });
      return;
    }
    // Saved. The card closes once the corrected record is loaded; a failed
    // reload says the change is saved and offers to load it again.
    const fresh = await afterWrite.refresh();
    setSaving(false);
    setEditing(false);
    if (fresh) {
      success(
        "Die Angaben zur Person sind gespeichert. Der Verlauf zeigt die alten Werte.",
      );
    }
  };

  return (
    <SectionCard
      concept={staffConcept}
      title="Person"
      description="So steht die Person in deinen Listen und Exporten. Daran erkennt moto sie auch in den Vorschlägen und beim Einstellen. Die Schulen pflegen ihre eigenen Angaben selbst."
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
            Bearbeiten
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
            disabled={!birthdayValid || !edit.canSubmit}
            disabledReason={
              form.waitReason ??
              (birthdayValid ? undefined : "Bitte prüfe zuerst den Geburtstag.")
            }
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
          <LoadErrorAlert error={form.loadError} />
          <FormErrorAlert message={errors.error} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              id="traeger-staff-first-name"
              name="first_name"
              label={STAFF_FIELD_LABELS.first_name}
              required
              controlSize="touch"
              autoComplete="off"
              maxLength={255}
              disabled={saving}
              value={draft.firstName}
              error={errors.fieldError("first_name")}
              onChange={(event) => change({ firstName: event.target.value })}
            />
            <Input
              id="traeger-staff-last-name"
              name="last_name"
              label={STAFF_FIELD_LABELS.last_name}
              required
              controlSize="touch"
              autoComplete="off"
              maxLength={255}
              disabled={saving}
              value={draft.lastName}
              error={errors.fieldError("last_name")}
              onChange={(event) => change({ lastName: event.target.value })}
            />
            <ISODateInput
              id="traeger-staff-birthday"
              label={STAFF_FIELD_LABELS.birthday}
              value={draft.birthday}
              max={today}
              maxDateError="Der Geburtstag darf nicht in der Zukunft liegen."
              error={errors.fieldError("birthday")}
              disabled={saving}
              onValidityChange={setBirthdayValid}
              onChange={(birthday) => change({ birthday })}
            />
          </div>
        </form>
      ) : (
        <>
          <LoadErrorAlert error={afterWrite.error} className="mb-4" />
          <DataGrid columns={4}>
            <DataField label={STAFF_FIELD_LABELS.first_name}>
              {record.firstName}
            </DataField>
            <DataField label={STAFF_FIELD_LABELS.last_name}>
              {record.lastName}
            </DataField>
            <DataField label={STAFF_FIELD_LABELS.birthday}>
              {record.birthday
                ? formatDate(record.birthday)
                : "Nicht hinterlegt"}
            </DataField>
            <DataField label="Schulen">
              {schoolCount(record.employments.length)}
            </DataField>
          </DataGrid>
        </>
      )}
    </SectionCard>
  );
}
