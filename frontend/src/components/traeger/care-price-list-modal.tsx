"use client";

// Neue Monatspreise einer Schule ab einem Monat (#4684, #6196). Je Modul
// wählt das Büro die Preisform: „Je Wochentag“ (Summe der gebuchten Tage)
// oder „Nach Tagen je Woche“ (Staffel, 1 bis 7 Tage). Neben jedem Preis für
// das 1. Kind steht der Preis für jedes weitere Kind; leer heißt: derselbe
// Preis. Ein leeres Feld für das 1. Kind setzt ab diesem Monat keinen Preis;
// dann gilt der Preis davor, falls es einen gibt. Beitragsfreie Monate
// (zum Beispiel August) gelten für die ganze Preisliste der Schule.

import { useEffect, useMemo, useRef } from "react";
import { CustomSelect } from "~/components/ui/custom-select";
import { EditActions } from "~/components/ui/edit-actions";
import { FormFieldset } from "~/components/ui/form-fieldset";
import { FormModal } from "~/components/ui/form-modal";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { ToggleChip } from "~/components/ui/toggle-chip";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  type CarePriceInput,
  type CareTariffs,
  type CareWeekday,
  saveCarePriceList,
} from "~/lib/traeger-care-billing-api";
import {
  addMonths,
  formatMonth,
  freeMonthsAt,
  monthName,
  monthShort,
  monthsFromTo,
  priceRowsAt,
  shownWeekdays,
} from "./care-billing-format";
import {
  CarePriceModuleEditor,
  EMPTY_MODULE_DRAFT,
  type ModuleDraft,
  draftColumns,
  priceFieldKey,
} from "./care-price-module-editor";
import { centsToEuroInput, euroInputToCents } from "./holiday-period-model";

const logger = createLogger({ component: "CarePriceListModal" });

/** How many months back and ahead a new price list may start. */
const MONTHS_BACK = 12;
const MONTHS_AHEAD = 18;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

type Drafts = Record<string, ModuleDraft>;

/** What the dialog edits for one school: a start month and its prices. */
interface PriceListDraft {
  /** The month the prices apply from, "YYYY-MM-01". */
  readonly month: string;
  readonly drafts: Drafts;
  readonly freeMonths: readonly number[];
}

/**
 * Every module with the prices that hold in `month`; a later price stays
 * where it starts and is never copied back.
 */
function priceListDraft(
  data: CareTariffs,
  schoolId: string,
  month: string,
): PriceListDraft {
  if (!schoolId || !month) return { month, drafts: {}, freeMonths: [] };
  const drafts: Drafts = {};
  for (const row of priceRowsAt(data, schoolId, month)) {
    drafts[row.careOfferingId] =
      row.form === "days_per_week"
        ? {
            form: row.form,
            mealExtra: row.mealExtra,
            first: centsRecord(row.steps),
            further: centsRecord(row.siblingSteps),
          }
        : {
            form: row.form,
            mealExtra: row.mealExtra,
            first: centsRecord(row.prices),
            further: centsRecord(row.siblingPrices),
          };
  }
  return { month, drafts, freeMonths: freeMonthsAt(data, schoolId, month) };
}

function centsRecord(
  values: Partial<Record<string | number, number>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, cents] of Object.entries(values)) {
    if (cents !== undefined) result[key] = centsToEuroInput(cents);
  }
  return result;
}

/** The prices a draft sends, or the field errors it has. */
function draftPrices(
  offeringId: string,
  moduleName: string,
  draft: ModuleDraft,
  weekdays: readonly CareWeekday[],
): { prices: CarePriceInput[]; errors: Record<string, string> } {
  const prices: CarePriceInput[] = [];
  const errors: Record<string, string> = {};
  for (const column of draftColumns(draft.form, weekdays)) {
    const firstText = draft.first[column.key]?.trim() ?? "";
    const furtherText = draft.further[column.key]?.trim() ?? "";
    const firstKey = priceFieldKey(offeringId, column.key, false);
    const furtherKey = priceFieldKey(offeringId, column.key, true);
    if (!firstText) {
      if (furtherText) {
        errors[firstKey] = "Bitte zuerst den Preis für das 1. Kind eintragen.";
      }
      continue;
    }
    const cents = euroInputToCents(firstText);
    if (cents === null) {
      errors[firstKey] = "Bitte einen Betrag wie 32,50 eingeben.";
      continue;
    }
    let siblingCents: number | null = null;
    if (furtherText) {
      siblingCents = euroInputToCents(furtherText);
      if (siblingCents === null) {
        errors[furtherKey] = "Bitte einen Betrag wie 25,00 eingeben.";
        continue;
      }
      if (siblingCents > cents) {
        errors[furtherKey] = "Höchstens so hoch wie beim 1. Kind.";
        continue;
      }
    }
    prices.push({
      careOfferingId: offeringId,
      moduleName,
      ...(draft.form === "days_per_week"
        ? { daysPerWeek: Number(column.key) }
        : { weekday: column.key as CareWeekday }),
      monthlyCents: cents,
      siblingCents,
      mealExtra: draft.mealExtra,
    });
  }
  return { prices, errors };
}

