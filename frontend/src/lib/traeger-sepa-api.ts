import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the SEPA direct debit (#4695): the creditor of the Träger
 * (Gläubiger-ID, pre-notification days, what an invoice without a mandate
 * does) and the mandates of the families. The IBAN of a mandate never comes
 * back: the backend answers its mask only.
 * Backend int64 IDs leave here as strings; calendar dates stay "YYYY-MM-DD".
 */

import type * as traegerSepaCreditorContract from "./contract/traeger-sepa-creditor.generated";
import type * as traegerSepaMandatesContract from "./contract/traeger-sepa-mandates.generated";
import { knownEnum } from "./contract/known-enum";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const MISSING_MANDATE_VALUES = ["transfer", "block"] as const;
const MANDATE_KIND_VALUES = ["recurring", "one_off"] as const;
const MANDATE_SEQUENCE_VALUES = ["first", "recurring"] as const;
const MANDATE_SOURCE_VALUES = ["office", "import", "parent"] as const;
const EVENT_SOURCE_VALUES = [...MANDATE_SOURCE_VALUES, "run"] as const;
const MANDATE_ACTION_VALUES = [
  "create",
  "update",
  "revoke",
  "read",
  "reveal",
  "collect",
] as const;

export type MissingMandate = (typeof MISSING_MANDATE_VALUES)[number];
export type MandateKind = (typeof MANDATE_KIND_VALUES)[number];
export type MandateSequence = (typeof MANDATE_SEQUENCE_VALUES)[number];
export type MandateSource = (typeof MANDATE_SOURCE_VALUES)[number];
export type MandateAction = (typeof MANDATE_ACTION_VALUES)[number];

/** The sequence a value names, or undefined for one this build does not know. */
export function knownMandateSequence(
  value: string | undefined,
): MandateSequence | undefined {
  return knownEnum(MANDATE_SEQUENCE_VALUES, value);
}

export const MIN_PRENOTIFICATION_DAYS = 1;
export const MAX_PRENOTIFICATION_DAYS = 30;

export interface SepaCreditor {
  /** Gläubiger-Identifikationsnummer; "" until the Träger sets one. */
  readonly creditorId: string;
  readonly prenotificationDays: number;
  /** undefined: a choice this build does not know. */
  readonly missingMandate: MissingMandate | undefined;
  readonly updatedAt: string | null;
  /** The read-state token a change sends back (ADR 0311). */
  readonly version: string;
}

export interface SepaMandate {
  readonly id: string;
  readonly contractId: string;
  readonly familyEmail: string;
  readonly partyFirstName: string;
  readonly partyLastName: string;
  readonly reference: string;
  /** Calendar date of the signature, "YYYY-MM-DD"; null when the backend has none. */
  readonly signedOn: string | null;
  /** undefined: a kind this build does not know. */
  readonly kind: MandateKind | undefined;
  readonly sequence: MandateSequence | undefined;
  readonly accountHolder: string;
  /** The creditor identifier the mandate was given to. */
  readonly creditorId: string;
  /** False after the Träger changed its creditor identifier: a new mandate is needed. */
  readonly creditorCurrent: boolean;
  /** The Schulträger or the Gemeinde the mandate is given to (#8040); empty for the Träger. */
  readonly issuerName?: string;
  /** The IBAN with only country and last four characters visible. */
  readonly ibanMasked: string;
  readonly bic: string;
  readonly source: MandateSource | undefined;
  /** Calendar date the revocation arrived; null while in force. */
  readonly revokedOn: string | null;
  /** Day of the last collection moto counted (#4697); null before one. */
  readonly lastCollectedOn: string | null;
  /** First day the mandate no longer holds: 36 months without a collection (#4697). */
  readonly expiresOn: string | null;
  readonly createdAt: string;
}

export interface SepaMandateInput {
  readonly contractId: string;
  /** "" lets moto form one. */
  readonly reference: string;
  readonly signedOn: string;
  readonly kind: MandateKind;
  readonly sequence: MandateSequence;
  readonly accountHolder: string;
  readonly iban: string;
  readonly bic: string;
}

export interface SepaMandateEvent {
  readonly id: string;
  readonly action: MandateAction | undefined;
  readonly source: MandateSource | "run" | undefined;
  /** The fields a change touched, never their values. */
  readonly fields: readonly string[];
  /** The account that acted; null once the account is deleted. */
  readonly accountId: string | null;
  readonly occurredAt: string;
  readonly importFile: string | null;
  readonly importLine: number | null;
}

function creditorFromBackend(
  creditor: traegerSepaCreditorContract.SEPACreditor,
): SepaCreditor {
  return {
    creditorId: creditor.creditor_id,
    prenotificationDays: creditor.prenotification_days,
    missingMandate: knownEnum(MISSING_MANDATE_VALUES, creditor.missing_mandate),
    updatedAt: creditor.updated_at,
    version: creditor.version,
  };
}

function mandateFromBackend(
  mandate: traegerSepaMandatesContract.SEPAMandate,
): SepaMandate {
  return {
    id: mandate.id,
    contractId: mandate.contract_id,
    familyEmail: mandate.family_email,
    partyFirstName: mandate.party_first_name,
    partyLastName: mandate.party_last_name,
    reference: mandate.reference,
    signedOn: mandate.signed_on,
    kind: knownEnum(MANDATE_KIND_VALUES, mandate.kind),
    sequence: knownMandateSequence(mandate.sequence),
    accountHolder: mandate.account_holder,
    creditorId: mandate.creditor_id,
    creditorCurrent: mandate.creditor_current,
    issuerName: mandate.issuer?.name ?? "",
    ibanMasked: mandate.iban_masked,
    bic: mandate.bic,
    source: knownEnum(MANDATE_SOURCE_VALUES, mandate.source),
    revokedOn: mandate.revoked_on,
    lastCollectedOn: mandate.last_collected_on,
    expiresOn: mandate.expires_on,
    createdAt: mandate.created_at,
  };
}

/** The creditor of the Träger, the defaults where it set nothing. */
export async function fetchSepaCreditor(): Promise<SepaCreditor> {
  return creditorFromBackend(
    await bffJson("org", "GET /traeger/sepa-creditor/"),
  );
}

/** Stores the creditor from the `version` it was read at (ADR 0311). */
export async function saveSepaCreditor(
  creditor: {
    readonly creditorId: string;
    readonly prenotificationDays: number;
    readonly missingMandate: MissingMandate;
  },
  version: string,
): Promise<SepaCreditor> {
  const body: traegerSepaCreditorContract.SEPACreditorRequest = {
    creditor_id: creditor.creditorId.trim(),
    prenotification_days: creditor.prenotificationDays,
    missing_mandate: creditor.missingMandate,
    expected_version: version,
  };
  return creditorFromBackend(
    await bffJson("org", "PUT /traeger/sepa-creditor/", { body }),
  );
}

/** The mandates of the Träger, of one contract's family when given. */
export async function fetchSepaMandates(
  contractId?: string,
): Promise<SepaMandate[]> {
  const mandates = await bffJson("org", "GET /traeger/sepa-mandates/", {
    query: { contract_id: contractId || undefined },
  });
  return (mandates ?? []).map(mandateFromBackend);
}

/** The request body of a new mandate. */
function sepaMandateBody(
  input: SepaMandateInput,
): traegerSepaMandatesContract.SEPAMandateRequest {
  return {
    contract_id: input.contractId,
    reference: input.reference.trim(),
    signed_on: input.signedOn,
    kind: input.kind,
    sequence: input.kind === "one_off" ? "first" : input.sequence,
    account_holder: input.accountHolder.trim(),
    iban: input.iban,
    bic: input.bic.trim(),
  };
}

export async function createSepaMandate(
  input: SepaMandateInput,
): Promise<SepaMandate> {
  return mandateFromBackend(
    await bffJson("org", "POST /traeger/sepa-mandates/", {
      body: sepaMandateBody(input),
    }),
  );
}

/** Ends a mandate on the day the revocation arrived. */
export async function revokeSepaMandate(
  id: string,
  revokedOn: string,
): Promise<SepaMandate> {
  return mandateFromBackend(
    await bffJson("org", "POST /traeger/sepa-mandates/{id}/revoke", {
      params: { id },
      body: {
        revoked_on: revokedOn,
      } satisfies traegerSepaMandatesContract.SEPAMandateRevokeRequest,
    }),
  );
}

/** The trail of a mandate, oldest first. */
export async function fetchSepaMandateHistory(
  id: string,
): Promise<SepaMandateEvent[]> {
  const events = await bffJson(
    "org",
    "GET /traeger/sepa-mandates/{id}/history",
    { params: { id } },
  );
  return events.map((event) => ({
    id: event.id,
    action: knownEnum(MANDATE_ACTION_VALUES, event.action),
    source: knownEnum(EVENT_SOURCE_VALUES, event.source),
    fields: event.fields ?? [],
    accountId: event.account_id,
    occurredAt: event.occurred_at,
    importFile: event.import_file ?? null,
    importLine: event.import_line ?? null,
  }));
}
