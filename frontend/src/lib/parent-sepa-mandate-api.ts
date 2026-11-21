// SEPA-Lastschrift-Mandat in der Eltern-App (#4696): Eltern erteilen das
// Mandat ihrer Familie zu einem Betreuungsvertrag, lesen es und widerrufen
// es. Der Text des Mandats kommt vom Backend; bestätigt wird genau dieser
// Text über seine Prüfsumme. Die volle IBAN geht nur hin, nie zurück.

import { apiErrorFromResponse, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type {
  SEPAMandateInput as WireSepaMandateInput,
  SEPAMandateSummary as WireSepaMandate,
  SEPAMandateText as WireSepaMandateText,
  SEPAMandateView as WireSepaMandateView,
} from "./contract/parent-me.generated";
import { requiredDay } from "./contract/required-day";

// Go does not register this set; the contract types it as string. A value
// this build does not know stays undefined instead of passing as a known one.
const MANDATE_SOURCE_VALUES = ["office", "import", "parent"] as const;

type MandateSource = (typeof MANDATE_SOURCE_VALUES)[number];

interface SepaMandateCreditor {
  readonly name: string;
  readonly address: string;
  readonly creditorId: string;
}

interface SepaMandatePrefill {
  readonly accountHolder: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

interface SepaMandateProof {
  readonly channel: string;
  readonly version: string;
  readonly textSha256: string;
  readonly text: string;
  /** Instant of the confirmation, RFC 3339. */
  readonly confirmedAt: string;
}

export interface SepaMandate {
  readonly collectionEligible: boolean;
  readonly id: string;
  readonly reference: string;
  /** Calendar date of the signature, YYYY-MM-DD. */
  readonly signedOn: string;
  readonly accountHolder: string;
  readonly ibanMasked: string;
  readonly bic: string;
  /** undefined: a source this build does not know. */
  readonly source: MandateSource | undefined;
  readonly creditorId: string;
  readonly revokedOn: string | null;
  readonly proof: SepaMandateProof | null;
}

export interface SepaMandateView {
  /** The Träger takes the mandate in the parents portal. */
  readonly enabled: boolean;
  /** The account may give and revoke the mandate here. */
  readonly canManage: boolean;
  /** The Träger cannot take a mandate yet (no creditor ID or address). */
  readonly creditorMissing: boolean;
  readonly creditor: SepaMandateCreditor | null;
  readonly mandate: SepaMandate | null;
  readonly prefill: SepaMandatePrefill | null;
}

export interface SepaMandateInput {
  readonly accountHolder: string;
  readonly iban: string;
  readonly bic: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

export interface SepaMandateText {
  readonly version: string;
  readonly reference: string;
  readonly text: string;
  readonly textSha256: string;
  /** Sealed IBAN of the preview; the grant holds only for that account. */
  readonly accountToken: string;
}

const path = (organizationId: string, contractId: string) =>
  `/api/parent/me/documents/${encodeURIComponent(organizationId)}/contracts/${encodeURIComponent(contractId)}/sepa-mandate`;

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await transportFetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `SEPA mandate failed: ${response.status}`,
    );
  }
  const { data } = (await response.json()) as { data: T };
  return data;
}

function mapMandate(mandate: WireSepaMandate): SepaMandate {
  return {
    id: mandate.id,
    collectionEligible: mandate.collection_eligible,
    reference: mandate.reference,
    signedOn: requiredDay(mandate.signed_on, "SEPAMandateSummary.signed_on"),
    accountHolder: mandate.account_holder,
    ibanMasked: mandate.iban_masked,
    bic: mandate.bic,
    source: knownEnum(MANDATE_SOURCE_VALUES, mandate.source),
    creditorId: mandate.creditor_id,
    revokedOn: mandate.revoked_on,
    proof: mandate.proof
      ? {
          channel: mandate.proof.channel,
          version: mandate.proof.version,
          textSha256: mandate.proof.text_sha256,
          text: mandate.proof.text,
          confirmedAt: mandate.proof.confirmed_at,
        }
      : null,
  };
}

function mapView(view: WireSepaMandateView): SepaMandateView {
  return {
    enabled: view.enabled,
    canManage: view.can_manage,
    creditorMissing: view.creditor_missing,
    creditor: view.creditor
      ? {
          name: view.creditor.name,
          address: view.creditor.address,
          creditorId: view.creditor.creditor_id,
        }
      : null,
    mandate: view.mandate ? mapMandate(view.mandate) : null,
    prefill: view.prefill
      ? {
          accountHolder: view.prefill.account_holder,
          street: view.prefill.street,
          postalCode: view.prefill.postal_code,
          city: view.prefill.city,
        }
      : null,
  };
}

function inputBody(input: SepaMandateInput): WireSepaMandateInput {
  return {
    account_holder: input.accountHolder,
    iban: input.iban,
    bic: input.bic,
    street: input.street,
    postal_code: input.postalCode,
    city: input.city,
  };
}

/** The family's mandate on a contract of the inbox. */
export async function fetchSepaMandate(
  organizationId: string,
  contractId: string,
): Promise<SepaMandateView> {
  return mapView(
    await request<WireSepaMandateView>(path(organizationId, contractId), {
      method: "GET",
    }),
  );
}

/** The mandate text the parents confirm next. */
export async function previewSepaMandate(
  organizationId: string,
  contractId: string,
  input: SepaMandateInput,
  reference?: string,
): Promise<SepaMandateText> {
  const text = await request<WireSepaMandateText>(
    `${path(organizationId, contractId)}/preview`,
    {
      method: "POST",
      body: JSON.stringify({
        ...inputBody(input),
        reference: reference ?? "",
      } satisfies WireSepaMandateInput),
    },
  );
  return {
    version: text.version,
    reference: text.reference,
    text: text.text,
    textSha256: text.text_sha256,
    accountToken: text.account_token,
  };
}

/** The parents give the mandate whose text they confirmed. */
export async function grantSepaMandate(
  organizationId: string,
  contractId: string,
  input: SepaMandateInput,
  confirmed: Pick<SepaMandateText, "reference" | "textSha256" | "accountToken">,
): Promise<SepaMandateView> {
  return mapView(
    await request<WireSepaMandateView>(path(organizationId, contractId), {
      method: "POST",
      body: JSON.stringify({
        ...inputBody(input),
        reference: confirmed.reference,
        text_sha256: confirmed.textSha256,
        account_token: confirmed.accountToken,
        holder_confirmed: true,
      } satisfies WireSepaMandateInput),
    }),
  );
}

/** The parents revoke the mandate of their family. */
export async function revokeSepaMandate(
  organizationId: string,
  contractId: string,
): Promise<SepaMandateView> {
  return mapView(
    await request<WireSepaMandateView>(
      `${path(organizationId, contractId)}/revoke`,
      {
        method: "POST",
        body: "{}",
      },
    ),
  );
}
