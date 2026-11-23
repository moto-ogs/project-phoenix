import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the billing runs in the Träger portal (#4668): the runs of a
 * holiday period with their preview, corrections with a reason, the release
 * that issues the numbered invoices, the overview of a released run for the
 * Kämmerei, and the number range of the invoices.
 * Money stays whole cent. Backend int64 IDs leave here as strings.
 */

import {
  type MailOutcome,
  type MailProviderBlock,
  knownMailOutcome,
  knownMailProviderBlock,
} from "~/lib/email-delivery-status";
import { knownEnum } from "./contract/known-enum";
import type * as traegerBillingRunsContract from "./contract/traeger-billing-runs.generated";
import type * as traegerNumberRangesContract from "./contract/traeger-number-ranges.generated";
import { filenameFromDisposition } from "./file-download";
import {
  type InvoicePayment,
  type RecipientKind,
  type RunDueDate,
  invoicePaymentFromBackend,
  knownRecipientKind,
  runDueDatesFromBackend,
} from "./traeger-billing-terms-api";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const RUN_STATUS_VALUES = ["calculated", "released", "discarded"] as const;
const POSITION_KIND_VALUES = [
  "base",
  "sibling",
  "benefits_exemption",
  "cost_takeover",
  "meal",
  "correction",
  "credit",
] as const;
const DOCUMENT_KIND_VALUES = ["invoice", "cancellation", "credit"] as const;
const LETTER_MAIL_STATUS_VALUES = [
  "not_sent",
  "queued",
  "sent",
  "failed",
  "unknown",
] as const;

/** A run the Abrechnung discarded while it was open and empty (#6628). */
export type BillingRunStatus = (typeof RUN_STATUS_VALUES)[number];

export interface BillingRun {
  readonly id: string;
  readonly holidayPeriodId: string;
  readonly periodName: string;
  /** Calendar dates "YYYY-MM-DD"; null when the backend has none. */
  readonly serviceFrom: string | null;
  readonly serviceUntil: string | null;
  /** undefined: a status this build does not know. */
  readonly status: BillingRunStatus | undefined;
  readonly createdAt: string;
  readonly releasedAt: string | null;
  readonly issuedOn: string | null;
  readonly documentCount: number | null;
  readonly totalCents: number | null;
  /** When the Abrechnung discarded the empty run (#6628). */
  readonly discardedAt?: string | null;
}

type BillingPositionKind = (typeof POSITION_KIND_VALUES)[number];

/** An invoice, its Storno or its Gutschrift (#4690). */
export type BillingDocumentKind = (typeof DOCUMENT_KIND_VALUES)[number];

/** The document kind a value names, undefined when unknown. */
export function knownDocumentKind(
  value: string,
): BillingDocumentKind | undefined {
  return knownEnum(DOCUMENT_KIND_VALUES, value);
}

/**
 * A document of the history of an invoice: its Storno, its Gutschriften and
 * the invoice that replaces it, which may belong to another run.
 */
interface BillingDocumentLink {
  readonly id: string;
  readonly runId: string;
  readonly kind: BillingDocumentKind | undefined;
  readonly number: string;
  readonly issuedOn: string | null;
  readonly totalCents: number;
  readonly reason: string;
}

export interface BillingPosition {
  readonly kind: BillingPositionKind | undefined;
  /** Negative for a discount. */
  readonly amountCents: number;
  readonly weekStartsOn: string | null;
  readonly weekEndsOn: string | null;
  readonly timeModelName: string;
  readonly childRank: number | null;
  readonly discountBasisPoints: number | null;
  readonly discountCents: number | null;
  /** The note of an exemption or the reason of a correction. */
  readonly note: string;
  /** Cost takeover (#5627): the cost bearer and the name the invoice copied. */
  readonly costBearerId?: string | null;
  readonly costBearerName?: string;
  /** The lunches a meal position prices (#5631); null otherwise. */
  readonly bookedDays?: number | null;
}

interface BillingCorrection {
  readonly id: string;
  readonly amountCents: number;
  readonly totalBeforeCents: number;
  readonly totalAfterCents: number;
  readonly reason: string;
  readonly createdAt: string;
  /** The cancelled invoice a release took this correction over from (#5663). */
  readonly carriedFromNumber: string;
}

/**
 * A correction of the cancelled invoice a draft proposes (#5663). The draft
 * applies `amountCents`; it differs from `sourceAmountCents` only when the
 * proposal stops at zero.
 */
export interface BillingCarriedCorrection {
  /** Its position on the cancelled invoice; names the proposal. */
  readonly positionId: string;
  readonly sourceNumber: string;
  readonly amountCents: number;
  readonly sourceAmountCents: number;
  readonly reason: string;
}

export interface BillingChild {
  readonly childId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly positions: readonly BillingPosition[];
  readonly corrections: readonly BillingCorrection[];
  readonly carriedCorrections: readonly BillingCarriedCorrection[];
  readonly totalCents: number;
}

export interface BillingDocument {
  /** Empty for a draft; the invoice once issued. */
  readonly id: string;
  /** undefined: a kind this build does not know. */
  readonly kind: BillingDocumentKind | undefined;
  /**
   * The number of the invoice a Storno or Gutschrift belongs to, or of the
   * cancelled invoice an invoice replaces; empty otherwise (#4690).
   */
  readonly referenceNumber: string;
  /** The reason of a Storno or Gutschrift. */
  readonly reason: string;
  /** Storno, Gutschriften and the replacing invoice of an issued invoice. */
  readonly history: readonly BillingDocumentLink[];
  /** Gutschriften of the cancelled invoice a draft replaces (#5663). */
  readonly replacedCredits: readonly BillingDocumentLink[];
  /** Empty for a draft. */
  readonly number: string;
  readonly issuedOn: string | null;
  readonly registrationId: string;
  /**
   * The child of the registration a holiday invoice per child bills
   * (#7007); empty for an invoice of the whole registration.
   */
  readonly registrationChildId: string;
  readonly recipientFirstName: string;
  readonly recipientLastName: string;
  readonly recipientEmail: string;
  /** The family's debtor number the invoice copies; empty without (#5621). */
  readonly debtorNumber: string;
  /** Who gets it (#4689); "" on an invoice issued before. */
  readonly recipientKind?: RecipientKind | "";
  /** The second parent when both parents get it. */
  readonly recipientSecondName?: string;
  /** How and by when it is paid (#4689); null on an invoice issued before. */
  readonly payment?: InvoicePayment | null;
  readonly serviceFrom: string | null;
  readonly serviceUntil: string | null;
  readonly children: readonly BillingChild[];
  readonly totalCents: number;
}

export interface BillingRunDetail extends BillingRun {
  readonly documents: readonly BillingDocument[];
  readonly previewCount: number;
  readonly previewCents: number;
  /** Confirmed registrations without a frozen contribution. */
  readonly unbilled: number;
  /**
   * Draft invoices without a debtor number while the Träger asks for one
   * (#5621); 0 otherwise.
   */
  readonly missingDebtorNumbers: number;
  /**
   * Draft invoices with an amount and without a debtor number while the
   * payment text names it, whatever the switch (#5622): after the release
   * their letters are refused until the placeholder goes.
   */
  readonly paymentTextMissingDebtorNumbers: number;
  readonly numberPattern: string;
  readonly numberRangeSet: boolean;
  /** Set once the confirmation letters of the released run exist (#4669). */
  readonly letters: BillingLetters | null;
  /** The due dates of the run per payment method (#4689). */
  readonly dueDates?: readonly RunDueDate[];
  /** The read-state token of `dueDates` a change sends back (ADR 0311). */
  readonly dueDatesVersion?: string;
  /**
   * The kind of document the run issues (#4688): before the release the
   * kind the release would freeze, after it the frozen one.
   */
  readonly documentKind?: string;
  /** A release would refuse: the fee notice has no legal remedy (#4688). */
  readonly legalRemedyMissing?: boolean;
  /**
   * Names the content of the preview; the release sends it back and is
   * refused when the content changed since (#6506). Empty once released.
   */
  readonly fingerprint: string;
}

/** An emergency number of a hosting OGS on the letters of a run. */
export interface BillingEmergencyContact {
  readonly name: string;
  readonly phone: string;
}

/** What the confirmation letters of a released run print (#4669). */
export interface BillingLettersInput {
  /** Calendar date "YYYY-MM-DD". */
  readonly paymentDueOn: string;
  readonly notes: string;
  readonly emergencyContacts: readonly BillingEmergencyContact[];
}

export interface BillingLetters extends Omit<
  BillingLettersInput,
  "paymentDueOn"
> {
  /** Calendar date "YYYY-MM-DD"; null when the backend has none. */
  readonly paymentDueOn: string | null;
  readonly createdAt: string;
  /** Version der Vorlage, mit der die Schreiben entstanden; 0 = Standardvorlage (#4677). */
  readonly templateVersion: number;
}

export interface BillingPeriod {
  readonly id: string;
  readonly name: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
}

/** One start value the Abrechnung set for a number range (#7358). */
interface NumberRangeStart {
  /** The running number the next invoice got from then on. */
  readonly nextNumber: number;
  /** That number in the pattern of today. */
  readonly example: string;
  readonly setAt: string;
  readonly setByYou: boolean;
  /** False once the account that set the value is deleted. */
  readonly setByAccount: boolean;
  /** The colleague's name; empty for you. */
  readonly setByName: string;
}

export interface NumberRange {
  readonly service: string;
  readonly pattern: string;
  /** The number the next invoice gets today, in the pattern. */
  readonly example: string;
  /** The running number of `example`; 0 without a pattern. */
  readonly nextNumber: number;
  /** The last issued running number of this counter; 0 before the first. */
  readonly lastNumber: number;
  /** The year the counter belongs to; 0 when the pattern names no year. */
  readonly year: number;
  /** The start values of this counter, the newest first. */
  readonly starts: readonly NumberRangeStart[];
}

function lettersFromBackend(
  letters: traegerBillingRunsContract.BillingLetters,
): BillingLetters {
  return {
    paymentDueOn: letters.payment_due_on,
    notes: letters.notes,
    emergencyContacts: (letters.emergency_contacts ?? []).map((contact) => ({
      name: contact.name,
      phone: contact.phone,
    })),
    createdAt: letters.created_at,
    templateVersion: letters.template_version,
  };
}

function runFromBackend(
  run: traegerBillingRunsContract.BillingRun,
): BillingRun {
  return {
    id: run.id,
    holidayPeriodId: run.holiday_period_id,
    periodName: run.period_name,
    serviceFrom: run.service_from,
    serviceUntil: run.service_until,
    status: knownEnum(RUN_STATUS_VALUES, run.status),
    createdAt: run.created_at,
    releasedAt: run.released_at,
    issuedOn: run.issued_on,
    documentCount: run.document_count,
    totalCents: run.total_cents,
    discardedAt: run.discarded_at,
  };
}

function positionFromBackend(
  position: traegerBillingRunsContract.BillingPosition,
): BillingPosition {
  return {
    kind: knownEnum(POSITION_KIND_VALUES, position.kind),
    amountCents: position.amount_cents,
    weekStartsOn: position.week_starts_on,
    weekEndsOn: position.week_ends_on,
    timeModelName: position.time_model_name,
    childRank: position.child_rank,
    discountBasisPoints: position.discount_basis_points,
    discountCents: position.discount_cents,
    note: position.note,
    costBearerId: position.cost_bearer_id || null,
    costBearerName: position.cost_bearer_name,
    bookedDays: position.booked_days,
  };
}

function documentLinkFromBackend(
  link: traegerBillingRunsContract.BillingDocumentLink,
): BillingDocumentLink {
  return {
    id: link.id,
    runId: link.run_id,
    kind: knownDocumentKind(link.kind),
    number: link.number,
    issuedOn: link.issued_on,
    totalCents: link.total_cents,
    reason: link.reason,
  };
}

function documentFromBackend(
  document: traegerBillingRunsContract.BillingDocument,
): BillingDocument {
  return {
    // A draft has no ID yet: 0, which the contract decoder hands on as "0".
    id: document.id === "0" ? "" : document.id,
    kind: knownDocumentKind(document.kind),
    referenceNumber: document.reference_number,
    reason: document.reason,
    history: (document.history ?? []).map(documentLinkFromBackend),
    replacedCredits: (document.replaced_credits ?? []).map(
      documentLinkFromBackend,
    ),
    number: document.number,
    issuedOn: document.issued_on,
    registrationId: document.registration_id,
    // A holiday invoice of the whole registration names no child: 0.
    registrationChildId:
      document.registration_child_id === "0"
        ? ""
        : document.registration_child_id,
    recipientFirstName: document.recipient_first_name,
    recipientLastName: document.recipient_last_name,
    recipientEmail: document.recipient_email,
    debtorNumber: document.debtor_number,
    recipientKind:
      document.recipient_kind === ""
        ? ""
        : knownRecipientKind(document.recipient_kind),
    recipientSecondName: document.recipient_second_name,
    payment: invoicePaymentFromBackend(document.payment),
    serviceFrom: document.service_from,
    serviceUntil: document.service_until,
    totalCents: document.total_cents,
    children: (document.children ?? []).map((child) => ({
      childId: child.child_id,
      firstName: child.first_name,
      lastName: child.last_name,
      totalCents: child.total_cents,
      positions: (child.positions ?? []).map(positionFromBackend),
      corrections: (child.corrections ?? []).map((correction) => ({
        id: correction.id,
        amountCents: correction.amount_cents,
        totalBeforeCents: correction.total_before_cents,
        totalAfterCents: correction.total_after_cents,
        reason: correction.reason,
        createdAt: correction.created_at,
        carriedFromNumber: correction.carried_from_number,
      })),
      carriedCorrections: (child.carried_corrections ?? []).map((carried) => ({
        positionId: carried.position_id,
        sourceNumber: carried.source_number,
        amountCents: carried.amount_cents,
        sourceAmountCents: carried.source_amount_cents,
        reason: carried.reason,
      })),
    })),
  };
}

function detailFromBackend(
  run: traegerBillingRunsContract.BillingRunDetail,
): BillingRunDetail {
  return {
    ...runFromBackend(run),
    documents: (run.documents ?? []).map(documentFromBackend),
    previewCount: run.preview_count,
    previewCents: run.preview_cents,
    unbilled: run.unbilled,
    missingDebtorNumbers: run.missing_debtor_numbers,
    paymentTextMissingDebtorNumbers: run.payment_text_missing_debtor_numbers,
    numberPattern: run.number_pattern,
    numberRangeSet: run.number_range_set,
    letters: run.letters ? lettersFromBackend(run.letters) : null,
    dueDates: runDueDatesFromBackend(run.due_dates),
    dueDatesVersion: run.due_dates_version,
    documentKind: run.document_kind,
    legalRemedyMissing: run.legal_remedy_missing,
    fingerprint: run.fingerprint,
  };
}

/** The runs of the Träger, newest first. */
export async function fetchBillingRuns(): Promise<BillingRun[]> {
  const runs = await bffJson("org", "GET /traeger/billing-runs/");
  return runs.map(runFromBackend);
}

/** The published holiday periods a run can bill, latest first. */
export async function fetchBillingPeriods(): Promise<BillingPeriod[]> {
  const periods = await bffJson("org", "GET /traeger/billing-runs/periods");
  return periods.map((period) => ({
    id: period.id,
    name: period.name,
    startsOn: period.starts_on,
    endsOn: period.ends_on,
  }));
}

export async function startBillingRun(periodId: string): Promise<BillingRun> {
  return runFromBackend(
    await bffJson("org", "POST /traeger/billing-runs/", {
      body: {
        holiday_period_id: periodId,
      } satisfies traegerBillingRunsContract.BillingRunRequest,
    }),
  );
}

/** A run with its preview, or with its issued invoices once released. */
export async function fetchBillingRun(id: string): Promise<BillingRunDetail> {
  return detailFromBackend(
    await bffJson("org", "GET /traeger/billing-runs/{id}", { params: { id } }),
  );
}

/** Sets the amount of one child to totalCents, with a reason. */
export async function correctBillingRun(
  id: string,
  correction: {
    readonly registrationId: string;
    readonly childId: string;
    readonly totalCents: number;
    readonly reason: string;
  },
): Promise<BillingRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/billing-runs/{id}/corrections", {
      params: { id },
      body: {
        registration_id: correction.registrationId,
        child_id: correction.childId,
        total_cents: correction.totalCents,
        reason: correction.reason,
      } satisfies traegerBillingRunsContract.BillingCorrectionRequest,
    }),
  );
}

