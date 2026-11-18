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
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { billingConcept } from "~/lib/concepts/billing";
import { ButtonLink } from "~/components/ui/button";
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
      backHref={traegerPath("/traeger/ferien")}
      backLabel="Zurück zu den Ferien"
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
      )}
      actions={
        <>
          {period ? <HolidayPeriodStatusBadge period={period} /> : null}
          {billingHref ? (
            <ButtonLink
              href={billingHref}
              variant="outline"
              size="md"
              tooltip={HOLIDAY_BILLING_HINT}
            >
              <MotoConceptIcon
                concept={billingConcept}
                size={18}
                className="mr-2"
              />
              Zur Abrechnung
            </ButtonLink>
          ) : null}
        </>
      }
      error={loadError}
      loading={!loadError && !(period && form)}
    >
      {period && form ? (
        <HolidayFormEditor
          key={form.version}
          periodId={id}
          form={form}
          onSaved={(saved) => void mutate(saved, { revalidate: false })}
        />
      ) : null}
    </TenantPage>
  );
}
