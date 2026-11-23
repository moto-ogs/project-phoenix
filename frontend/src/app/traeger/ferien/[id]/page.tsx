"use client";

// Ein Ferienzeitraum des Trägers (#4659): ändern und veröffentlichen. Der
// Reiter „Anmeldungen“ führt zur Prüfung der Anmeldungen (#4663).
// „Veröffentlichen“ ist die eine Kopfaktion, der Weg zur Abrechnung steht im
// Drei-Punkte-Menü (#7411).

import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  HolidayPeriodStatusBadge,
  holidayPeriodStats,
  holidayPeriodTabs,
} from "~/components/traeger/holiday-period-head";
import { HolidayPeriodForm } from "~/components/traeger/holiday-period-form";
import { useHolidayEditorCalendar } from "~/components/traeger/use-week-no-care-days";
import {
  HolidayPeriodPublishButton,
  HolidayPeriodPublishCard,
} from "~/components/traeger/holiday-period-publish-card";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { useTraegerHolidayCriteria } from "~/components/traeger/use-traeger-resources";
import { metadataLoadError } from "~/components/traeger/metadata-load-error";
import {
  HOLIDAY_BILLING_HINT,
  useHolidayPeriodBillingHref,
} from "~/components/traeger/use-holiday-period-billing-href";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import type { HolidayPeriod } from "~/lib/traeger-api";
import { useTraegerHolidayPeriod } from "~/components/traeger/use-traeger-resources";
import { useTenantMutateMatching } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { traegerPath } from "~/lib/traeger-url";

/** Was die Seite ist und was man dort zuerst tut (#7595). */
const PERIOD_INFO =
  "Hier planst du den Ferienzeitraum: Anmeldebeginn, Anmeldeschluss und die Wochen. Jede Woche bekommt eine „Ausrichtende OGS“ und ihre „Zeitmodelle“. Eltern melden ihre Kinder erst an, wenn du den Ferienzeitraum veröffentlicht hast.";

export default function TraegerHolidayPeriodPage() {
  const holidayCalendar = useHolidayEditorCalendar();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const {
    data: period,
    preview,
    loadError: periodError,
    error: periodFailure,
    mutate,
    reloadOrThrow,
  } = useTraegerHolidayPeriod(id);
  const billingHref = useHolidayPeriodBillingHref(period);
  const invalidatePeriods = useTenantMutateMatching([
    traegerKeys.periodsFamily,
  ]);
  const [dirty, setDirty] = useState(false);
  const {
    schools,
    error: schoolsError,
    fetchError: schoolsFailure,
  } = useTraegerSchools();
  const listHref = traegerPath("/traeger/ferien");
  const criteria = useTraegerHolidayCriteria().data?.criteria;

  const saved = useCallback(
    (next: HolidayPeriod) => {
      void mutate(next, { revalidate: false });
      void invalidatePeriods({ except: [traegerKeys.period(id)] });
    },
    [mutate, invalidatePeriods, id],
  );

  const loadError = periodError ?? schoolsError;
  const shownError = metadataLoadError(
    loadError,
    Boolean(period && schools),
    periodFailure,
    schoolsFailure,
  );

  return (
    <TenantPage
      info={PERIOD_INFO}
      title={period?.name ?? preview?.name ?? "Ferienzeitraum"}
      back
      backHref={listHref}
      backLabel="Zurück zu den Ferien"
      stats={
        period ? <TenantPageStats items={holidayPeriodStats(period)} /> : null
      }
      statsLoading={!period && !loadError}
      tabs={holidayPeriodTabs(
        id,
        "planung",
        period?.registrationCount,
        period?.allocationMode,
      )}
      overflowMenu={
        billingHref
          ? [
              {
                label: "Zur Abrechnung",
                description: HOLIDAY_BILLING_HINT,
                href: billingHref,
                onClick: () => undefined,
              },
            ]
          : undefined
      }
      actions={
        period ? (
          <>
            <HolidayPeriodStatusBadge period={period} />
            <HolidayPeriodPublishButton
              period={period}
              unsavedChanges={dirty}
              onPublished={saved}
            />
          </>
        ) : null
      }
      error={shownError}
      loading={!loadError && !(period && schools)}
    >
      {period && schools ? (
        <>
          <HolidayPeriodPublishCard period={period} unsavedChanges={dirty} />
          <HolidayPeriodForm
            calendar={holidayCalendar}
            key={period.id}
            period={period}
            schools={schools}
            criteria={criteria}
            onDirtyChange={setDirty}
            onCancel={() => router.push(listHref)}
            onSaved={saved}
            reload={reloadOrThrow}
          />
        </>
      ) : null}
    </TenantPage>
  );
}