export function CarePriceListModal({
  data,
  school,
  currentMonth,
  initialMonth,
  onClose,
  onSaved,
  reload,
}: Readonly<{
  data: CareTariffs;
  /** The school whose prices change; null keeps the modal closed. */
  school: { id: string; name: string } | null;
  /** The current month, "YYYY-MM-01". */
  currentMonth: string;
  /** A month to start with, e.g. the price list the card shows. */
  initialMonth?: string;
  onClose: () => void;
  onSaved: (data: CareTariffs) => void;
  /**
   * Reads the prices again after a save refused because the school's prices
   * changed since they were read; rejects when the read fails (ADR 0311).
   */
  reload: () => Promise<CareTariffs>;
}>) {
  const save = useFormModalPending(school !== null);
  const saving = save.pending;
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  // Prices may start up to a year back; a price an invoice already billed
  // stays, which the save checks.
  const firstMonth = addMonths(currentMonth, -MONTHS_BACK);
  const defaultMonth = currentMonth;
  const lastMonth = addMonths(currentMonth, MONTHS_AHEAD);
  const months = useMemo(
    () => monthsFromTo(firstMonth, lastMonth),
    [firstMonth, lastMonth],
  );
  // The school by its id: a caller that passes a new object for the same
  // school does not open the form again.
  const schoolId = school?.id ?? null;
  useEffect(() => {
    if (schoolId) clearErrors();
  }, [schoolId, clearErrors]);

  // Open with the asked month when it may still change, else the first
  // month that may.
  const startMonth =
    initialMonth && initialMonth >= firstMonth ? initialMonth : defaultMonth;
  // The prices rest on the school's version (ADR 0311): a newer read
  // refills them only while untouched, the save confirms what the form
  // showed, and after a refusal the stored prices show; nothing is sent
  // until they are read. The month is part of the draft, not of the
  // opening: another month keeps the token and its lock after a refusal.
  const toDraft = (read: CareTariffs) =>
    priceListDraft(read, schoolId ?? "", startMonth);
  const edit = useDraftOn<CareTariffs, PriceListDraft, string, CareTariffs>(
    {
      opening: schoolId,
      data,
      reload,
    },
    {
      token: (read) => (schoolId ? (read.versions?.[schoolId] ?? "") : ""),
      toDraft,
      // The dialog closes after a save; the page takes the answer.
      answer: (saved) => saved,
    },
  );
  const form = useReadDraftForm(edit, formErrors, "die Preisliste");
  const { month, drafts, freeMonths } = edit.draft ?? toDraft(data);
  // Another start month shows the prices that hold then, on the read the
  // token belongs to.
  const setMonth = (next: string) =>
    edit.setDraft(() =>
      priceListDraft(edit.base ?? data, schoolId ?? "", next),
    );
  const rows = useMemo(
    () => (schoolId && month ? priceRowsAt(data, schoolId, month) : []),
    [data, schoolId, month],
  );
  const weekdays = shownWeekdays(rows);

  const changeDrafts = (change: (current: Drafts) => Drafts) =>
    edit.setDraft((current) => ({
      ...current,
      drafts: change(current.drafts),
    }));

  const draftOf = (offeringId: string) =>
    drafts[offeringId] ?? EMPTY_MODULE_DRAFT;

  const submit = async () => {
    // Enter submits too: nothing goes out before the stored prices are
    // read, and the shown error stays.
    if (!school || !form.begin()) return;
    const prices: CarePriceInput[] = [];
    const fieldErrors: Record<string, string> = {};
    for (const row of rows) {
      const result = draftPrices(
        row.careOfferingId,
        row.moduleName,
        draftOf(row.careOfferingId),
        weekdays,
      );
      prices.push(...result.prices);
      Object.assign(fieldErrors, result.errors);
    }
    if (Object.keys(fieldErrors).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Preise.", fieldErrors);
      return;
    }
    if (prices.length === 0 && freeMonths.length === 0) {
      formErrors.invalid("Bitte trage mindestens einen Preis ein.", {});
      return;
    }
    await save.run(async (op) => {
      const result = await edit.submit((version) =>
        saveCarePriceList(school.id, month, prices, freeMonths, version),
      );
      if (result.ok) {
        if (op.isCurrent()) onSaved(result.saved);
        success(`Die Preise gelten ab ${formatMonth(month)}.`);
        return;
      }
      logger.error("care_price_list_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      if (!op.isCurrent()) return;
      // A colleague changed the prices since: `reload` shows them instead
      // of the draft, so no second „Speichern“ replaces them unseen.
      void formErrors.show(result.error, {
        object: "die Preisliste",
        reload: result.reload,
      });
    });
  };

  const toggleFreeMonth = (value: number, pressed: boolean) =>
    edit.setDraft((current) => ({
      ...current,
      freeMonths: pressed
        ? [...current.freeMonths, value].sort((a, b) => a - b)
        : current.freeMonths.filter((entry) => entry !== value),
    }));

  return (
    <FormModal
      isOpen={school !== null}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title={school ? `Preise für ${school.name}` : "Preise"}
      size="xl"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
          saveLabel="Preise speichern"
        />
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
        <LoadErrorAlert error={form.loadError} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
          <CustomSelect
            id="care-price-month"
            name="valid_from"
            label="Gültig ab"
            value={month}
            options={[...months].reverse().map((value) => ({
              value,
              label: formatMonth(value),
            }))}
            // Another start month shows the prices that hold then.
            onChange={setMonth}
            error={formErrors.fieldError("valid_from")}
          />
          <p className="text-sm text-gray-600 sm:pb-2.5">
            Monatspreise je Modul. Ein leeres Feld beim 1. Kind setzt ab diesem
            Monat keinen Preis. Dann gilt der Preis davor.
          </p>
        </div>
        <FormFieldset
          legend="Beitragsfreie Monate"
          hint="In diesen Monaten stellt der Monatslauf für diese Schule keine Rechnung aus, zum Beispiel im August."
          error={formErrors.fieldError("free_months")}
        >
          <div className="flex flex-wrap gap-2">
            {MONTHS.map((value) => (
              // The name comes from content: the full month for the
              // screen reader, the short form for the eye.
              <ToggleChip
                key={value}
                pressed={freeMonths.includes(value)}
                onPressedChange={(pressed) => toggleFreeMonth(value, pressed)}
              >
                <span aria-hidden="true">{monthShort(value)}</span>
                <span className="sr-only">{`${monthName(value)} beitragsfrei`}</span>
              </ToggleChip>
            ))}
          </div>
        </FormFieldset>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-600">
            Diese Schule hat noch keine Module. Module kommen aus den gültigen
            Verträgen der Schule.
          </p>
        ) : (
          rows.map((row) => (
            <CarePriceModuleEditor
              key={row.careOfferingId}
              offeringId={row.careOfferingId}
              moduleName={row.moduleName}
              endsAt={row.endsAt}
              bookedWeekdays={row.bookedWeekdays}
              bookedDaysPerWeek={row.bookedDaysPerWeek}
              weekdays={weekdays}
              draft={draftOf(row.careOfferingId)}
              copySources={rows
                .filter((other) => other.careOfferingId !== row.careOfferingId)
                .map((other) => ({
                  value: other.careOfferingId,
                  label: other.moduleName,
                }))}
              fieldError={(key) => formErrors.fieldError(key) ?? undefined}
              onChange={(next) =>
                changeDrafts((current) => ({
                  ...current,
                  [row.careOfferingId]: next,
                }))
              }
              onCopyFrom={(source) =>
                changeDrafts((current) => ({
                  ...current,
                  [row.careOfferingId]: {
                    ...(current[source] ?? EMPTY_MODULE_DRAFT),
                  },
                }))
              }
            />
          ))
        )}
      </form>
    </FormModal>
  );
}
