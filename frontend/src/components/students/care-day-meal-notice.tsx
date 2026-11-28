"use client";

// Hinweis „Essen noch angemeldet“, nachdem das Personal einen Betreuungstag
// mit „Kommt nicht“ abgesagt hat (#8216, Spec #8212). Die Essensanmeldung
// ist eine eigene Anmeldung: Eine Absage ohne Uhrzeit meldet das Essen nicht
// ab. Der Hinweis nennt den Tag und bietet „Auch abmelden“ an; die Schule
// darf das Essen auch nach der Frist abmelden.

import { useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { useApiFormError } from "~/contexts/ToastContext";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { formatDate } from "~/lib/date-helpers";
import { setChildMealDay } from "~/lib/meal-plan-api";

export function CareDayMealNotice({
  studentId,
  date,
  onDismiss,
}: Readonly<{
  studentId: string;
  /** Der abgesagte Tag, `YYYY-MM-DD`. */
  date: string;
  onDismiss: () => void;
}>) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const form = useApiFormError();

  const cancel = async () => {
    setCancelling(true);
    form.clear();
    try {
      await setChildMealDay(studentId, date, false);
      setCancelled(true);
    } catch (err) {
      void form.show(err, {
        object: "Die Abmeldung vom Essen",
        retry: () => void cancel(),
      });
    } finally {
      setCancelling(false);
    }
  };

  if (cancelled) {
    return (
      <Alert
        type="success"
        announce="polite"
        message={`Das Essen am ${formatDate(date)} ist abgemeldet.`}
        onDismiss={onDismiss}
        dismissLabel="Hinweis schließen"
      />
    );
  }

  return (
    <div className="space-y-2">
      <Alert
        type="warning"
        title="Essen noch angemeldet"
        message={`Am ${formatDate(date)} ist das Kind noch zum Essen angemeldet. Das Essen wird nicht von selbst abgemeldet.`}
        action={
          <Button
            type="button"
            variant="surface"
            size="compact"
            tooltip="Meldet das Essen für diesen Tag sofort ab."
            onClick={() => void cancel()}
            isLoading={cancelling}
            loadingText="Wird abgemeldet …"
          >
            Auch abmelden
          </Button>
        }
        onDismiss={onDismiss}
        dismissLabel="Hinweis schließen"
      />
      <FormErrorAlert message={form.error} />
    </div>
  );
}
