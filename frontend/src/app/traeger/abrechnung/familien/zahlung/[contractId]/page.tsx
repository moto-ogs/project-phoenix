"use client";

// Empfänger und Zahlung einer Familie ohne Monatslauf (#7770): das Büro legt
// den Zahlungsweg fest, sobald der Vertrag da ist, also schon vor der ersten
// Rechnung. Die Familie nennt ihr Vertrag; Geschwister teilen dieselbe
// Angabe. Speichern schreibt nur die Angabe der Familie: keine Rechnung,
// kein Lauf, keine Abbuchung, und das Mandat bleibt, wie es ist. Erreichbar
// aus „Familien und Zahlung“ und aus dem Vertrag.

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  FAMILY_PAYMENT_FROM_CONTRACT,
  familiesPath,
  familyPaymentFilterOf,
  termsPaymentText,
} from "~/components/traeger/billing-payment-format";
import { FamilyBillingForm } from "~/components/traeger/family-billing-form";
import {
  SepaMandateStatusView,
  useSepaMandateStatus,
} from "~/components/traeger/sepa-mandate-status-card";
import { useDebtorNumberFormat } from "~/components/traeger/use-debtor-number-format";
import {
  useFreshTraegerResource,
  useTraegerResource,
} from "~/components/traeger/use-traeger-resource";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { parentsConcept } from "~/lib/concepts/parents";
import { familyKeyEmail } from "~/lib/family-key";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchBillingTerms,
  fetchContractFamilyBilling,
} from "~/lib/traeger-billing-terms-api";
import { traegerPath } from "~/lib/traeger-url";

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const FAMILY_PAYMENT_INFO =
  "Hier legst du fest, an wen die Rechnungen dieser Familie gehen und wie sie zahlt. Das geht schon vor der ersten Rechnung. Wähle zuerst den „Zahlungsweg“.";

export default function TraegerFamilyPaymentPage() {
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin lädt die Seite.
  return (
    <Suspense fallback={<TenantPage title="Empfänger und Zahlung" loading />}>
      <FamilyPaymentContent />
    </Suspense>
  );
}

function FamilyPaymentContent() {
  const params = useParams<{ contractId: string }>();
  const router = useRouter();
  const contractId = params?.contractId ?? "";
  const query = useSearchParams();
  const fromContract = query.get("von") === FAMILY_PAYMENT_FROM_CONTRACT;
  // The list comes back under the filter the family was opened from.
  const backHref = fromContract
    ? traegerPath(`/traeger/vertraege/${encodeURIComponent(contractId)}`)
    : familiesPath(familyPaymentFilterOf(query.get("zahlung")));
  const debtorNumberFormat = useDebtorNumberFormat();
  const invalidateFamily = useInvalidateFamily();
  const object = "die Angabe zu Empfänger und Zahlung";
  // Read on every opening: the backend records each read of a deviation
  // in its trail. The save sends its version back (ADR 0311).
  const familyRead = useFreshTraegerResource(
    contractId ? traegerBillingRunKeys.contractFamilyBilling(contractId) : null,
    () => fetchContractFamilyBilling(contractId),
    object,
  );
  // The Vorgaben only word a hint: the form works without them.
  const terms = useTraegerResource(
    traegerKeys.billingTerms(),
    fetchBillingTerms,
    "die Abrechnungsvorgaben",
  );
  const mandate = useSepaMandateStatus(contractId);
  const loaded = familyRead.data;
  const email = loaded ? familyKeyEmail(loaded.familyEmail) : "";

  return (
    <TenantPage
      info={FAMILY_PAYMENT_INFO}
      title={
        loaded?.partyLastName
          ? `Empfänger und Zahlung: Familie ${loaded.partyLastName}`
          : "Empfänger und Zahlung"
      }
      back
      backHref={backHref}
      backLabel={fromContract ? "Zurück zum Vertrag" : "Zurück zu den Familien"}
      error={familyRead.error}
      loading={!familyRead.error && !loaded}
    >
      {loaded ? (
        // The card names whose family this is, so nobody sets the payment
        // of the wrong one: the page title carries only the last name.
        <SectionCard
          concept={parentsConcept}
          title={loaded.partyName || "Familie ohne Namen im Vertrag"}
          description={
            email ? `Person im Vertrag · ${email}` : "Person im Vertrag"
          }
        >
          <FamilyBillingForm
            target={{
              contractId,
              applicantName: loaded.partyName,
              childName: "",
              issued: false,
              withoutRun: true,
            }}
            format={debtorNumberFormat}
            existing={loaded.family}
            version={loaded.version}
            onChangedSinceRead={familyRead.reload}
            termsText={terms.data ? termsPaymentText(terms.data) : null}
            mandateInForce={mandate.collectable}
            onCancel={() => router.push(backHref)}
            onSaved={() => {
              // The list of families names the payment method, the runs
              // take it for their next invoices.
              void invalidateFamily(
                traegerBillingRunKeys.contractFamilyBillingFamily,
              );
              void invalidateFamily(traegerBillingKeys.familiesFamily);
              router.push(backHref);
            }}
          />
        </SectionCard>
      ) : null}
      {loaded ? (
        <SepaMandateStatusView
          contractId={contractId}
          read={mandate}
          plainFallback
        />
      ) : null}
    </TenantPage>
  );
}
