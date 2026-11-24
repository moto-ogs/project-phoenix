import { bffJson } from "~/lib/bff-fetch";
/**
 * Dokumentart je Leistung (#4688): Rechnung, Gebührenbescheid oder (nur
 * Ferien) Bestätigungsschreiben als Rechnung. Die Freigabe eines Laufs hält
 * die Art auf jedem Beleg fest. Ein Gebührenbescheid braucht die
 * Rechtsbehelfsbelehrung der Vorlage „Bescheid“.
 */

import { knownEnum } from "./contract/known-enum";
import type * as traegerBillingDocumentKindsContract from "./contract/traeger-billing-document-kinds.generated";

// Go does not register these sets; the contract types them as string.
const SERVICE_VALUES = ["holiday", "care"] as const;
const DOCUMENT_KIND_VALUES = ["confirmation", "invoice", "fee_notice"] as const;

export type BillingService = (typeof SERVICE_VALUES)[number];
export type DocumentKind = (typeof DOCUMENT_KIND_VALUES)[number];

export interface ServiceDocumentKind {
  readonly service: BillingService;
  /** undefined: a kind this build does not know; the card asks for a choice. */
  readonly documentKind: DocumentKind | undefined;
  /** Die Arten, die die Leistung ausstellen kann; die erste ist der Standard. */
  readonly choices: readonly DocumentKind[];
  /** Zeitpunkt der Wahl; `null`, solange der Standard gilt. */
  readonly updatedAt: string | null;
}

export interface DocumentKindOverview {
  readonly services: readonly ServiceDocumentKind[];
  /** Die Vorlage „Bescheid“ hat eine Rechtsbehelfsbelehrung. */
  readonly legalRemedySet: boolean;
  /** Version der Vorlage „Bescheid“; 0 = Standardvorlage. */
  readonly feeNoticeTemplateVersion: number;
}

/** Name einer Dokumentart, wie Schreiben und Übersicht sie nennen. */
export const DOCUMENT_KIND_LABEL: Readonly<Record<DocumentKind, string>> = {
  confirmation: "Bestätigung und Rechnung",
  invoice: "Rechnung",
  fee_notice: "Gebührenbescheid",
};

/** Name einer Leistung. */
export const BILLING_SERVICE_LABEL: Readonly<Record<BillingService, string>> = {
  holiday: "Ferienbetreuung",
  care: "Monatsbeitrag",
};

// A service this build does not know has no card and is left out; a choice
// it does not know is left out of the choices.
function overviewFromBackend(
  body: traegerBillingDocumentKindsContract.DocumentKindOverview,
): DocumentKindOverview {
  return {
    services: (body.services ?? []).flatMap((entry) => {
      const service = knownEnum(SERVICE_VALUES, entry.service);
      if (!service) return [];
      return [
        {
          service,
          documentKind: knownEnum(DOCUMENT_KIND_VALUES, entry.document_kind),
          choices: (entry.choices ?? []).flatMap((choice) => {
            const kind = knownEnum(DOCUMENT_KIND_VALUES, choice);
            return kind ? [kind] : [];
          }),
          updatedAt: entry.updated_at,
        },
      ];
    }),
    legalRemedySet: body.legal_remedy_set,
    feeNoticeTemplateVersion: body.fee_notice_template_version,
  };
}

export async function fetchDocumentKinds(): Promise<DocumentKindOverview> {
  return overviewFromBackend(
    await bffJson("org", "GET /traeger/billing-document-kinds/"),
  );
}

/**
 * Wählt die Art einer Leistung; issuerKey nennt einen Schulträger oder eine
 * Gemeinde, die selbst abrechnet (#8040), leer den Träger.
 */
export async function saveDocumentKind(
  service: BillingService,
  documentKind: DocumentKind,
  issuerKey = "",
): Promise<DocumentKindOverview> {
  return overviewFromBackend(
    await bffJson("org", "PUT /traeger/billing-document-kinds/{service}", {
      params: { service },
      body: {
        document_kind: documentKind,
        ...(issuerKey ? { issuer_key: issuerKey } : {}),
      } satisfies traegerBillingDocumentKindsContract.DocumentKindRequest,
    }),
  );
}

/**
 * Takes over only the service a card saved: two cards may save at once, and
 * the answer of one must not hide the choice the other just stored.
 */
export function mergeSavedService(
  current: DocumentKindOverview | null,
  next: DocumentKindOverview,
  saved: BillingService,
): DocumentKindOverview {
  if (!current) return next;
  return {
    ...next,
    services: current.services.map((service) =>
      service.service === saved
        ? (next.services.find((candidate) => candidate.service === saved) ??
          service)
        : service,
    ),
  };
}
