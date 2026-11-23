"use client";

// Mensa-Preis einer Schule ab einem Monat (#4686): je Essen oder als
// Pauschale je Kind und Monat. Ein Monat, den schon eine Rechnung abrechnet,
// behält seinen Preis; das prüft das Speichern.

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomSelect } from "~/components/ui/custom-select";
import { EditActions } from "~/components/ui/edit-actions";
import { SectionLabel } from "~/components/ui/section-label";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  type CareMealMode,
  type CareMealTariffs,
  mealTariffOn,
  saveCareMealTariff,
} from "~/lib/traeger-care-meal-api";
import { addMonths, formatMonth, monthsFromTo } from "./care-billing-format";
import { MEAL_MODE_LABELS } from "./care-meal-format";
import { centsToEuroInput, euroInputToCents } from "./holiday-period-model";

const logger = createLogger({ component: "CareMealPriceModal" });

const MONTHS_BACK = 12;
const MONTHS_AHEAD = 18;

const MODE_HINTS: Record<CareMealMode, string> = {
  per_meal:
    "Eltern zahlen jedes Essen. Es zählt jeder Tag, an dem das Kind angemeldet und da war. Abgemeldete Tage zählen nicht.",
  flat: "Eltern zahlen jeden Monat denselben Betrag. Das gilt für jedes Kind, das in dem Monat zum Essen angemeldet war.",
};

interface MealPriceDraft {
  readonly mode: CareMealMode;
  readonly amount: string;
}

/** The price a school's Mensa has in a month, as the form shows it. */
function mealPriceDraft(
  data: CareMealTariffs,
  schoolId: string,
  month: string,
): MealPriceDraft {
  const holding = mealTariffOn(data.tariffs, schoolId, month);
  return {
    mode: holding?.mode ?? "per_meal",
    amount: holding ? centsToEuroInput(holding.amountCents) : "",
  };
}

export function CareMealPriceModal({
  data,
  school,
  currentMonth,
  reload,
  onClose,
  onSaved,
}: Readonly<{
  data: CareMealTariffs;
  /** The school whose Mensa price changes; null keeps the modal closed. */
  school: { id: string; name: string } | null;
  /** The current month, "YYYY-MM-01". */
  currentMonth: string;
  /**
   * Reads the prices again after a save refused because the school's
   * prices changed since they were read; rejects when the read fails.
   */
  reload: () => Promise<CareMealTariffs>;
  onClose: () => void;
  onSaved: (data: CareMealTariffs) => void;
}>) {
  const [month, setMonth] = useState("");
  const save = useFormModalPending(school !== null);
  const saving = save.pending;
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearErrors } = formErrors;
  const { success } = useToast();

  const months = useMemo(
    () =>
      monthsFromTo(
        addMonths(currentMonth, -MONTHS_BACK),
        addMonths(currentMonth, MONTHS_AHEAD),
      ),
    [currentMonth],
  );

  // Open with the next month the school has not billed yet. The school by
  // its id: a caller that passes a new object or a newer read for the same
  // school does not open the form again.
  const schoolId = school?.id ?? null;
  const billedUntil = schoolId ? data.billedUntil[schoolId] : undefined;
  useEffect(() => {
    if (!schoolId) return;
    setMonth(
      billedUntil && billedUntil >= currentMonth
        ? addMonths(billedUntil, 1)
        : currentMonth,
    );
    clearErrors();
  }, [schoolId, billedUntil, currentMonth, clearErrors]);

  // The price of the chosen month rests on the school's version (ADR
  // 0311): a newer read refills it only while untouched, the save confirms
  // what the form showed, and after a refusal the stored price shows.
  const edit = useDraftOn<
    CareMealTariffs,
    MealPriceDraft,
    string,
    CareMealTariffs
  >(
    {
      opening: schoolId && month ? `${schoolId}:${month}` : null,
      data,
      reload,
    },
    {
      token: (read) => (schoolId ? (read.versions[schoolId] ?? "") : ""),
      toDraft: (read) => mealPriceDraft(read, schoolId ?? "", month),
      // The dialog closes after a save; the page takes the answer.
      answer: (saved) => saved,
    },
  );
  const { mode, amount } =
    edit.draft ?? mealPriceDraft(data, schoolId ?? "", month);
  const setMode = (next: CareMealMode) =>
    edit.setDraft((current) => ({ ...current, mode: next }));
  const setAmount = (next: string) =>
    edit.setDraft((current) => ({ ...current, amount: next }));

  const submit = async () => {
    if (!school) return;
    formErrors.clear();
    const cents = euroInputToCents(amount.trim());
    if (cents === null) {
      formErrors.invalid("Bitte prüfe den Betrag.", {
        amount_cents: "Bitte einen Betrag wie 4,80 eingeben.",
      });
      return;
    }
    if (!edit.canSubmit) return;
    await save.run(async (op) => {
      const result = await edit.submit((version) =>
        saveCareMealTariff(
          { schoolId: school.id, validFrom: month, mode, amountCents: cents },
          version,
        ),
      );
      if (result.ok) {
        if (op.isCurrent()) onSaved(result.saved);
        success(`Der Mensa-Preis gilt ab ${formatMonth(month)}.`);
        return;
      }
      logger.error("care_meal_price_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      if (!op.isCurrent()) return;
      // A colleague changed the prices since: `reload` shows them instead
      // of the draft, so no second „Speichern“ replaces them unseen.
      void formErrors.show(result.error, {
        object: "die Preisangabe für die Mensa",
        reload: result.reload,
      });
    });
  };

  return (
    <FormModal
      isOpen={school !== null}
      onClose={onClose}
      pending={save}
      isBackdropDismissDisabled
      title={school ? `Mensa-Preis für ${school.name}` : "Mensa-Preis"}
      size="md"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
          saveLabel="Preis speichern"
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
        <CustomSelect
          id="care-meal-month"
          name="valid_from"
          label="Gültig ab"
          value={month}
          options={[...months].reverse().map((value) => ({
            value,
            label: formatMonth(value),
          }))}
          onChange={setMonth}
          error={formErrors.fieldError("valid_from")}
        />
        <div className="space-y-2">
          <SectionLabel as="p">Abrechnungsart</SectionLabel>
          <SegmentedControl<CareMealMode>
            ariaLabel="Abrechnungsart"
            fullWidth
            value={mode}
            onChange={setMode}
            items={[
              { value: "per_meal", label: MEAL_MODE_LABELS.per_meal },
              { value: "flat", label: MEAL_MODE_LABELS.flat },
            ]}
          />
          <p className="text-sm text-gray-600">{MODE_HINTS[mode]}</p>
        </div>
        <Input
          controlSize="compact"
          id="care-meal-amount"
          name="amount_cents"
          label={
            mode === "per_meal"
              ? "Preis je Essen in €"
              : "Betrag je Kind und Monat in €"
          }
          inputMode="decimal"
          placeholder={mode === "per_meal" ? "4,80" : "55,00"}
          required
          value={amount}
          error={formErrors.fieldError("amount_cents")}
          onChange={(event) => setAmount(event.target.value)}
        />
      </form>
    </FormModal>
  );
}
