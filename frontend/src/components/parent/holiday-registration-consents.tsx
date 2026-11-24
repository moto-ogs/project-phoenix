"use client";

/**
 * Freiwillige Einwilligungen einer Ferienanmeldung (#8038, ADR 0321). Eltern
 * sehen sie im Wortlaut, mit dem sie sie gegeben haben, widerrufen sie so
 * einfach, wie sie sie gegeben haben (Art. 7 Abs. 3 DSGVO), und geben sie
 * wieder. Die OGS, die das Kind in den Ferien betreut, liest den Stand bei
 * jedem Abruf neu.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LegalMarkdown } from "~/components/enrollment/legal-markdown";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { FramedList } from "~/components/ui/framed-list";
import { ConfirmationModal } from "~/components/ui/modal";
import { SectionLabel } from "~/components/ui/section-label";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { useApiFormError } from "~/contexts/ToastContext";
import { formatBerlinDate } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { setHolidayRegistrationConsent } from "~/lib/parent-api";
import {
  holidayConsentState,
  type HolidayConsentState,
} from "~/lib/holiday-consents";
import type { HolidayRegistrationConsent } from "~/lib/parent-holiday-registration-entries";

const STATE_TONES: Readonly<Record<HolidayConsentState, StatusBadgeTone>> = {
  given: "green",
  withdrawn: "orange",
  notGiven: "gray",
};

interface PendingChange {
  readonly consent: HolidayRegistrationConsent;
  readonly given: boolean;
}

export function HolidayRegistrationConsents({
  registrationId,
  consents,
  onChanged,
}: Readonly<{
  registrationId: string;
  consents: readonly HolidayRegistrationConsent[];
  /** Reloads the registrations after a change; the write answers no body. */
  onChanged: () => Promise<unknown>;
}>) {
  const t = useTranslations("parentHolidayRegistrations.consents");
  const locale = useLocale();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<PendingChange | null>(null);
  // The error of a change stands in the open dialog: a toast would lie
  // hidden beneath it.
  const changeErrors = useApiFormError();
  // The change held once the write answered: a failed reload is a load
  // error that says so, never an error of the change (#6652).
  const afterChange = useRefreshAfterWrite(t("reloadObject"), onChanged, {
    savedSuffix: t("savedButStale"),
  });
  const latestConfirmRef = useRef<() => void>(() => undefined);
  const lastChangeRef = useRef<PendingChange | null>(null);

  async function confirmChange() {
    const change = pending;
    if (!change) return;
    setSubmitting(true);
    changeErrors.clear();
    try {
      await setHolidayRegistrationConsent(
        registrationId,
        change.consent.key,
        change.given,
      );
    } catch (err) {
      void changeErrors.show(err, {
        object: t("errorObject"),
        retry: () => latestConfirmRef.current(),
      });
      setSubmitting(false);
      return;
    }
    await afterChange.refresh();
    setSubmitting(false);
    setPending(null);
    setDone(change);
  }

  useLayoutEffect(() => {
    latestConfirmRef.current = () => void confirmChange();
  });

  if (consents.length === 0) return null;

  const startChange = (consent: HolidayRegistrationConsent, given: boolean) => {
    changeErrors.clear();
    setDone(null);
    lastChangeRef.current = { consent, given };
    setPending({ consent, given });
  };
  // The dialog keeps the words of the last change while it closes, so a
  // closing "give" dialog does not flash the withdrawal's title.
  const shown = pending ?? lastChangeRef.current;
  const withdrawing = shown ? !shown.given : true;

  return (
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <div className="space-y-1">
        <SectionLabel as="h3">{t("title")}</SectionLabel>
        <p className="text-sm leading-6 text-gray-600">{t("description")}</p>
      </div>
      <LoadErrorAlert error={afterChange.error} />
      {done ? (
        <Alert
          type="success"
          message={t(done.given ? "grantSuccess" : "withdrawSuccess", {
            title: done.consent.title,
          })}
        />
      ) : null}
      <FramedList>
        {consents.map((consent) => {
          const state = holidayConsentState(consent);
          return (
            <li key={consent.key} className="space-y-1.5 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-semibold text-gray-900">
                  {consent.title}
                </p>
                <StatusBadge
                  label={t(`states.${state}`)}
                  tone={STATE_TONES[state]}
                  className="shrink-0"
                />
              </div>
              <p className="text-sm leading-6 text-gray-700">{consent.label}</p>
              {consent.text.trim() ? (
                <div className="text-sm leading-6 text-gray-600">
                  <LegalMarkdown text={consent.text} />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
                <p className="text-sm text-gray-600">
                  {consent.changedAt
                    ? t(`dates.${state}`, {
                        date: formatBerlinDate(consent.changedAt, locale),
                      })
                    : t("dates.notGiven")}
                </p>
                {consent.given ? (
                  <Button
                    type="button"
                    variant="outline_danger"
                    size="compact"
                    aria-label={t("withdrawAria", { title: consent.title })}
                    tooltip={t("withdrawTooltip")}
                    onClick={() => startChange(consent, false)}
                  >
                    {t("withdraw")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    aria-label={t("grantAria", { title: consent.title })}
                    tooltip={t("grantTooltip")}
                    onClick={() => startChange(consent, true)}
                  >
                    {t("grant")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </FramedList>
      <ConfirmationModal
        isOpen={pending !== null}
        onClose={() => {
          changeErrors.clear();
          setPending(null);
        }}
        onConfirm={() => void confirmChange()}
        title={t(withdrawing ? "withdrawTitle" : "grantTitle")}
        confirmText={t(withdrawing ? "withdrawConfirm" : "grantConfirm")}
        cancelText={t("cancel")}
        loadingText={t(withdrawing ? "withdrawing" : "granting")}
        isConfirmLoading={submitting}
        isDismissDisabled={submitting}
        confirmVariant={withdrawing ? "danger" : "primary"}
        closeLabel={t("close")}
        backdropLabel={t("close")}
        mobileSheet
      >
        <FormErrorAlert message={changeErrors.error} className="mb-3" />
        {shown ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="font-semibold text-gray-900">
                {shown.consent.title}
              </p>
              <p>{shown.consent.label}</p>
            </div>
            <p>{t(withdrawing ? "withdrawNote" : "grantNote")}</p>
          </div>
        ) : null}
      </ConfirmationModal>
    </div>
  );
}
