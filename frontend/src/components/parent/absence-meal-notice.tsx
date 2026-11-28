"use client";

// Hinweis „Essen noch angemeldet“ nach einer Abwesenheitsmeldung (#8216,
// Spec #8212). Die Essensanmeldung ist eine eigene Anmeldung neben dem
// Betreuungstag: Eine Abwesenheit, die die OGS sofort übernimmt, meldet das
// Essen vor der Frist selbst ab. Eine Anfrage, die noch bestätigt werden
// muss, und eine Meldung nach der Frist lassen es stehen. Der Hinweis nennt
// diese Tage und meldet sie mit „Auch abmelden“ ab, mit den Fristen und
// Rechten der Essensanmeldung.

import { useState } from "react";
import { useLocale } from "next-intl";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { useApiFormError } from "~/contexts/ToastContext";
import { useCareTermTranslations } from "~/lib/care-facility-term";
import { formatCalendarDate } from "~/lib/localized-date-format";
import {
  getMealParticipation,
  setMealParticipationDay,
} from "~/lib/parent-api";

/** Ein Tag der Abwesenheit, an dem das Kind noch zum Essen angemeldet ist. */
export interface AbsenceMealDay {
  readonly date: string;
  /** Die Eltern dürfen den Tag noch abmelden (Frist nicht vorbei). */
  readonly canCancel: boolean;
}

/**
 * Liest die Tage der Meldung, an denen das Kind noch isst. Die Essens-
 * anmeldung gibt für jeden Tag an, ob die Eltern ihn noch abmelden dürfen.
 */
export async function loadAbsenceMealDays(
  studentId: string,
  dates: readonly string[],
): Promise<AbsenceMealDay[]> {
  const sorted = [...dates].sort();
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  if (!from || !to) return [];
  const plan = await getMealParticipation(studentId, from, to);
  const wanted = new Set(dates);
  return plan.days
    .filter((day) => wanted.has(day.date) && day.participating)
    .map((day) => ({ date: day.date, canCancel: day.can_cancel }));
}

const DAY_FORMAT = {
  weekday: "short",
  day: "numeric",
  month: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

export function AbsenceMealNotice({
  studentId,
  days,
  withoutCarePlace = false,
}: Readonly<{
  studentId: string;
  days: readonly AbsenceMealDay[];
  withoutCarePlace?: boolean;
}>) {
  const t = useCareTermTranslations("parentChildCare");
  const locale = useLocale();
  const [remaining, setRemaining] = useState(days);
  const [cancelling, setCancelling] = useState(false);
  const form = useApiFormError();
  const cancelable = remaining.filter((day) => day.canCancel);
  const locked = remaining.filter((day) => !day.canCancel);

  const cancel = async () => {
    setCancelling(true);
    form.clear();
    const done = new Set<string>();
    try {
      // Nacheinander: Jede Abmeldung sperrt das Kind für ihren Tag.
      for (const day of cancelable) {
        await setMealParticipationDay(studentId, day.date, false);
        done.add(day.date);
      }
    } catch (err) {
      void form.show(err, {
        object: t("sick.mealErrorObject"),
        retry: () => void cancel(),
      });
    } finally {
      setRemaining((current) => current.filter((day) => !done.has(day.date)));
      setCancelling(false);
    }
  };

  if (remaining.length === 0) {
    return (
      <Alert
        type="success"
        announce="polite"
        message={t("sick.mealCancelled")}
      />
    );
  }

  const label = (date: string) => formatCalendarDate(date, locale, DAY_FORMAT);

  return (
    <div className="space-y-2">
      <Alert
        type="warning"
        title={t("sick.mealTitle")}
        message={t("sick.mealIntro", { count: remaining.length })}
        details={
          <div className="mt-2 space-y-2">
            <ul className="space-y-0.5 tabular-nums">
              {remaining.map((day) => (
                <li key={day.date}>
                  {day.canCancel
                    ? label(day.date)
                    : t("sick.mealDayLocked", { date: label(day.date) })}
                </li>
              ))}
            </ul>
            {locked.length > 0 && (
              <p>
                {t(
                  withoutCarePlace
                    ? "sick.mealLockedHintWithoutCarePlace"
                    : "sick.mealLockedHint",
                )}
              </p>
            )}
          </div>
        }
        action={
          cancelable.length > 0 ? (
            <Button
              type="button"
              variant="surface"
              size="compact"
              tooltip={t("sick.mealCancelTooltip")}
              onClick={() => void cancel()}
              isLoading={cancelling}
              loadingText={t("sick.mealCancelling")}
            >
              {t("sick.mealCancel")}
            </Button>
          ) : undefined
        }
        actionLayout="stacked"
      />
      <FormErrorAlert message={form.error} />
    </div>
  );
}