/**
 * Replaces a correction a draft proposes with a correction of the run: the
 * new amount of the child and its reason (#5663).
 */
export async function changeCarriedCorrection(
  runId: string,
  positionId: string,
  change: { readonly totalCents: number; readonly reason: string },
): Promise<BillingRunDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/billing-runs/{id}/carried-corrections/{positionID}",
      {
        params: { id: runId, positionID: positionId },
        body: {
          total_cents: change.totalCents,
          reason: change.reason,
        } satisfies traegerBillingRunsContract.BillingCarriedCorrectionRequest,
      },
    ),
  );
}

/** Removes a correction a draft proposes; the release leaves it out (#5663). */
export async function removeCarriedCorrection(
  runId: string,
  positionId: string,
): Promise<BillingRunDetail> {
  return detailFromBackend(
    await bffJson(
      "org",
      "DELETE /traeger/billing-runs/{id}/carried-corrections/{positionID}",
      { params: { id: runId, positionID: positionId } },
    ),
  );
}

/**
 * Cancels an issued invoice with a Storno of its own (#4690). The Storno
 * gets the next number of the range; the registration comes back into the
 * next run of the period.
 */
export async function cancelBillingDocument(
  runId: string,
  documentId: string,
  reason: string,
): Promise<BillingDocument> {
  return documentFromBackend(
    await bffJson(
      "org",
      "POST /traeger/billing-runs/{id}/documents/{documentID}/cancellation",
      {
        params: { id: runId, documentID: documentId },
        body: {
          reason,
        } satisfies traegerBillingRunsContract.BillingCancellationRequest,
      },
    ),
  );
}

