"use client";

// Empfänger und Zahlung der Familie eines Vertrags (#7770), mit dem Weg zur
// Seite, auf der das Büro beides festlegt. Nur Anzeige: so sieht man am
// Vertrag, wie die Familie zahlt, schon vor der ersten Rechnung, und die
// Vertragsseite lädt das Formular nicht. Eine Rolle ohne „Abrechnung“
// bekommt 403; dann bleibt die Karte weg.

import { ButtonLink } from "~/components/ui/button";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { SectionCard } from "~/components/ui/section-card";
import { ApiError } from "~/lib/api-error";
import { billingConcept } from "~/lib/concepts/billing";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import {
  type FamilyBilling,
  fetchContractFamilyBilling,
} from "~/lib/traeger-billing-terms-api";
import {
  PAYMENT_METHOD_LABELS,
  familyPaymentPath,
} from "./billing-payment-format";
import { useFreshTraegerResource } from "./use-traeger-resource";

/** Who the family's invoices go to, as one phrase. */
function recipientText(family: FamilyBilling | null, partyName: string) {
  if (family?.recipientKind === "both") {
    const second = `${family.secondFirstName} ${family.secondLastName}`.trim();
    return [partyName, second].filter(Boolean).join(" und ") || "Beide Eltern";
  }
  if (family?.recipientKind === "payer") {
    const payer = `${family.payerFirstName} ${family.payerLastName}`.trim();
    return payer ? `${payer} (andere Person)` : "Andere Person";
  }
  return partyName || "Person im Vertrag";
}

export function FamilyBillingStatusCard({
  contractId,
}: Readonly<{ contractId: string }>) {
  // The page around it still works; the card says it could not load.
  const { data, failure } = useFreshTraegerResource(
    traegerBillingRunKeys.contractFamilyBilling(contractId),
    () => fetchContractFamilyBilling(contractId),
    "die Angabe zu Empfänger und Zahlung",
  );
  if (failure instanceof ApiError && failure.status === 403) return null;
  const failed = data === null && Boolean(failure);
  const family = data?.family ?? null;

  return (
    <SectionCard
      concept={billingConcept}
      title="Empfänger und Zahlung"
      description={
        failed
          ? "Empfänger und Zahlung konnten nicht geladen werden."
          : "Gilt für alle neuen Rechnungen der Familie, auch für Geschwister."
      }
      loading={data === null && !failed}
      actions={
        <ButtonLink
          href={familyPaymentPath(contractId, { contract: true })}
          variant="outline"
          size="md"
          tooltip="Öffnet die Seite, auf der du Empfänger, Zahlungsweg und Zahltag der Familie festlegst."
        >
          Ändern
        </ButtonLink>
      }
    >
      {data ? (
        <DataGrid columns={4}>
          <DataField label="Rechnung an">
            {recipientText(family, data.partyName)}
          </DataField>
          <DataField label="Zahlungsweg">
            {family?.paymentMethod
              ? PAYMENT_METHOD_LABELS[family.paymentMethod]
              : "Wie in den Abrechnungsvorgaben"}
          </DataField>
          <DataField label="Zahltag">
            {family?.dueDay ? `Am ${family.dueDay}. des Monats` : "Wie im Lauf"}
          </DataField>
        </DataGrid>
      ) : null}
    </SectionCard>
  );
}
