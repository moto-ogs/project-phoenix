import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the SEPA direct debit file (#4697): the debits of an issued
 * monthly or holiday run, the PAIN.008 file the office submits to its bank,
 * the confirmation that it did, and the collections of one mandate. No
 * answer carries an IBAN of a family; only the file does, and it is never
 * cached. Backend int64 IDs leave here as strings; calendar dates stay
 * "YYYY-MM-DD".
 */

import type * as sharedContract from "./contract/shared.generated";
import type * as traegerSepaDebitsContract from "./contract/traeger-sepa-debits.generated";
import { knownEnum } from "./contract/known-enum";
import { type BillingFile, billingFile } from "./traeger-billing-api";

// Go does not register these sets; the contract types them as string.
const SEQUENCE_TYPE_VALUES = ["FRST", "RCUR", "OOFF"] as const;
const DEBIT_STATUS_VALUES = ["pending", "submitted"] as const;
const DEBIT_LEFT_VALUES = [
  "mandate_missing",
  "cancelled",
  "revoked",
  "expired",
  "creditor_changed",
  "one_off_used",
  "one_off_multiple",
] as const;

/** The kind of run a file belongs to, as the path names it. */
export type SepaDebitRunKind = "care-runs" | "holiday-runs" | "notice-months";
export type SepaSequenceType = (typeof SEQUENCE_TYPE_VALUES)[number];
type SepaDebitStatus = (typeof DEBIT_STATUS_VALUES)[number];
/**
 * Why a pending debit stays out of the file. "other": a reason this build
 * does not know; the debit is still out of the file.
 */
export type SepaDebitLeft = (typeof DEBIT_LEFT_VALUES)[number] | "other";

export interface SepaDebit {
  readonly id: string;
  readonly mandateId: string;
  readonly contractId: string;
  readonly invoiceNumber: string;
  readonly recipientName: string;
  readonly amountCents: number;
  /** Calendar date the invoice is due, "YYYY-MM-DD"; null when the backend has none. */
  readonly dueOn: string | null;
  /** Collection day of the exported/submitted debit. */
  readonly collectOn: string | null;
  /** undefined: a sequence type this build does not know. */
  readonly sequenceType: SepaSequenceType | undefined;
  readonly mandateReference: string;
  readonly ibanMasked: string;
  readonly status: SepaDebitStatus | undefined;
  readonly left: SepaDebitLeft | null;
  readonly submittedAt: string | null;
  /** The month of the installment of a Jahresbescheid, "YYYY-MM-DD"; null for an invoice. */
  readonly noticeMonth: string | null;
}

export interface SepaDebitGroup {
  readonly sequenceType: SepaSequenceType | undefined;
  /** Calendar date the bank collects, "YYYY-MM-DD"; null when the backend has none. */
  readonly collectOn: string | null;
  readonly count: number;
  readonly totalCents: number;
}

export interface SepaDebitRun {
  readonly creditorId: string;
  /** The account holder of the Träger's default bank account. */
  readonly creditorName: string;
  readonly creditorIbanMasked: string;
  /** The Träger has no default bank account: there is no file. */
  readonly accountMissing: boolean;
  /** Names the file as it is now; the confirmation carries it. */
  readonly messageId: string;
  readonly count: number;
  readonly totalCents: number;
  readonly groups: readonly SepaDebitGroup[];
  /** Debits whose due date passed; the file collects them tomorrow. */
  readonly pastDue: number;
  readonly debits: readonly SepaDebit[];
  readonly submitted: readonly SepaDebit[];
  readonly left: readonly SepaDebit[];
  readonly submittedAt: string | null;
  /**
   * The body whose file this is (#8040), undefined for the Träger's own.
   * A Schulträger or a Gemeinde that bills a school itself collects with
   * its own creditor identifier into its own account.
   */
  readonly issuer?: SepaDebitIssuer;
  /** Every body with debits in this run; each has a file of its own. */
  readonly issuers?: readonly SepaDebitIssuer[];
}

/** A body that bills a school itself, named by its creditor identifier. */
export interface SepaDebitIssuer {
  readonly key: string;
  readonly name: string;
}

function debitLeft(left: string | undefined): SepaDebitLeft | null {
  if (!left) return null;
  return knownEnum(DEBIT_LEFT_VALUES, left) ?? "other";
}

function debitFromBackend(debit: sharedContract.SEPADebit): SepaDebit {
  return {
    id: debit.id,
    mandateId: debit.mandate_id,
    contractId: debit.contract_id,
    invoiceNumber: debit.invoice_number,
    recipientName: debit.recipient_name,
    amountCents: debit.amount_cents,
    dueOn: debit.due_on,
    collectOn: debit.collect_on ?? null,
    sequenceType: knownEnum(SEQUENCE_TYPE_VALUES, debit.sequence_type),
    mandateReference: debit.mandate_reference,
    ibanMasked: debit.iban_masked,
    status: knownEnum(DEBIT_STATUS_VALUES, debit.status),
    left: debitLeft(debit.left),
    submittedAt: debit.submitted_at,
    noticeMonth: debit.notice_month || null,
  };
}

function debitRunFromBackend(
  run: traegerSepaDebitsContract.SEPADebitRun,
): SepaDebitRun {
  return {
    creditorId: run.creditor_id,
    creditorName: run.creditor_name,
    creditorIbanMasked: run.creditor_iban_masked,
    accountMissing: run.account_missing,
    messageId: run.message_id,
    count: run.count,
    totalCents: run.total_cents,
    groups: (run.groups ?? []).map((group) => ({
      sequenceType: knownEnum(SEQUENCE_TYPE_VALUES, group.sequence_type),
      collectOn: group.collect_on,
      count: group.count,
      totalCents: group.total_cents,
    })),
    pastDue: run.past_due,
    debits: (run.debits ?? []).map(debitFromBackend),
    submitted: (run.submitted ?? []).map(debitFromBackend),
    left: (run.left ?? []).map(debitFromBackend),
    submittedAt: run.submitted_at,
    issuer: run.issuer
      ? { key: run.issuer.key, name: run.issuer.name }
      : undefined,
    issuers: (run.issuers ?? []).map((issuer) => ({
      key: issuer.key,
      name: issuer.name,
    })),
  };
}

/** The query of the file of a body; the Träger's own file has none. */
function issuerQuery(issuerKey: string) {
  return { issuer: issuerKey === "" ? undefined : issuerKey };
}

/** The debit file of an issued run, without bank data of a family. */
export async function fetchSepaDebitRun(
  kind: SepaDebitRunKind,
  runId: string,
  issuerKey = "",
): Promise<SepaDebitRun> {
  return debitRunFromBackend(
    await bffJson("org", "GET /traeger/sepa-debits/{kind}/{id}", {
      params: { kind, id: runId },
      query: issuerQuery(issuerKey),
    }),
  );
}

/** The PAIN.008 file of the pending debits; it changes nothing. */
export async function downloadSepaDebitFile(
  kind: SepaDebitRunKind,
  runId: string,
  issuerKey = "",
): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "GET /traeger/sepa-debits/{kind}/{id}/file", {
      params: { kind, id: runId },
      query: issuerQuery(issuerKey),
    }),
    "lastschrift.xml",
  );
}

/**
 * The message ID of a downloaded file: its name without the file number of
 * the export protocol (#4693), "lastschrift-112-MOTO-….xml" → "MOTO-…".
 */
export function messageIdOfDebitFile(filename: string): string {
  return filename.replace(/\.xml$/i, "").replace(/^lastschrift-\d+-/, "");
}

/** Confirms that the office submitted the file messageId to its bank. */
export async function submitSepaDebits(
  kind: SepaDebitRunKind,
  runId: string,
  messageId: string,
  issuerKey = "",
): Promise<SepaDebitRun> {
  return debitRunFromBackend(
    await bffJson("org", "POST /traeger/sepa-debits/{kind}/{id}/submission", {
      params: { kind, id: runId },
      query: issuerQuery(issuerKey),
      body: {
        message_id: messageId,
      } satisfies traegerSepaDebitsContract.SEPADebitSubmissionRequest,
    }),
  );
}

/** The debits of a mandate, newest first: the collection history. */
export async function fetchSepaMandateCollections(
  mandateId: string,
): Promise<SepaDebit[]> {
  const debits = await bffJson(
    "org",
    "GET /traeger/sepa-mandates/{id}/collections",
    { params: { id: mandateId } },
  );
  return debits.map(debitFromBackend);
}