/** Credits amountCents of one child of an issued invoice (#4690). */
export async function creditBillingDocument(
  runId: string,
  documentId: string,
  credit: {
    readonly childId: string;
    readonly amountCents: number;
    readonly reason: string;
  },
): Promise<BillingDocument> {
  return documentFromBackend(
    await bffJson(
      "org",
      "POST /traeger/billing-runs/{id}/documents/{documentID}/credits",
      {
        params: { id: runId, documentID: documentId },
        body: {
          child_id: credit.childId,
          amount_cents: credit.amountCents,
          reason: credit.reason,
        } satisfies traegerBillingRunsContract.BillingCreditRequest,
      },
    ),
  );
}

/**
 * Issues the invoices. The backend refuses when the preview no longer
 * matches the count, the sum and the content (fingerprint, #6506) the
 * person checked.
 */
export async function releaseBillingRun(
  run: Pick<
    BillingRunDetail,
    "id" | "previewCount" | "previewCents" | "documentKind" | "fingerprint"
  >,
): Promise<BillingRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/billing-runs/{id}/release", {
      params: { id: run.id },
      body: {
        document_count: run.previewCount,
        total_cents: run.previewCents,
        fingerprint: run.fingerprint,
        // The release refuses another kind than the one shown (#4688).
        ...(run.documentKind ? { document_kind: run.documentKind } : {}),
      } satisfies traegerBillingRunsContract.BillingReleaseRequest,
    }),
  );
}

