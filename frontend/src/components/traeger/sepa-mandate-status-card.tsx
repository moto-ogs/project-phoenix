"use client";

// Ob die Familie eines Vertrags ein gültiges SEPA-Mandat hat (#4695), mit dem
// Weg zur Mandatsseite. Nur Anzeige: Erfassen, Widerruf und Verlauf liegen auf
// der eigenen Seite, damit Vertrags- und Empfängerseite die Formulare nicht
// laden. Eine Rolle ohne „Abrechnung“ bekommt 403; dann bleibt die Karte weg.

import { ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { ApiError } from "~/lib/api-error";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchSepaMandates } from "~/lib/traeger-sepa-api";
import { traegerPath } from "~/lib/traeger-url";
import { useFreshTraegerResource } from "./use-traeger-resource";

/** The address of the mandate page of a contract's family. */
function sepaMandatePath(contractId: string): string {
  return traegerPath(
    `/traeger/abrechnung/lastschrift/${encodeURIComponent(contractId)}`,
  );
}

export function SepaMandateStatusCard({
  contractId,
}: Readonly<{ contractId: string }>) {
  // The page around it still works; the card says it could not load.
  const { data: mandates, failure } = useFreshTraegerResource(
    traegerBillingRunKeys.sepaMandates(contractId),
    () => fetchSepaMandates(contractId),
    "das Mandat",
  );
  if (failure instanceof ApiError && failure.status === 403) return null;
  const failed = mandates === null && Boolean(failure);
  const inForce = mandates?.find((mandate) => !mandate.revokedOn);

  return (
    <SectionCard
      title="SEPA-Lastschriftmandat"
      titleBadge={
        mandates ? (
          inForce?.creditorCurrent ? (
            <StatusBadge tone="green" label="Gültig" />
          ) : inForce ? (
            <StatusBadge tone="warning" label="Neues Mandat nötig" />
          ) : (
            <StatusBadge tone="warning" label="Kein gültiges Mandat" />
          )
        ) : null
      }
      description={
        failed
          ? "Der Stand des Mandats konnte nicht geladen werden."
          : inForce && !inForce.creditorCurrent
            ? "Das Mandat gilt für deine frühere Gläubiger-ID. Bis ein neues da ist, bekommt die Familie eine Rechnung zum Überweisen."
            : inForce
              ? `Mandatsreferenz ${inForce.reference} · Konto ${inForce.ibanMasked}`
              : "Ohne Mandat bekommt die Familie eine Rechnung zum Überweisen."
      }
      loading={mandates === null && !failed}
      actions={
        <ButtonLink
          href={sepaMandatePath(contractId)}
          variant="outline"
          size="md"
          tooltip={
            inForce
              ? "Öffnet die Mandatsseite mit Verlauf und Widerruf."
              : "Öffnet die Mandatsseite, auf der du das Mandat erfasst."
          }
        >
          {inForce ? "Mandat ansehen" : "Mandat erfassen"}
        </ButtonLink>
      }
    />
  );
}
