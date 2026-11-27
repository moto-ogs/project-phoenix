"use client";

// Anmeldeformular eines Ferienzeitraums (#5198): die Fragen, die Eltern bei
// der Ferienanmeldung zusätzlich zu den festen Angaben beantworten. Jede
// gespeicherte Änderung ist eine neue Version; eine abgeschickte Anmeldung
// behält ihre Version.

import { useParams } from "next/navigation";
import {
  HolidayPeriodStatusBadge,
  holidayPeriodStats,
  holidayPeriodTabs,
} from "~/components/traeger/holiday-period-head";
import { HolidayFormEditor } from "~/components/traeger/holiday-form-editor";
import {
  HOLIDAY_BILLING_HINT,
  useHolidayPeriodBillingHref,
} from "~/components/traeger/use-holiday-period-billing-href";
import { holidayListBack } from "~/components/traeger/holiday-period-format";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { formatBerlinDate } from "~/lib/date-helpers";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { useTraegerHolidayPeriod } from "~/components/traeger/use-traeger-resources";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { fetchHolidayForm } from "~/lib/traeger-holiday-form-api";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerHolidayFormPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const {
    data: period,
    preview,
    loadError: periodError,
  } = useTraegerHolidayPeriod(id);
  const billingHref = useHolidayPeriodBillingHref(period);
  const {
    data: form,
    error: formError,
    mutate,
    reloadOrThrow,
  } = useTraegerResource(
    id ? traegerKeys.holidayForm(id) : null,
    () => fetchHolidayForm(id),
    "das Anmeldeformular",
  );
  const loadError = formError ?? periodError;

  return (
    <TenantPage
      title={period?.name ?? preview?.name ?? "Ferienzeitraum"}
      back
      backHref={traegerPath(holidayListBack(period?.kind).path)}
      backLabel={holidayListBack(period?.kind).label}
      info={
        <p>
          Hier legst du fest, was Eltern bei der Ferienanmeldung zusätzlich
          angeben. Name, Geburtsdatum, Schule, Wochen, Gesundheit, Kontakte und
          Zustimmungen fragt die Anmeldung immer ab. Jedes Speichern legt eine
          neue Version an. Schon abgeschickte Anmeldungen behalten ihre Version.
        </p>
      }
      stats={
        period && form ? (
          <TenantPageStats
            items={[
              ...holidayPeriodStats(period),
              {
                label: `Formular Version ${form.version}, gespeichert am ${formatBerlinDate(form.createdAt)}`,
              },
            ]}
          />
        ) : null
      }
      statsLoading={!(period && form) && !loadError}
      tabs={holidayPeriodTabs(
        id,
        "formular",
        period?.registrationCount,
        period?.allocationMode,
        period?.kind,
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
      actions={period ? <HolidayPeriodStatusBadge period={period} /> : null}
      error={loadError}
      loading={!loadError && !(period && form)}
    >
      {period && form ? (
        <HolidayFormEditor
          periodId={id}
          form={form}
          onSaved={(saved) => void mutate(saved, { revalidate: false })}
          reload={reloadOrThrow}
        />
      ) : null}
    </TenantPage>
  );
}