/**
 * Discards an open run that has nothing to issue (#6628). The backend
 * refuses a run with an invoice or a registration still waiting for its
 * contribution; the period is free for a new run afterwards.
 */
export async function discardBillingRun(
  runId: string,
): Promise<BillingRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/billing-runs/{id}/discard", {
      params: { id: runId },
    }),
  );
}

function lettersBody(
  input: BillingLettersInput,
): traegerBillingRunsContract.BillingLettersRequest {
  return {
    payment_due_on: input.paymentDueOn,
    notes: input.notes,
    emergency_contacts: input.emergencyContacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
    })),
  };
}

/**
 * Creates the confirmation letter of every invoice of a released run once;
 * afterwards they never change.
 */
export async function createBillingLetters(
  runId: string,
  input: BillingLettersInput,
): Promise<BillingLetters> {
  return lettersFromBackend(
    await bffJson("org", "POST /traeger/billing-runs/{id}/letters", {
      params: { id: runId },
      body: lettersBody(input),
    }),
  );
}

/** A file with the name the backend chose. */
export interface BillingFile {
  readonly blob: Blob;
  readonly filename: string;
}

/** Reads a file asked through `bffFile`; a refusal is its ApiError. */
export async function billingFile(
  file: Promise<Response>,
  fallbackName: string,
): Promise<BillingFile> {
  const response = await file;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response) ?? fallbackName,
  };
}

