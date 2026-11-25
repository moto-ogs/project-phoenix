"use client";

import { useState } from "react";

import { Alert } from "~/components/ui/alert";
import { EditActions } from "~/components/ui/edit-actions";
import { FormModal } from "~/components/ui/form-modal";
import { Textarea } from "~/components/ui/textarea";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { createLogger } from "~/lib/logger";
import {
  cancelMeal,
  getMealCancellations,
  restoreMeal,
} from "~/lib/meal-plan-api";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";

const logger = createLogger({ component: "MealCancellation" });

/** Die längste Begründung, wie das Backend sie annimmt. */
const MAX_REASON = 200;

/**
 * Die Tage einer Woche, an denen das Mittagessen ausfällt (#7656), als
 * Datum → Grund. Ohne `enabled` liest der Hook nichts.
 */
export function useMealCancellations(
  mondayISO: string,
  fridayISO: string,
  enabled: boolean,
) {
  const resource = useSWRAuth(
    enabled ? tenantListKeys.mealCancellations(mondayISO) : null,
    () => getMealCancellations(mondayISO, fridayISO),
  );
  const reasons = new Map<string, string>();
  for (const cancellation of resource.data ?? []) {
    reasons.set(cancellation.date, cancellation.reason);
  }
  return reasons;
}

/** Lädt nach einem Ausfall alles neu, was den Tag zeigt. */
function useRefreshMealDay() {
  const invalidateFamily = useInvalidateFamily();
  return () =>
    Promise.all([
      invalidateFamily("meal-cancellations-"),
      invalidateFamily(tenantContactKeys.mealOrdersFamily),
      invalidateFamily(tenantContactKeys.mealParticipantsFamily),
    ]);
}

/** Der Hinweis in der Spalte eines Tages ohne Mittagessen. */
export function MealCancellationNotice({
  reason,
}: Readonly<{ reason: string }>) {
  return (
    <Alert
      type="warning"
      size="compact"
      message={`Essen fällt aus: ${reason}`}
    />
  );
}

/**
 * Trägt für einen Tag ein, dass das Mittagessen ausfällt, oder ändert den
 * Grund. Die Buchungen des Tages gelten dann nicht.
 */
export function MealCancellationModal({
  date,
  dayLabel,
  initialReason,
  onClose,
}: Readonly<{
  /** Der Tag; null hält das Fenster zu. */
  date: string | null;
  dayLabel: string;
  initialReason: string;
  onClose: () => void;
}>) {
  const isOpen = date !== null;
  const [reason, setReason] = useState(initialReason);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (date !== openedFor) {
    setOpenedFor(date);
    setReason(initialReason);
  }
  const submission = useFormModalPending(isOpen, date);
  const { error, show: showError, clear: clearError } = useApiFormError();
  const { success } = useToast();
  const refresh = useRefreshMealDay();
  const trimmed = reason.trim();

  async function save() {
    if (!date || !trimmed) return;
    clearError();
    await submission.run(async (op) => {
      try {
        await cancelMeal(date, trimmed);
      } catch (cause) {
        logger.error("meal_cancel_failed", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        if (op.isCurrent()) {
          void showError(cause, { object: "Der Ausfall des Essens" });
        }
        return;
      }
      success(`Das Essen am ${dayLabel} fällt aus.`);
      void refresh();
      if (op.isCurrent()) onClose();
    });
  }

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Essen fällt aus: ${dayLabel}`}
      size="md"
      pending={submission}
      error={error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => void save()}
          saving={submission.pending}
          disabled={!trimmed}
          disabledReason={trimmed ? undefined : "Schreib zuerst einen Grund."}
          saveTooltip="Trägt den Ausfall ein. Die Buchungen dieses Tages gelten dann nicht."
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Die Kinder bekommen an diesem Tag kein Mittagessen. Die Buchungen
          gelten nicht und werden nicht abgerechnet. Das Team sieht den Ausfall
          unter „Heute anders“.
        </p>
        <Textarea
          label="Grund"
          required
          value={reason}
          maxLength={MAX_REASON}
          rows={2}
          placeholder="Zum Beispiel: Der Caterer liefert nicht."
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </FormModal>
  );
}

/** Lässt das Essen an einem Tag wieder stattfinden. */
export function useRestoreMeal() {
  const { show } = useApiErrorDisplay();
  const { success } = useToast();
  const refresh = useRefreshMealDay();
  return async (date: string, dayLabel: string) => {
    try {
      await restoreMeal(date);
    } catch (cause) {
      logger.error("meal_restore_failed", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      void show(cause, { object: "Das Essen" });
      return;
    }
    success(`Das Essen am ${dayLabel} findet wieder statt.`);
    void refresh();
  };
}
