"use client";

// Monatsbeiträge des Trägers (#4684): Ein Monatslauf rechnet jeden Monat
// nach dem gültigen Betreuungsvertrag und der Preisliste ab. Die Abrechnung
// wählt Monat, Schulen und Rechnungsdatum (#5916), prüft die Vorschau und
// gibt den Lauf frei. Nur die Rolle mit dem Recht „Abrechnung“ sieht die
// Seite.

import { CalendarRange, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  billingAreaTitle,
  billingTabs,
} from "~/components/traeger/billing-family-format";
import {
  CARE_RUN_STATUS_LABELS,
  CARE_RUN_STATUS_TONES,
  MONTH_RULE_LABELS,
  addMonths,
  formatMonth,
  monthRange,
  factLine,
  invoiceCountLabel,
} from "~/components/traeger/care-billing-format";
import { runSchoolsLabel } from "~/components/traeger/care-review-format";
import { formatEuro } from "~/components/traeger/contribution-format";
import {
  TraegerListExportMenu,
  traegerExportScope,
} from "~/components/traeger/traeger-list-export-menu";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { formatDate } from "~/lib/date-helpers";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import {
  type CareRun,
  type CareSchool,
  fetchCareRuns,
  fetchCareTariffs,
  startCareRun,
} from "~/lib/traeger-care-billing-api";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";

// The start dialog loads when it opens (#5916).
const CareRunStartModal = dynamic(
  () =>
    import("~/components/traeger/care-run-start-modal").then(
      (module) => module.CareRunStartModal,
    ),
  { ssr: false },
);

function runColumns(
  schools: readonly CareSchool[],
): DataTableColumn<CareRun>[] {
  return [
    {
      key: "month",
      header: "Monat",
      render: (run) => (
        <span className="font-medium whitespace-nowrap text-gray-900">
          {formatMonth(run.billingMonth)}
        </span>
      ),
      stacked: "title",
    },
    {
      key: "status",
      header: "Status",
      render: (run) => (
        <StatusBadge
          label={CARE_RUN_STATUS_LABELS[run.status]}
          tone={CARE_RUN_STATUS_TONES[run.status]}
        />
      ),
      stacked: "meta",
    },
    {
      // On a phone the line under the month: the schools, then what the run
      // issued and when (only the status is meta there).
      key: "schools",
      header: "Schulen",
      render: (run) => (
        <span className="whitespace-nowrap text-gray-700">
          {runSchoolsLabel(run.schoolIds, schools)}
        </span>
      ),
      stackedLabel: false,
      // The schools may wrap; the facts after them stay whole.
      stackedRender: (run) =>
        [
          runSchoolsLabel(run.schoolIds, schools),
          factLine([
            run.documentCount === null
              ? null
              : invoiceCountLabel(run.documentCount),
            run.documentCount === null ? null : formatEuro(run.totalCents ?? 0),
            run.issuedOn ? `ausgestellt am ${formatDate(run.issuedOn)}` : null,
          ]),
        ]
          .filter(Boolean)
          .join("\u00A0· "),
    },
    {
      key: "invoices",
      header: "Rechnungen",
      render: (run) =>
        // A preview has no invoices yet: say so instead of an empty dash.
        run.documentCount === null ? (
          <span className="whitespace-nowrap text-gray-600">
            noch nicht ausgestellt
          </span>
        ) : (
          <span className="whitespace-nowrap tabular-nums">
            {invoiceCountLabel(run.documentCount)} ·{" "}
            {formatEuro(run.totalCents ?? 0)}
          </span>
        ),
      stacked: "hidden",
    },
    {
      key: "issued",
      header: "Ausgestellt am",
      render: (run) => (
        <span className="whitespace-nowrap">
          {run.issuedOn ? formatDate(run.issuedOn) : "–"}
        </span>
      ),
      stacked: "hidden",
    },
    {
      key: "rule",
      header: "Bei Vertragsänderung im Monat",
      render: (run) => (run.monthRule ? MONTH_RULE_LABELS[run.monthRule] : "–"),
      stacked: "hidden",
    },
  ];
}

/** Twelve months back and three ahead of the suggested month, latest first. */
function startMonths(suggested: string) {
  return monthRange(addMonths(suggested, -12), 16)
    .reverse()
    .map((value) => ({ value, label: formatMonth(value) }));
}

