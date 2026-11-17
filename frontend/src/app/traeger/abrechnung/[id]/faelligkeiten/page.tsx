"use client";

// Fälligkeiten eines Ferienlaufs vor der Freigabe (#4689): je
// Zahlungsweg das Datum, an dem die Rechnungen fällig sind. Eine eigene
// Seite, damit die Seite des Laufs den Datumswähler nicht lädt. Nach der
// Freigabe ändern sich die Daten nicht mehr.

import { useParams, useRouter } from "next/navigation";
import { holidayDebitItems } from "~/components/traeger/care-debit-hints";
import { RunDueDatesForm } from "~/components/traeger/run-due-dates-form";
import { usePrenotificationDays } from "~/components/traeger/use-prenotification-days";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { TenantPage } from "~/components/ui/tenant-page";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { fetchBillingRun } from "~/lib/traeger-billing-api";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerHolidayRunDueDatesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = params?.id ?? "";
  const {
    data: run,
    loading,
    error,
    reload,
  } = useTraegerResource(
    runId ? traegerBillingKeys.holidayRun(runId) : null,
    () => fetchBillingRun(runId),
    "der Abrechnungslauf",
  );
  const runHref = traegerPath(`/traeger/abrechnung/${runId}`);

  // The pre-notification days name the rule under the direct debit date.
  const prenotificationDays = usePrenotificationDays();

  return (
    <TenantPage
      title="Fälligkeiten"
      back
      backHref={runHref}
      backLabel="Zurück zum Abrechnungslauf"
      stats={run ? <span>{run.periodName}</span> : null}
      statsLoading={loading}
      error={error}
      loading={loading}
    >
      {run && run.status !== "calculated" ? (
        <Alert
          type="info"
          message="Der Lauf ist freigegeben. Die Rechnungen haben ihre Fälligkeit schon und ändern sich nicht mehr."
        />
      ) : null}
      {run && run.status === "calculated" ? (
        <RunDueDatesForm
          kind="holiday"
          runId={run.id}
          dueDates={run.dueDates ?? []}
          debitItems={holidayDebitItems(run.documents)}
          prenotificationDays={prenotificationDays}
          onCancel={() => router.push(runHref)}
          onSaved={() => {
            // The run's page shows the new due dates.
            reload();
            router.push(runHref);
          }}
        />
      ) : null}
    </TenantPage>
  );
}
