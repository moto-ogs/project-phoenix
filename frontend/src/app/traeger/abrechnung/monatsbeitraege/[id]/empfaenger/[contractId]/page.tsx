"use client";

// Empfänger und Zahlung einer Familie (#4689): an wen ihre Rechnungen gehen
// und wie sie zahlt, mit ihrem SEPA-Mandat (#4695). Geöffnet aus dem Monatslauf für die Familie eines
// Vertrags; eine eigene Seite, damit die Seite des Laufs das Formular nicht
// lädt. Die Abweichung der Familie wird bei jedem Öffnen gelesen, weil das
// Backend jeden Lesezugriff protokolliert; gelesen wird die Familie des
// Vertrags, genau die, die das Speichern schreibt, mit ihrem Stand für die
// Prüfung beim Speichern (ADR 0311).

import { SepaMandateStatusCard } from "~/components/traeger/sepa-mandate-status-card";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { runDueDatesText } from "~/components/traeger/billing-payment-format";
import { formatMonth } from "~/components/traeger/care-billing-format";
import { FamilyBillingForm } from "~/components/traeger/family-billing-form";
import { useDebtorNumberFormat } from "~/components/traeger/use-debtor-number-format";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { ApiError } from "~/lib/api-error";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchContractFamilyBilling } from "~/lib/traeger-billing-terms-api";
import { fetchCareRun } from "~/lib/traeger-care-billing-api";
import { traegerPath } from "~/lib/traeger-url";

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const RECIPIENT_PAYMENT_INFO =
  "Hier legst du fest, an wen die Rechnungen dieser Familie gehen. Wähle zuerst bei „Rechnung an“ die Person. Bei Bedarf änderst du den „Zahlungsweg“.";

export default function TraegerFamilyBillingPage() {
  const params = useParams<{ id: string; contractId: string }>();
  const router = useRouter();
  const runId = params?.id ?? "";
  const contractId = params?.contractId ?? "";
  const debtorNumberFormat = useDebtorNumberFormat();
  const invalidateFamily = useInvalidateFamily();
  const runHref = traegerPath(`/traeger/abrechnung/monatsbeitraege/${runId}`);
  const object = "die Angabe zu Empfänger und Zahlung";
  const runRead = useFreshTraegerResource(
    runId ? traegerBillingRunKeys.careRun(runId) : null,
    () => fetchCareRun(runId),
    object,
  );
  const familyRead = useFreshTraegerResource(
    contractId ? traegerBillingRunKeys.contractFamilyBilling(contractId) : null,
    () => fetchContractFamilyBilling(contractId),
    object,
  );
  const run = runRead.data;
  const invoice =
    run?.invoices.find((entry) => entry.contractId === contractId) ?? null;
  const missing = useMemo(
    () =>
      run && !invoice
        ? new ApiError("Die Rechnung gehört nicht zu diesem Lauf.", 404)
        : null,
    [run, invoice],
  );
  const missingError = useSwrLoadError(missing, object, runRead.reload);
  const loadError = runRead.error ?? familyRead.error ?? missingError;
  const loaded =
    run && invoice && familyRead.data
      ? { run, invoice, family: familyRead.data }
      : null;

  const childName = loaded
    ? `${loaded.invoice.childFirstName} ${loaded.invoice.childLastName}`.trim()
    : "";

  return (
    <TenantPage
      info={RECIPIENT_PAYMENT_INFO}
      title={
        childName
          ? `Empfänger und Zahlung: Familie von ${childName}`
          : "Empfänger und Zahlung"
      }
      back
      backHref={runHref}
      backLabel="Zurück zum Monatslauf"
      stats={
        loaded ? (
          <span>Monatsbeitrag {formatMonth(loaded.run.billingMonth)}</span>
        ) : null
      }
      statsLoading={!loaded && !loadError}
      error={loadError}
      loading={!loadError && !loaded}
    >
      {loaded ? (
        <SectionCard title="Empfänger und Zahlung">
          <FamilyBillingForm
            target={{
              contractId,
              applicantName:
                loaded.invoice.recipient.kind === "payer"
                  ? ""
                  : `${loaded.invoice.recipient.firstName} ${loaded.invoice.recipient.lastName}`.trim(),
              childName,
              issued: loaded.invoice.number !== "",
            }}
            format={debtorNumberFormat}
            existing={loaded.family.family}
            version={loaded.family.version}
            // The stored state arrives through `familyRead`.
            reload={async () => {
              await familyRead.reloadOrThrow();
              return undefined;
            }}
            runDueText={runDueDatesText(loaded.run.dueDates ?? [])}
            onCancel={() => router.push(runHref)}
            onSaved={() => {
              // The run names the recipient of each invoice; the contract
              // page shows the family's recipient and payment.
              void invalidateFamily(
                traegerBillingRunKeys.contractFamilyBillingFamily,
              );
              void invalidateFamily(traegerBillingRunKeys.careRun(runId));
              router.push(runHref);
            }}
          />
        </SectionCard>
      ) : null}
      {loaded ? <SepaMandateStatusCard contractId={contractId} /> : null}
    </TenantPage>
  );
}