export default function TraegerMonatsbeitraegePage() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const invalidateFamily = useInvalidateFamily();
  const runList = useTraegerResource(
    traegerBillingRunKeys.careRuns(),
    fetchCareRuns,
    "die Liste der Monatsbeiträge",
  );
  const tariffs = useTraegerResource(
    traegerBillingKeys.careTariffs(),
    fetchCareTariffs,
    "die Liste der Monatsbeiträge",
  );
  const loadError = runList.error ?? tariffs.error;
  const loading = runList.loading || tariffs.loading;
  const data =
    runList.data && tariffs.data
      ? { list: runList.data, tariffs: tariffs.data }
      : null;

  const openRun = (run: CareRun) =>
    router.push(traegerPath(`/traeger/abrechnung/monatsbeitraege/${run.id}`));

  const runs = data?.list.runs ?? [];
  const released = runs.filter((run) => run.status === "released");
  const billedCents = released.reduce(
    (sum, run) => sum + (run.totalCents ?? 0),
    0,
  );
  const noPrices = data !== null && data.tariffs.tariffs.length === 0;

  return (
    <TenantPage
      title={billingAreaTitle("monatsbeitraege")}
      info="Hier rechnen Sie die Betreuung Monat für Monat ab. Der Beitrag ist die Summe der gebuchten Wochentage im Vertrag, mit den Preisen aus der Preisliste. Sie wählen Monat und Schulen, prüfen die Vorschau und geben den Lauf dann frei."
      stats={
        runs.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: runs.length,
                label: runs.length === 1 ? "Monatslauf" : "Monatsläufe",
              },
              { value: released.length, label: "freigegeben" },
              { value: formatEuro(billedCents), label: "ausgestellt" },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      tabs={billingTabs("monatsbeitraege")}
      actions={
        <>
          <TraegerListExportMenu
            download={(format) =>
              downloadTraegerList(
                "/api/traeger/care-billing-runs/export",
                format,
              )
            }
            scope={traegerExportScope()}
            ariaLabel="Monatsläufe herunterladen"
            fallbackName="monatsbeitraege"
            errorObject="die Monatsläufe"
            unavailable={runs.length === 0}
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={!data}
            tooltip="Öffnet ein Fenster, um einen Monatslauf für Monat und Schulen zu starten."
            onClick={() => setStarting(true)}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Monatslauf starten
          </Button>
        </>
      }
      error={loadError}
      loading={loading}
      overlays={
        data ? (
          <CareRunStartModal
            isOpen={starting}
            months={startMonths(data.list.suggestedMonth)}
            initialMonth={data.list.suggestedMonth}
            onClose={() => setStarting(false)}
            onStart={startCareRun}
            onStarted={(run: CareRun) => {
              // The list and the open run of each school in the start dialog.
              void invalidateFamily(traegerBillingRunKeys.careRunsFamily);
              setStarting(false);
              openRun(run);
            }}
          />
        ) : null
      }
    >
      {data ? (
        <>
          {noPrices ? (
            <Alert
              type="info"
              message="Es gibt noch keine Preise. Ein Lauf braucht für jeden gebuchten Wochentag einen Preis."
              action={
                <ButtonLink
                  href={traegerPath("/traeger/abrechnung/preise")}
                  variant="surface"
                  size="compact"
                  tooltip="Öffnet die Preisliste, dort tragen Sie die Preise ein."
                >
                  Preisliste öffnen
                </ButtonLink>
              }
            />
          ) : null}
          <DataTable
            columns={runColumns(data.tariffs.schools)}
            rows={[...runs]}
            getRowKey={(run) => run.id}
            stackedOnMobile
            stackedLayout="row"
            stackedDetailKey="schools"
            onRowClick={openRun}
            emptyState={
              <EmptyState
                icon={
                  <CalendarRange className="h-12 w-12" aria-hidden="true" />
                }
                title="Noch kein Monatslauf."
                description={`Starten Sie oben einen Lauf, zum Beispiel für ${formatMonth(data.list.suggestedMonth)}.`}
              />
            }
          />
        </>
      ) : null}
    </TenantPage>
  );
}
