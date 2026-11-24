import { bffJson } from "~/lib/bff-fetch";
/**
 * Was ein Schulträger oder eine Gemeinde noch braucht, um die Eltern einer
 * Schule selbst abzurechnen (#8040, ADR 0321): Nummernkreis und Dokumentart
 * je Leistung, die Rechtsbehelfsbelehrung eines Bescheids und wie viele
 * Familien per Lastschrift zahlen und noch kein Mandat für die Stelle
 * haben. Die Antwort zählt nur, sie nennt keine Familie. Der Träger selbst
 * steht nicht darin: seine Pflichtangaben stehen in den Einstellungen.
 */

import { knownEnum } from "./contract/known-enum";
import type * as contract from "./contract/traeger-required-details.generated";

const SERVICE_VALUES = ["holiday", "care"] as const;
const DOCUMENT_KIND_VALUES = ["confirmation", "invoice", "fee_notice"] as const;
const BODY_VALUES = ["schultraeger", "gemeinde"] as const;

export type IssuerService = (typeof SERVICE_VALUES)[number];
export type IssuerDocumentKind = (typeof DOCUMENT_KIND_VALUES)[number];
export type IssuerBody = (typeof BODY_VALUES)[number];

/** Eine Stelle, die die Eltern einer Schule selbst abrechnet. */
export interface BillingIssuer {
  /** Die Gläubiger-ID der Stelle; sie benennt den Rechnungssteller. */
  readonly key: string;
  readonly body: IssuerBody | undefined;
  readonly name: string;
}

export interface IssuerServiceState {
  readonly service: IssuerService;
  /** Leer, solange kein Muster festgelegt ist. */
  readonly pattern: string;
  /** undefined: eine Art, die dieser Stand nicht kennt. */
  readonly documentKind: IssuerDocumentKind | undefined;
  readonly choices: readonly IssuerDocumentKind[];
}

export interface BillingIssuerStatus {
  readonly issuer: BillingIssuer;
  readonly schoolIds: readonly string[];
  readonly services: readonly IssuerServiceState[];
  /** Ein Gebührenbescheid der Stelle braucht noch die Belehrung. */
  readonly legalRemedyMissing: boolean;
  /** Familien, die an den Schulen der Stelle per Lastschrift zahlen. */
  readonly directDebitFamilies: number;
  /** Davon ohne Mandat für die Gläubiger-ID der Stelle. */
  readonly familiesWithoutMandate: number;
  /** Die Stelle trägt die Gläubiger-ID des Trägers: keine Freigabe. */
  readonly creditorIsTraegers: boolean;
}

function statusFromBackend(
  entry: contract.BillingIssuerStatus,
): BillingIssuerStatus {
  const kinds = entry.document_kinds ?? [];
  return {
    issuer: {
      key: entry.issuer.key,
      body: knownEnum(BODY_VALUES, entry.issuer.body),
      name: entry.issuer.name,
    },
    schoolIds: entry.school_ids ?? [],
    services: (entry.number_ranges ?? []).flatMap((range) => {
      const service = knownEnum(SERVICE_VALUES, range.service);
      if (!service) return [];
      const kind = kinds.find((candidate) => candidate.service === service);
      return [
        {
          service,
          pattern: range.pattern,
          documentKind: knownEnum(DOCUMENT_KIND_VALUES, kind?.document_kind),
          choices: (kind?.choices ?? []).flatMap((choice) => {
            const known = knownEnum(DOCUMENT_KIND_VALUES, choice);
            return known ? [known] : [];
          }),
        },
      ];
    }),
    legalRemedyMissing: entry.legal_remedy_missing,
    directDebitFamilies: entry.direct_debit_families,
    familiesWithoutMandate: entry.families_without_mandate,
    creditorIsTraegers: entry.creditor_is_traegers,
  };
}

/** Jede Stelle, die eine Schule des Trägers selbst abrechnet. */
export async function fetchBillingIssuerStatuses(): Promise<
  BillingIssuerStatus[]
> {
  const body = await bffJson("org", "GET /traeger/required-details/issuers");
  return (body.issuers ?? []).map(statusFromBackend);
}