/** The letter of the first invoice with the input, without storing it. */
export async function previewBillingLetter(
  runId: string,
  input: BillingLettersInput,
): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "POST /traeger/billing-runs/{id}/letters/preview", {
      params: { id: runId },
      body: lettersBody(input),
    }),
    "vorschau.pdf",
  );
}

/** The stored letter of one invoice of the run. */
export async function downloadBillingLetter(
  runId: string,
  documentId: string,
): Promise<BillingFile> {
  return billingFile(
    bffFile(
      "org",
      "GET /traeger/billing-runs/{id}/documents/{documentID}/letter",
      { params: { id: runId, documentID: documentId } },
    ),
    "bestaetigung.pdf",
  );
}

/** All stored letters of the run in one PDF to print (#4670). */
export async function printBillingLetters(runId: string): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "GET /traeger/billing-runs/{id}/letters/print", {
      params: { id: runId },
    }),
    "bestaetigungsschreiben.pdf",
  );
}

/** The state of the last mail of a family's letter (#4670). */
export type LetterMailStatus = (typeof LETTER_MAIL_STATUS_VALUES)[number];

/**
 * The state of a letter's mail; the backend names a state it cannot read
 * "unknown" itself, so a state this build does not know reads the same.
 */
export function knownLetterMailStatus(value: string): LetterMailStatus {
  return knownEnum(LETTER_MAIL_STATUS_VALUES, value) ?? "unknown";
}

