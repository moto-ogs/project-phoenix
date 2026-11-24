"use client";

/**
 * Widerruf einer freiwilligen Einwilligung, den die Eltern dem Träger-Büro
 * außerhalb von moto erklärt haben (#8038, ADR 0321), etwa per Mail oder
 * Brief. Das Büro trägt nur Widerrufe ein; geben können die Einwilligung nur
 * die Eltern. Die ausrichtende OGS sieht den Widerruf sofort.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { ConfirmationModal } from "~/components/ui/modal";
import { useApiFormError } from "~/contexts/ToastContext";
import {
  withdrawHolidayConsent,
  type HolidayRegistrationDetail,
} from "~/lib/traeger-holiday-registrations-api";

export function HolidayConsentWithdrawButton({
  periodId,
  registrationId,
  consentKey,
  title,
  onChanged,
}: Readonly<{
  periodId: string;
  registrationId: string;
  consentKey: string;
  title: string;
  onChanged: (registration: HolidayRegistrationDetail) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The error stands in the open dialog: a toast would lie beneath it.
  const errors = useApiFormError();
  const latestConfirmRef = useRef<() => void>(() => undefined);

  async function confirm() {
    setSubmitting(true);
    errors.clear();
    let next: HolidayRegistrationDetail;
    try {
      next = await withdrawHolidayConsent(periodId, registrationId, consentKey);
    } catch (err) {
      void errors.show(err, {
        object: "Der Widerruf",
        retry: () => latestConfirmRef.current(),
      });
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setOpen(false);
    onChanged(next);
  }

  useLayoutEffect(() => {
    latestConfirmRef.current = () => void confirm();
  });

  return (
    <>
      <Button
        type="button"
        variant="outline_danger"
        size="compact"
        className="mt-2"
        aria-label={`Widerruf von „${title}“ eintragen`}
        tooltip="Trägt den Widerruf der Eltern ein. moto fragt vorher nach."
        onClick={() => {
          errors.clear();
          setOpen(true);
        }}
      >
        Widerruf eintragen
      </Button>
      <ConfirmationModal
        isOpen={open}
        onClose={() => {
          errors.clear();
          setOpen(false);
        }}
        onConfirm={() => void confirm()}
        title="Widerruf eintragen?"
        confirmText="Widerruf eintragen"
        cancelText="Abbrechen"
        loadingText="Wird eingetragen …"
        isConfirmLoading={submitting}
        isDismissDisabled={submitting}
        confirmVariant="danger"
      >
        <FormErrorAlert message={errors.error} className="mb-3" />
        <div className="space-y-3">
          <p className="font-semibold text-gray-900">{title}</p>
          <p>
            Trag den Widerruf nur ein, wenn die Eltern ihn dir erklärt haben,
            zum Beispiel per Mail oder Brief.
          </p>
          <p>
            Die OGS, die das Kind in den Ferien betreut, sieht ihn sofort.
            Wieder geben können die Einwilligung nur die Eltern in der
            Eltern-App.
          </p>
        </div>
      </ConfirmationModal>
    </>
  );
}
