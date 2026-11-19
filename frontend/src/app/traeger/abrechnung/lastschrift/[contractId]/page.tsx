"use client";

// Das SEPA-Lastschriftmandat der Familie eines Vertrags (#4695): erfassen,
// widerrufen, Verlauf, und seine Abbuchungen je Rechnung (#4697). Eine eigene Seite, damit Vertrags- und Empfängerseite
// nur den Stand zeigen und die Formulare nicht laden. Die Familie ist die
// E-Mail-Adresse der Vertragspartei; ihr Mandat gilt auch für Geschwister.

import { useParams } from "next/navigation";
import { SepaCollectionsCard } from "~/components/traeger/sepa-collections-card";
import { SepaMandatesCard } from "~/components/traeger/sepa-mandates-card";
import { useFreshTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TenantPage } from "~/components/ui/tenant-page";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchSepaMandates } from "~/lib/traeger-sepa-api";
import { traegerPath } from "~/lib/traeger-url";

/** Was die Seite ist und was man dort zuerst tut (#7596). */
const MANDATE_INFO =
  "Hier verwaltest du das SEPA-Lastschriftmandat einer Familie. Prüfe zuerst, ob es „Gültig“ ist. Hat die Familie noch keins, wählst du „Mandat erfassen“.";

export default function TraegerSepaMandatePage() {
  const params = useParams<{ contractId: string }>();
  const contractId = params?.contractId ?? "";
  const {
    data: mandates,
    loading,
    error,
  } = useFreshTraegerResource(
    traegerBillingRunKeys.sepaMandates(contractId),
    () => fetchSepaMandates(contractId),
    "das Mandat",
  );

  const party = mandates?.[0];
  const family = party
    ? `${party.partyFirstName} ${party.partyLastName}`.trim()
    : "";

  return (
    <TenantPage
      info={MANDATE_INFO}
      title={
        family ? `Lastschrift: Familie ${party?.partyLastName}` : "Lastschrift"
      }
      back
      backHref={traegerPath("/traeger/abrechnung/lastschrift")}
      backLabel="Zurück zur Lastschrift"
      error={error}
      loading={loading}
    >
      {mandates !== null ? (
        <>
          <SepaMandatesCard
            contractId={contractId}
            holder={family}
            mandates={mandates}
          />
          <SepaCollectionsCard mandates={mandates} />
        </>
      ) : null}
    </TenantPage>
  );
}
