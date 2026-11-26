"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

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
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { parseISODate } from "~/lib/date-helpers";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import { tenantListKeys } from "~/lib/swr/tenant-list-keys";

const logger = createLogger({ component: "MealCancellation" });

/** Die längste Begründung, wie das Backend sie annimmt. */
const MAX_REASON = 200;

function cancellationDayLabel(iso: string, locale: string): string {
  return parseISODate(iso).toLocaleDateString(locale, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Die Tage einer Woche, an denen das Mittagessen ausfällt (#7656), als
 * Datum → Grund. Ohne `enabled` liest der Hook nichts.
 */
export function useMealCancellations(
  mondayISO: string,
  fridayISO: string,
  enabled: boolean,
) {
  const t = useTranslations("mealCancellation");
  const resource = useSWRAuth(
    enabled ? tenantListKeys.mealCancellations(mondayISO) : null,
    () => getMealCancellations(mondayISO, fridayISO),
  );
  const reasons = new Map<string, string>();
  for (const cancellation of resource.data ?? []) {
    reasons.set(cancellation.date, cancellation.reason);
  }
  const { error: loadError } = useSwrResourceLoadError(
    [resource],
    t("loadObject"),
    () => resource.mutate(),
  );
  return {
    reasons,
    loadError,
    loaded: resource.data !== undefined,
  };
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
  const t = useTranslations("mealCancellation");
  return (
    <Alert type="warning" size="compact" message={t("notice", { reason })} />
  );
}

/**
 * Trägt für einen Tag ein, dass das Mittagessen ausfällt, oder ändert den
 * Grund. Die Buchungen des Tages gelten dann nicht.
 */
export function MealCancellationModal({
  date,
  initialReason,
  onClose,
}: Readonly<{
  /** Der Tag; null hält das Fenster zu. */
  date: string | null;
  initialReason: string;
  onClose: () => void;
}>) {
  const t = useTranslations("mealCancellation");
  const locale = useLocale();
  const isOpen = date !== null;
  const dayLabel = date ? cancellationDayLabel(date, locale) : "";
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
          void showError(cause, { object: t("cancelErrorObject") });
        }
        return;
      }
      success(t("cancelSuccess", { day: dayLabel }));
      void refresh();
      if (op.isCurrent()) onClose();
    });
  }

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("title", { day: dayLabel })}
      size="md"
      pending={submission}
      error={error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => void save()}
          saving={submission.pending}
          disabled={!trimmed}
          disabledReason={trimmed ? undefined : t("reasonRequired")}
          saveTooltip={t("saveTooltip")}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t("description")}</p>
        <Textarea
          label={t("reasonLabel")}
          required
          value={reason}
          maxLength={MAX_REASON}
          rows={2}
          placeholder={t("reasonPlaceholder")}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </FormModal>
  );
}

/** Lässt das Essen an einem Tag wieder stattfinden. */
export function useRestoreMeal() {
  const t = useTranslations("mealCancellation");
  const locale = useLocale();
  const { show } = useApiErrorDisplay();
  const { success } = useToast();
  const refresh = useRefreshMealDay();
  return async (date: string) => {
    try {
      await restoreMeal(date);
    } catch (cause) {
      logger.error("meal_restore_failed", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      void show(cause, { object: t("restoreErrorObject") });
      return;
    }
    success(t("restoreSuccess", { day: cancellationDayLabel(date, locale) }));
    void refresh();
  };
}