/** The mail of the letter of one family. */
export interface LetterMailing {
  readonly documentId: string;
  /** An invoice, a Storno or a Gutschrift (#4690). */
  readonly kind: BillingDocumentKind | undefined;
  readonly number: string;
  readonly recipientFirstName: string;
  readonly recipientLastName: string;
  readonly recipientEmail: string;
  /** "unknown" also stands for a state this build does not know. */
  readonly status: LetterMailStatus;
  /** What became of the last mail; only a provider's report says delivered. */
  readonly mailOutcome?: MailOutcome;
  readonly providerBlock?: MailProviderBlock;
  readonly sends: number;
  readonly requestedAt: string | null;
  readonly sentAt: string | null;
}

/** What a send to every family of the run did. */
export interface LetterSeries {
  readonly queued: number;
  readonly already: number;
  readonly withoutEmail: number;
}

function mailingFromBackend(
  mailing: traegerBillingRunsContract.BillingLetterMailing,
): LetterMailing {
  return {
    documentId: mailing.document_id,
    kind: knownDocumentKind(mailing.kind),
    number: mailing.number,
    recipientFirstName: mailing.recipient_first_name,
    recipientLastName: mailing.recipient_last_name,
    recipientEmail: mailing.recipient_email,
    status: knownLetterMailStatus(mailing.status),
    mailOutcome: knownMailOutcome(mailing.mail_outcome),
    providerBlock: knownMailProviderBlock(mailing.provider_block),
    sends: mailing.sends,
    requestedAt: mailing.requested_at,
    sentAt: mailing.sent_at,
  };
}

/** The mail state of every family of a released run with letters. */
export async function fetchLetterMailings(
  runId: string,
): Promise<LetterMailing[]> {
  const body = await bffJson("org", "GET /traeger/billing-runs/{id}/mailings", {
    params: { id: runId },
  });
  return (body.documents ?? []).map(mailingFromBackend);
}

/**
 * Mails the letter of every family with an address and no mail yet; a
 * second call sends nothing twice.
 */
export async function mailBillingLetters(runId: string): Promise<LetterSeries> {
  const series = await bffJson(
    "org",
    "POST /traeger/billing-runs/{id}/mailings",
    { params: { id: runId } },
  );
  return {
    queued: series.queued,
    already: series.already,
    withoutEmail: series.without_email,
  };
}

