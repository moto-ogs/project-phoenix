"use client";

// Die Personalnummer einer Akte (#4705, ADR 0089 Abschnitt 4): die Nummer
// des Trägers, die an allen Schulen gilt, und je Einsatzort bei einer
// Gemeinde oder einem Schulträger die Nummer, die dessen Lohnbüro nutzt
// (#8041, ADR 0320). Ohne eigene Nummer gilt dort die des Trägers. Die
// Datei je Arbeitgeber bucht mit ihr; die eine Datei des Trägers nicht.

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { EditActions } from "~/components/ui/edit-actions";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { payrollConcept } from "~/lib/concepts/payroll";
import { createLogger } from "~/lib/logger";
import {
  updateStaffEmployerNumber,
  updateStaffPersonnelNumber,
  type StaffEmployment,
  type StaffRecordDetail,
} from "~/lib/traeger-staff-api";

const logger = createLogger({ component: "TraegerStaffPersonnelNumber" });

const NUMBER_PATTERN = /^\d{1,9}$/;
const NUMBER_HINT = "Die Personalnummer hat 1 bis 9 Ziffern.";

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Die Einsatzorte, an denen ein anderer Arbeitgeber anstellt. */
const otherEmployers = (record: StaffRecordDetail) =>
  record.employments.filter((employment) => employment.employerBody !== "");

const employerFieldName = (employment: StaffEmployment) =>
  `employer_personnel_number.${employment.schoolId}`;

const employerLabel = (employment: StaffEmployment) =>
  `Bei ${employment.employerName} (${employment.schoolName})`;

export function StaffPersonnelNumberCard({
  record,
  onSaved,
}: Readonly<{
  record: StaffRecordDetail;
  onSaved: (record: StaffRecordDetail) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [employerDrafts, setEmployerDrafts] = useState<Record<string, string>>(
    {},
  );
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  const others = otherEmployers(record);

  const startEditing = () => {
    setDraft(record.personnelNumber ?? "");
    setEmployerDrafts(
      Object.fromEntries(
        others.map((employment) => [
          employment.schoolId,
          employment.employerPersonnelNumber ?? "",
        ]),
      ),
    );
    errors.clear();
    setEditing(true);
  };

  const invalidFields = () => {
    const invalid: Record<string, string> = {};
    if (draft.trim() !== "" && !NUMBER_PATTERN.test(draft.trim())) {
      invalid.personnel_number = NUMBER_HINT;
    }
    for (const employment of others) {
      const value = (employerDrafts[employment.schoolId] ?? "").trim();
      if (value !== "" && !NUMBER_PATTERN.test(value)) {
        invalid[employerFieldName(employment)] = NUMBER_HINT;
      }
    }
    return invalid;
  };

  const save = async () => {
    const invalid = invalidFields();
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die Personalnummern.", invalid);
      return;
    }
    setSaving(true);
    try {
      let saved = record;
      const value = draft.trim();
      if (value !== (record.personnelNumber ?? "")) {
        saved = await updateStaffPersonnelNumber(record.id, value || null);
      }
      for (const employment of otherEmployers(saved)) {
        const next = (employerDrafts[employment.schoolId] ?? "").trim();
        if (next === (employment.employerPersonnelNumber ?? "")) continue;
        saved = await updateStaffEmployerNumber(
          record.id,
          employment.schoolId,
          next || null,
          employment.employerNumberVersion,
        );
      }
      setEditing(false);
      success("Die Personalnummern sind gespeichert.");
      onSaved(saved);
    } catch (err) {
      logger.error("traeger_staff_personnel_number_failed", {
        error: errorMessage(err),
      });
      void errors.show(err, { object: "die Personalnummer" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      concept={payrollConcept}
      title="Personalnummer"
      description={
        others.length > 0
          ? "Die Nummer aus deinem Lohnsystem gilt an allen Schulen. Hat die Person bei einer Gemeinde oder einem Schulträger eine andere Nummer, trag sie darunter ein."
          : "Die Nummer aus deinem Lohnsystem. Sie gilt an allen Schulen dieser Person und ist bei deinem Träger nur einmal vergeben."
      }
      action={
        editing ? undefined : (
          <Button
            size="md"
            type="button"
            variant="outline"
            className="gap-2"
            tooltip="Öffnet die Felder, um die Personalnummern einzutragen oder zu ändern."
            onClick={startEditing}
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
            onSave={() => void save()}
            saving={saving}
          />
        ) : undefined
      }
      bodyClassName="mt-4 space-y-4"
    >
      {editing ? (
        <>
          <Input
            id="traeger-staff-personnel-number"
            name="personnel_number"
            label="Personalnummer"
            controlSize="compact"
            hint="Leer lassen, wenn es noch keine Nummer gibt."
            inputMode="numeric"
            autoComplete="off"
            value={draft}
            error={
              errors.fieldError("personnel_number") ?? errors.error?.message
            }
            onChange={(event) => setDraft(event.target.value)}
          />
          {others.map((employment) => (
            <Input
              key={employment.schoolId}
              name={employerFieldName(employment)}
              label={employerLabel(employment)}
              controlSize="compact"
              hint="Leer lassen, wenn dort dieselbe Nummer gilt wie beim Träger."
              inputMode="numeric"
              autoComplete="off"
              value={employerDrafts[employment.schoolId] ?? ""}
              error={errors.fieldError(employerFieldName(employment))}
              onChange={(event) =>
                setEmployerDrafts((current) => ({
                  ...current,
                  [employment.schoolId]: event.target.value,
                }))
              }
            />
          ))}
        </>
      ) : (
        <>
          <p className="font-mono text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">
            {record.personnelNumber ?? "–"}
          </p>
          {others.length > 0 ? (
            <DataGrid columns={1}>
              {others.map((employment) => (
                <DataField
                  key={employment.schoolId}
                  label={employerLabel(employment)}
                >
                  {employment.employerPersonnelNumber ?? "Wie beim Träger"}
                </DataField>
              ))}
            </DataGrid>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
