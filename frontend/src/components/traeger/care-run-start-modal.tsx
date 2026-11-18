"use client";

// Einen Monatslauf starten (#4684, #5916): Monat, Schulen und
// Rechnungsdatum. Alle Schulen sind vorgewählt. Eine Schule, die schon in
// einem offenen Lauf des Monats ist, lässt sich nicht wählen; die Zeile
// nennt den Lauf. Ohne Rechnungsdatum gilt der Tag der Freigabe.

import { useEffect, useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { CheckboxCard } from "~/components/ui/checkbox-card";
import { CustomSelect } from "~/components/ui/custom-select";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Loading } from "~/components/ui/loading";
import { useApiFormError } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { traegerPath } from "~/lib/traeger-url";
import type {
  CareRun,
  CareRunStartInput,
} from "~/lib/traeger-care-billing-api";
import {
  type CareRunSchool,
  fetchCareRunSchools,
} from "~/lib/traeger-care-review-api";
import { formatMonth } from "./care-billing-format";
import { invoiceDateBounds } from "./care-review-format";
import { useTraegerResource } from "./use-traeger-resource";

const logger = createLogger({ component: "CareRunStartModal" });

interface MonthOption {
  readonly value: string;
  readonly label: string;
}

/** The schools of a month and the ones a new run may bill. */
function freeSchools(schools: readonly CareRunSchool[]): string[] {
  return schools
    .filter((school) => school.openRunId === null)
    .map((school) => school.id);
}

