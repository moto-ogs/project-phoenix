"use client";

// Ob die Familie eines Vertrags ein gültiges SEPA-Mandat hat (#4695), mit dem
// Weg zur Mandatsseite. Nur Anzeige: Erfassen, Widerruf und Verlauf liegen auf
// der eigenen Seite, damit Vertrags- und Empfängerseite die Formulare nicht
// laden. Eine Rolle ohne „Abrechnung“ bekommt 403; dann bleibt die Karte weg.

import { ButtonLink } from "~/components/ui/button";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { ApiError } from "~/lib/api-error";
import { directDebitConcept } from "~/lib/concepts/directDebit";
import { berlinTodayISO } from "~/lib/date-helpers";
import { traegerBillingRunKeys } from "~/lib/swr/traeger-billing-run-keys";
import { fetchSepaMandates } from "~/lib/traeger-sepa-api";
import { traegerPath } from "~/lib/traeger-url";
import { mandateCollectable } from "./sepa-format";
import { useFreshTraegerResource } from "./use-traeger-resource";

/** The address of the mandate page of a contract's family. */
function sepaMandatePath(contractId: string): string {
  return traegerPath(
    `/traeger/abrechnung/lastschrift/${encodeURIComponent(contractId)}`,
  );
}

/** The mandates of a contract's family as the status card reads them. */
export type SepaMandateStatusRead = ReturnType<typeof useSepaMandateStatus>;

/**
 * Reads the mandates of a contract's family for the status card. A page
 * that also needs the answer (the payment form names a missing mandate,
 * #7770) reads once and hands it to `SepaMandateStatusView`.
 */
export function useSepaMandateStatus(contractId: string) {
  // The page around it still works; the card says it could not load.
  const { data: mandates, failure } = useFreshTraegerResource(
    traegerBillingRunKeys.sepaMandates(contractId),
    () => fetchSepaMandates(contractId),
    "das Mandat",
  );
  const inForce = mandates?.find((mandate) => !mandate.revokedOn);
  return {
    mandates,
    failure,
    inForce,
    /**
     * Whether a direct debit can be collected today: a mandate in force
     * for the current creditor. null while loading or after a failed read.
     */
    collectable: mandates
      ? Boolean(inForce && mandateCollectable(inForce, berlinTodayISO()))
      : null,
  };
}

export function SepaMandateStatusCard({
  contractId,
  withIcon = false,
}: Readonly<{
  contractId: string;
  /** See `SepaMandateStatusView` `withIcon`. */
  withIcon?: boolean;
}>) {
  return (
    <SepaMandateStatusView
      contractId={contractId}
      read={useSepaMandateStatus(contractId)}
      withIcon={withIcon}
    />
  );
}

export function SepaMandateStatusView({
  contractId,
  read: { mandates, failure, inForce, collectable },
  plainFallback = false,
  withIcon = false,
}: Readonly<{
  contractId: string;
  read: SepaMandateStatusRead;
  /**
   * Says only that nothing is collected without a mandate. Where staff
   * choose the payment method, the card must not promise a transfer
   * invoice: a Träger can block the run instead (#7770).
   */
  plainFallback?: boolean;
  /**
   * Shows the direct-debit symbol in the card head (#8221), where the page
   * holds several topic cards. Off by default: the card looks as before.
   */
  withIcon?: boolean;
}>) {
  if (failure instanceof ApiError && failure.status === 403) return null;
  const failed = mandates === null && Boolean(failure);
  // In force for the current creditor and still no proof for a collection:
  // expired, or a one-off mandate already used.
  const spent = Boolean(inForce?.creditorCurrent) && collectable === false;

  return (
    <SectionCard
      concept={withIcon ? directDebitConcept : undefined}
      title="SEPA-Lastschriftmandat"
      titleBadge={
        mandates ? (
          collectable ? (
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
          : spent
            ? "Mit diesem Mandat kann nicht mehr abgebucht werden: Es ist verfallen oder galt nur für eine Abbuchung. Widerrufe es und erfasse ein neues."
            : inForce && !inForce.creditorCurrent
              ? plainFallback
                ? "Das Mandat gilt für eine andere Gläubiger-ID als die der Stelle, die hier abrechnet. Bis ein neues da ist, wird nicht abgebucht."
                : "Das Mandat gilt für eine andere Gläubiger-ID als die der Stelle, die hier abrechnet. Bis ein neues da ist, bekommt die Familie eine Rechnung zum Überweisen."
              : inForce
                ? `Mandatsreferenz ${inForce.reference} · Konto ${inForce.ibanMasked}`
                : plainFallback
                  ? "Ohne gültiges Mandat wird nicht abgebucht."
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