/** Mails the letter of one family, first or again. */
export async function mailBillingLetter(
  runId: string,
  documentId: string,
): Promise<LetterMailing> {
  return mailingFromBackend(
    await bffJson(
      "org",
      "POST /traeger/billing-runs/{id}/documents/{documentID}/mailings",
      { params: { id: runId, documentID: documentId } },
    ),
  );
}

export type BillingRunExportFormat = "pdf" | "xlsx" | "csv";

/**
 * The overview of a released run for the Kämmerei (#4672): every invoice
 * with its positions and sums.
 */
export async function downloadBillingRunOverview(
  id: string,
  format: BillingRunExportFormat,
): Promise<BillingFile> {
  return billingFile(
    bffFile("org", "GET /traeger/billing-runs/{id}/export", {
      params: { id },
      query: { format },
    }),
    `abrechnungsanordnung.${format}`,
  );
}

/**
 * The list of a released run for the reimbursement by one cost bearer
 * (#5627): every child the cost bearer pays for, with the sum.
 */
export async function downloadCostTakeoverList(
  id: string,
  costBearerId: string,
  format: BillingRunExportFormat,
): Promise<BillingFile> {
  return billingFile(
    bffFile(
      "org",
      "GET /traeger/billing-runs/{id}/cost-takeovers/{costBearerId}/export",
      { params: { id, costBearerId }, query: { format } },
    ),
    `kostenuebernahme.${format}`,
  );
}

type NumberRangeService = "holiday" | "care";

function mapNumberRange(
  service: string,
  range: traegerNumberRangesContract.NumberRange | undefined,
): NumberRange {
  return {
    service,
    pattern: range?.pattern ?? "",
    example: range?.example ?? "",
    nextNumber: range?.next_number ?? 0,
    lastNumber: range?.last_number ?? 0,
    year: range?.year ?? 0,
    starts: (range?.starts ?? []).map((start) => ({
      nextNumber: start.next_number,
      example: start.example,
      setAt: start.set_at,
      setByYou: start.set_by_you,
      setByAccount: start.set_by_account,
      setByName: start.set_by_name,
    })),
  };
}

async function fetchNumberRange(
  service: NumberRangeService,
): Promise<NumberRange> {
  const ranges = await bffJson("org", "GET /traeger/number-ranges/");
  return mapNumberRange(
    service,
    ranges.find((range) => range.service === service),
  );
}

async function saveNumberRange(
  service: NumberRangeService,
  pattern: string,
): Promise<NumberRange> {
  const range = await bffJson("org", "PUT /traeger/number-ranges/{service}", {
    params: { service },
    body: {
      pattern,
    } satisfies traegerNumberRangesContract.NumberRangeRequest,
  });
  return mapNumberRange(range.service, range);
}

/**
 * Sets the running number the next invoice of the service gets (#7358). The
 * backend refuses a number that is not above the last issued one.
 */
async function saveNumberRangeStart(
  service: NumberRangeService,
  nextNumber: number,
): Promise<NumberRange> {
  const range = await bffJson(
    "org",
    "PUT /traeger/number-ranges/{service}/start",
    {
      params: { service },
      body: {
        next_number: nextNumber,
      } satisfies traegerNumberRangesContract.NumberRangeStartRequest,
    },
  );
  return mapNumberRange(range.service, range);
}

/** The number range of the holiday invoices; the pattern may be empty. */
export const fetchHolidayNumberRange = () => fetchNumberRange("holiday");

export const saveHolidayNumberRange = (pattern: string) =>
  saveNumberRange("holiday", pattern);

export const saveHolidayNumberRangeStart = (nextNumber: number) =>
  saveNumberRangeStart("holiday", nextNumber);

/** The number range of the monthly invoices (#4684); the pattern may be empty. */
export const fetchCareNumberRange = () => fetchNumberRange("care");

export const saveCareNumberRange = (pattern: string) =>
  saveNumberRange("care", pattern);

export const saveCareNumberRangeStart = (nextNumber: number) =>
  saveNumberRangeStart("care", nextNumber);