export function CareRunStartModal({
  isOpen,
  months,
  initialMonth,
  onClose,
  onStart,
  onStarted,
}: Readonly<{
  isOpen: boolean;
  months: readonly MonthOption[];
  initialMonth: string;
  onClose: () => void;
  /** Starts the run; may refresh data, but must not close or navigate. */
  onStart: (input: CareRunStartInput) => Promise<CareRun>;
  /** Closes and opens the run; called only while this dialog is current. */
  onStarted: (run: CareRun) => void;
}>) {
  const [month, setMonth] = useState(initialMonth);
  // A draft belongs to this opening and month, not to a response's array.
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [invoiceDate, setInvoiceDate] = useState("");
  const save = useFormModalPending(isOpen);
  const saving = save.pending;
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;

  useEffect(() => {
    if (!isOpen) return;
    setMonth(initialMonth);
    setInvoiceDate("");
    setChoices({});
    clearErrors();
  }, [isOpen, initialMonth, clearErrors]);

  const { data: schools, error: schoolsError } = useTraegerResource(
    isOpen && month ? traegerBillingRunKeys.careRunSchools(month) : null,
    () => fetchCareRunSchools(month),
    "die Liste der Schulen",
  );
  const free = schools ? freeSchools(schools) : [];
  const selected = (choices[month] ?? free).filter((id) => free.includes(id));
  useEffect(() => {
    if (!schools) return;
    const available = freeSchools(schools);
    setChoices((current) => {
      const previous = current[month];
      const next =
        previous?.filter((id) => available.includes(id)) ?? available;
      if (previous && next.length === previous.length) return current;
      return { ...current, [month]: next };
    });
  }, [month, schools]);
  const setSelected = (next: string[] | ((current: string[]) => string[])) => {
    if (!schools) return;
    setChoices((current) => ({
      ...current,
      [month]: typeof next === "function" ? next(selected) : next,
    }));
  };

  // The open runs that already bill this month's schools, for the way there.
  const openRunIds = [
    ...new Set(
      (schools ?? [])
        .map((school) => school.openRunId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const allSelected = free.length > 0 && selected.length === free.length;
  const noneFree = schools !== null && schools.length > 0 && free.length === 0;
  // Every school of the month is in one open run: the dialog leads there
  // instead of offering a start that cannot run.
  const blockedRunId =
    schools !== null &&
    schools.length > 0 &&
    free.length === 0 &&
    openRunIds.length === 1
      ? openRunIds[0]
      : null;
  const bounds = invoiceDateBounds(month);

  const toggle = (schoolId: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current, schoolId]
        : current.filter((id) => id !== schoolId),
    );

  const submit = async () => {
    formErrors.clear();
    const invalid: Record<string, string> = {};
    if (selected.length === 0) {
      invalid.school_ids = "Bitte wähle mindestens eine Schule.";
    }
    if (invoiceDate && (invoiceDate < bounds.min || invoiceDate > bounds.max)) {
      invalid.invoice_date = "Das Datum liegt zu weit vom Monat entfernt.";
    }
    if (Object.keys(invalid).length > 0) {
      formErrors.invalid("Bitte prüfe deine Angaben.", invalid);
      return;
    }
    await save.run(async (op) => {
      let run: CareRun;
      try {
        run = await onStart({
          billingMonth: month,
          schoolIds: selected,
          invoiceDate: invoiceDate || null,
        });
      } catch (err) {
        logger.error("care_run_start_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        void formErrors.show(err, { object: "der Monatslauf" });
        return;
      }
      // A late answer must not close or navigate away from a newer dialog.
      if (op.isCurrent()) onStarted(run);
    });
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title="Monatslauf starten"
      titleLevel={2}
      size="md"
      error={formErrors.error}
      footer={
        blockedRunId ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              noTooltip="Abbrechen schließt nur das Fenster, ohne etwas zu starten."
              onClick={onClose}
            >
              Abbrechen
            </Button>
            <ButtonLink
              href={traegerPath(
                `/traeger/abrechnung/monatsbeitraege/${blockedRunId}`,
              )}
              variant="primary"
              size="md"
              tooltip="Schließt das Fenster und öffnet den offenen Lauf dieses Monats."
            >
              Lauf öffnen
            </ButtonLink>
          </div>
        ) : (
          <EditActions
            onCancel={onClose}
            onSave={() => formRef.current?.requestSubmit()}
            saving={saving}
            disabled={schools === null || free.length === 0}
            saveLabel="Vorschau öffnen"
          />
        )
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CustomSelect
          id="care-run-month"
          name="billing_month"
          label="Monat"
          error={formErrors.fieldError("billing_month")}
          value={month}
          options={months}
          onChange={setMonth}
        />
        {noneFree ? (
          // Nothing to choose or date: the dialog says where the month's
          // run is and leads there.
          <Alert
            type="info"
            message={
              blockedRunId
                ? `Für ${formatMonth(month)} gibt es schon einen offenen Lauf mit allen Schulen. Öffne ihn oder wähle einen anderen Monat.`
                : `Für ${formatMonth(month)} ist jede Schule schon in einem offenen Lauf. Wähle einen anderen Monat.`
            }
          />
        ) : (
          <FormFieldset
            legend="Schulen"
            required
            error={formErrors.fieldError("school_ids")}
            hint="Jede Schule ist in einem Monat nur in einem offenen Lauf."
          >
            {schoolsError ? (
              <LoadErrorAlert error={schoolsError} actionLayout="responsive" />
            ) : schools === null ? (
              <Loading />
            ) : (
              <div className="space-y-2">
                {free.length > 1 ? (
                  <Button
                    type="button"
                    variant="link"
                    size="md"
                    tooltip={
                      allSelected
                        ? "Nimmt bei allen Schulen den Haken weg."
                        : "Setzt den Haken bei allen Schulen ohne offenen Lauf."
                    }
                    onClick={() => setSelected(allSelected ? [] : free)}
                  >
                    {allSelected ? "Auswahl aufheben" : "Alle auswählen"}
                  </Button>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {schools.map((school) => (
                    <CheckboxCard
                      key={school.id}
                      checked={selected.includes(school.id)}
                      disabled={school.openRunId !== null}
                      onChange={(checked) => toggle(school.id, checked)}
                      label={school.name}
                      hint={
                        school.openRunId !== null
                          ? `Schon in einem offenen Lauf für ${formatMonth(month)}`
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </FormFieldset>
        )}
        {noneFree ? null : (
          <>
            <ISODatePicker
              id="care-run-invoice-date"
              name="invoice_date"
              label="Rechnungsdatum"
              value={invoiceDate}
              min={bounds.min}
              max={bounds.max}
              defaultMonth={month}
              placeholder="Tag der Freigabe"
              error={formErrors.fieldError("invoice_date")}
              onChange={setInvoiceDate}
            />
            <p className="text-sm text-gray-600">
              Der Lauf rechnet jedes Kind mit gültigem Vertrag nach den
              gebuchten Tagen ab. Du prüfst zuerst die Vorschau. Die Rechnungen
              bekommen ihre Nummer erst bei der Freigabe.
            </p>
          </>
        )}
      </form>
    </FormModal>
  );
}
