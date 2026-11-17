"use client";

// Fälligkeiten eines Monatslaufs in der Prüfphase (#4689, #5916): je
// Zahlungsweg das Datum, an dem die Rechnungen fällig sind. Eine eigene
// Seite, damit die Seite des Laufs den Datumswähler nicht lädt. Nach der
// Freigabe ändern sich die Daten nicht mehr.

import { useParams, useRouter } from "next/navigation";
import { formatMonth } from "~/components/traeger/care-billing-format";
import { careDebitItems } from "~/components/traeger/care-debit-hints";
import { RunDueDatesForm } from "~/components/traeger/run-due-dates-form";
import { usePrenotificationDays } from "~/components/traeger/use-prenotification-days";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { TenantPage } from "~/components/ui/tenant-page";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchCareRun } from "~/lib/traeger-care-billing-api";
import { traegerPath } from "~/lib/traeger-url";

export default function TraegerCareRunDueDatesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = params?.id ?? "";
  const {
    data: run,
    loading,
    error,
    reload,
  } = useTraegerResource(
    runId ? traegerBillingRunKeys.careRun(runId) : null,
    () => fetchCareRun(runId),
    "der Monatslauf",
  );
  const runHref = traegerPath(`/traeger/abrechnung/monatsbeitraege/${runId}`);

  // The pre-notification days name the rule under the direct debit date.
  const prenotificationDays = usePrenotificationDays();

  return (
    <TenantPage
      title="Fälligkeiten"
      back
      backHref={runHref}
      backLabel="Zurück zum Monatslauf"
      stats={run ? <span>{formatMonth(run.billingMonth)}</span> : null}
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
          kind="care"
          runId={run.id}
          dueDates={run.dueDates ?? []}
          debitItems={careDebitItems(run.invoices)}
          prenotificationDays={prenotificationDays}
          issuedOn={run.invoiceDate}
          onCancel={() => router.push(runHref)}
          onSaved={() => {
            // The run page shows the saved dates at once.
            reload();
            router.push(runHref);
          }}
        />
      ) : null}
    </TenantPage>
  );
}
