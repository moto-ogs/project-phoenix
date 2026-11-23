import { bffFile, bffJson } from "~/lib/bff-fetch";
/**
 * Client of the care contracts in the Träger portal (#4678, ADR 0153): the
 * contract template of every offering, the drafts from the accepted
 * applications, the PDF, the send by mail and into the parents app, and the
 * discard of a draft. Backend int64 IDs leave here as strings; money stays
 * whole cent; calendar dates stay "YYYY-MM-DD".
 */

import {
  type MailOutcome,
  knownMailOutcome,
} from "~/lib/email-delivery-status";
import {
  type CareContractStatus,
  knownContractStatus,
} from "./care-contract-status";
import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as traegerContractTemplatesContract from "./contract/traeger-contract-templates.generated";
import type * as traegerContractsContract from "./contract/traeger-contracts.generated";
import { filenameFromDisposition } from "./file-download";
import {
  type ContractCorrectionChange,
  type ContractCorrectionValues,
  correctionChangesFromBackend,
  correctionValuesFromBackend,
} from "./traeger-contract-correction-api";

export type { CareContractStatus } from "./care-contract-status";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const TERM_KIND_VALUES = ["open_ended", "school_year", "fixed_months"] as const;
const NOTICE_TO_VALUES = ["month_end", "half_year", "school_year_end"] as const;
const WEEKDAY_VALUES = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
const TEMPLATE_ISSUE_VALUES = [
  "template_missing",
  "templates_differ",
  "conclusion_automatic",
  "acceptance_missing",
  "acceptance_missing_renewal",
  "acceptance_changed",
  "recipient_missing",
  "mail_blocked",
  "mail_stopped",
  "imported_contract",
] as const;
const ACCEPTANCE_ISSUE_VALUES = [
  "acceptance_missing",
  "acceptance_changed",
] as const;
const MAIL_BLOCK_VALUES = ["stopped", "address"] as const;
const CONCLUSION_METHOD_VALUES = [
  "mit_anmeldung",
  "einfach_elektronisch",
  "papier",
] as const;
const CONCLUSION_MODE_VALUES = ["nachtraeglich", "bei_annahme"] as const;
const MAIL_STATE_VALUES = ["queued", "sent", "failed", "unknown"] as const;
const VERSION_STATUS_VALUES = [
  "beantragt",
  "wirksam",
  "abgeloest",
  "abgelehnt",
  "ersetzt",
] as const;
const VERSION_SOURCE_VALUES = [
  "abschluss",
  "buchungsaenderung",
  "import",
  "angebotskorrektur",
] as const;
const SIGNATURE_METHOD_VALUES = ["drawn", "typed", "paper"] as const;
const SIGNATURE_CHANNEL_VALUES = [
  "parent_account",
  "mail_link",
  "office",
] as const;
const CREATE_SKIP_VALUES = [
  ...TEMPLATE_ISSUE_VALUES,
  "contract_exists",
  "application_not_found",
] as const;
const SEND_SKIP_VALUES = [
  "recipient_missing",
  "partner_missing",
  "mail_pending",
  "mail_delayed",
  "mail_blocked",
  "mail_block_unreadable",
  "not_sendable",
] as const;
const SEND_BLOCK_VALUES = [
  "delayed",
  "stopped",
  "address",
  "provider",
  "provider_unknown",
] as const;

export type ContractTermKind = (typeof TERM_KIND_VALUES)[number];
export type ContractNoticeTo = (typeof NOTICE_TO_VALUES)[number];
export type Weekday = (typeof WEEKDAY_VALUES)[number];

/**
 * The terms of a contract template. undefined: a term kind or notice date
 * this build does not know; saving it again lets the backend refuse it.
 */
export interface ContractTerms {
  readonly termKind: ContractTermKind | undefined;
  readonly termMonths: number | null;
  readonly noticeMonths: number;
  readonly noticeTo: ContractNoticeTo | undefined;
  readonly specialTermination: boolean;
  readonly specialTerminationNote: string;
  readonly statuteRequired: boolean;
  readonly statuteTitle: string;
  readonly statuteUrl: string;
  /** Empty: the Träger itself. */
  readonly contractPartner: string;
}

interface ContractTemplate extends ContractTerms {
  readonly id: string;
  readonly updatedAt: string;
}

/** One offering of a school with its template, or none yet. */
export interface OfferingTemplate {
  readonly acceptanceText?: string;
  /**
   * The withdrawal notice and the block for an early start the school adds
   * to the enrollment form (#4682); empty like `acceptanceText`.
   */
  readonly withdrawalText?: string;
  readonly earlyStartText?: string;
  /** The term and the notice period as the PDF prints them. */
  readonly termText: string;
  readonly noticeText: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly offeringId: string;
  readonly offeringName: string;
  readonly phaseName: string;
  readonly priceCents: number | null;
  readonly active: boolean;
  readonly template: ContractTemplate | null;
}

/** One contract per accepted application child at its school. */
export interface CandidateKey {
  readonly schoolId: string;
  readonly requestChildId: string;
}

/**
 * One booked service: on a weekday the module (a care offering) and its end
 * time "HH:MM", empty when the module has none. A weekday without a service
 * has no care; a weekday may carry several modules.
 */
export interface ContractService {
  readonly weekday: Weekday;
  readonly careOfferingId: string;
  readonly moduleName: string;
  readonly endsAt: string;
  /**
   * Last booked day "YYYY-MM-DD" of a module that ends before the contract
   * version; null when it runs as long as the version.
   */
  readonly lastDay: string | null;
}

/**
 * Why no draft can be made for a candidate yet. "other": a reason this
 * build does not know; still no draft.
 */
export type TemplateIssue = (typeof TEMPLATE_ISSUE_VALUES)[number] | "other";

/**
 * Why the application gives no proof of the parents' agreement for a
 * conclusion at the acceptance (#4680); null when it does.
 */
type AcceptanceIssue = (typeof ACCEPTANCE_ISSUE_VALUES)[number] | "other";

/** An accepted application child with booked care and no contract. */
export interface ContractCandidate extends CandidateKey {
  readonly acceptanceIssue: AcceptanceIssue | null;
  /**
   * A rollover renewed the child into a new phase; a missing acceptance then
   * means the parents have not accepted that phase's conditions (#6456).
   */
  readonly renewal: boolean;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly guardianName: string;
  readonly guardianEmail: string;
  readonly phaseName: string;
  readonly services: readonly ContractService[];
  readonly effectiveFrom: string;
  readonly templateIssue: TemplateIssue | null;
  /** The booked modules as the contract names them: „A, B und C“. */
  readonly modulesText: string;
  /**
   * Why a mail to the parents' address would stay back now, for a child the
   * conclusion at the acceptance could conclude (#4680); null otherwise.
   */
  readonly mailBlock: (typeof MAIL_BLOCK_VALUES)[number] | "other" | null;
  /** The imported contract that names the child (issue imported_contract). */
  readonly importedContractId: string | null;
}

/**
 * How a contract was concluded (ADR 0088 section 3): at the acceptance of
 * the application, or with the parents' signature.
 */
export type ConclusionMethod = (typeof CONCLUSION_METHOD_VALUES)[number];

export interface ContractConclusion {
  /** undefined: a method this build does not know. */
  readonly method: ConclusionMethod | undefined;
  /**
   * When it was concluded. For a contract with `dateUnknown` only a stand-in
   * the backend needs: never show it as the day of the conclusion.
   */
  readonly at: string;
  /**
   * The contract came from an import (#4723): it was concluded before moto,
   * online in the previous program or on paper. Absent: a view that does not
   * carry it, read as false.
   */
  readonly takenOver?: boolean;
  /** The office does not know the day of the conclusion (#7767). */
  readonly dateUnknown?: boolean;
}

/**
 * How the contracts of a school come about (#4680): sent later by the
 * office (Weg a) or concluded at the acceptance (Weg b).
 */
export type ConclusionMode = (typeof CONCLUSION_MODE_VALUES)[number];

export interface SchoolConclusionMode {
  readonly schoolId: string;
  readonly schoolName: string;
  /** undefined: a mode this build does not know. */
  readonly mode: ConclusionMode | undefined;
}

export interface CareContractSummary {
  readonly id: string;
  /** undefined: a status this build does not know. */
  readonly status: CareContractStatus | undefined;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly moduleNames: readonly string[];
  /** The modules as the contract names them: „A, B und C“. */
  readonly modulesText: string;
  readonly partyName: string;
  readonly partyEmail: string;
  readonly effectiveFrom: string;
  readonly createdAt: string;
  readonly sentAt: string | null;
  /** Null until the contract is concluded. */
  readonly concluded: ContractConclusion | null;
  /** Last day of a terminated contract (#4682); null otherwise. */
  readonly endsOn: string | null;
  /** The child record the contract is linked to; null without one (#7760). */
  readonly studentId: string | null;
  /** Taken over from a file, not made from an application (ADR 0232). */
  readonly imported: boolean;
  /**
   * The contract follows the approved bookings of an enrollment: every one
   * from an application, and an imported one once it is bound (ADR 0309).
   */
  readonly followsBookings: boolean;
  /** The enrollment (application child) it follows; null without one. */
  readonly requestChildId: string | null;
}

export interface CareContractList {
  readonly contracts: readonly CareContractSummary[];
  readonly counts: Readonly<Partial<Record<CareContractStatus, number>>>;
  readonly hasMore: boolean;
}

/** "unknown" also stands for a state this build does not know. */
export type ContractMailState = (typeof MAIL_STATE_VALUES)[number];

/** The state of a contract version (ADR 0088 section 2, #4681). */
type ContractVersionStatus = (typeof VERSION_STATUS_VALUES)[number];

/** Where a version came from: the conclusion or an approved change. */
type ContractVersionSource = (typeof VERSION_SOURCE_VALUES)[number];

export interface ContractVersion {
  readonly number: number;
  readonly status: ContractVersionStatus | undefined;
  readonly source: ContractVersionSource | undefined;
  readonly effectiveFrom: string;
  readonly endsOn: string | null;
  /** The last day it holds; null while it holds open ended. */
  readonly validUntil: string | null;
  readonly services: readonly ContractService[];
  readonly createdAt: string;
}

export interface CareContractDetail extends CareContractSummary {
  readonly version: {
    readonly number: number;
    readonly effectiveFrom: string;
    readonly endsOn: string | null;
    readonly childBirthDate: string | null;
    readonly schoolName: string;
    readonly phaseName: string;
    readonly services: readonly ContractService[];
    readonly priceCents: number | null;
    readonly terms: ContractTerms;
    readonly createdAt: string;
  };
  readonly parties: readonly {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly hasAccount: boolean;
  }[];
  readonly mailings: readonly {
    readonly recipient: string;
    readonly sentAt: string;
    readonly state: ContractMailState;
    readonly outcome?: MailOutcome;
    /** Why another mail to this address would stay back now. */
    readonly sendBlock?: ContractSendBlock;
  }[];
  readonly documentFrozen: boolean;
  /** Every version, oldest first. */
  readonly versions: readonly ContractVersion[];
  /** The signature of the current version (#4679); null until signed. */
  readonly signature: ContractSignature | null;
  /** The reminders of a contract that waits for its signature. */
  readonly reminders: readonly {
    readonly number: number;
    readonly sentAt: string;
  }[];
  /**
   * Term up to the contract's last day, notice period and monthly fee of the
   * version above, as the contract PDF prints them.
   */
  readonly termText: string;
  readonly noticeText: string;
  readonly feeText: string;
  /**
   * Values the office completed from the original documents after the
   * import (#7767), in the order the backend lists them.
   */
  readonly corrections: readonly ContractCorrectionRecord[];
}

/** One completion of an imported contract: what changed, and the proof. */
export interface ContractCorrectionRecord {
  readonly correctedAt: string;
  readonly file: string;
  readonly evidence: string;
  readonly changes: readonly ContractCorrectionChange[];
  readonly before: ContractCorrectionValues;
  readonly after: ContractCorrectionValues;
}

export interface ContractSignature {
  readonly method: (typeof SIGNATURE_METHOD_VALUES)[number] | undefined;
  readonly channel: (typeof SIGNATURE_CHANNEL_VALUES)[number] | undefined;
  readonly signerName: string;
  readonly signedAt: string;
  readonly signedOn: string;
  readonly documentSha256: string;
  readonly earlyStartRequested: boolean;
  readonly withdrawalEndsOn: string | null;
  /** The drawn or typed signature as a base64 PNG; empty on paper. */
  readonly imagePng: string;
  readonly paperFilename: string;
  readonly intact: boolean;
}

/** "other": a reason this build does not know; the draft was not made. */
type CreateSkipReason = (typeof CREATE_SKIP_VALUES)[number] | "other";

export interface CreateResult {
  readonly created: readonly CareContractSummary[];
  readonly skipped: readonly (CandidateKey & {
    readonly reason: CreateSkipReason;
  })[];
}

/** "other": a reason this build does not know; the contract was not sent. */
export type SendSkipReason = (typeof SEND_SKIP_VALUES)[number] | "other";

/** "other": a block this build does not know; the mail still stays back. */
type ContractSendBlock = (typeof SEND_BLOCK_VALUES)[number] | "other";

export interface SendResult {
  readonly sent: readonly string[];
  readonly skipped: readonly {
    readonly id: string;
    readonly reason: SendSkipReason;
  }[];
}

export interface ContractFile {
  readonly blob: Blob;
  readonly filename: string;
}

/** A reason of a closed set; one this build does not know is "other". */
function reasonOf<T extends string>(
  values: readonly T[],
  value: string,
): T | "other" {
  return knownEnum(values, value) ?? "other";
}

/** An optional reason: "" or absent is none. */
function optionalReason<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | "other" | null {
  return value ? reasonOf(values, value) : null;
}

export function termsFromBackend(
  terms: Omit<traegerContractsContract.TemplateInput, "term_months"> & {
    readonly term_months?: number | null;
  },
): ContractTerms {
  return {
    termKind: knownEnum(TERM_KIND_VALUES, terms.term_kind),
    termMonths: terms.term_months ?? null,
    noticeMonths: terms.notice_months,
    noticeTo: knownEnum(NOTICE_TO_VALUES, terms.notice_to),
    specialTermination: terms.special_termination,
    specialTerminationNote: terms.special_termination_note,
    statuteRequired: terms.statute_required,
    statuteTitle: terms.statute_title,
    statuteUrl: terms.statute_url,
    contractPartner: terms.contract_partner,
  };
}

// An unknown term kind or notice date goes back as "": the backend refuses it
// at its field instead of the client guessing one.
export function termsToBackend(
  terms: ContractTerms,
): traegerContractsContract.TemplateInput {
  return {
    term_kind: terms.termKind ?? "",
    term_months: terms.termKind === "fixed_months" ? terms.termMonths : null,
    notice_months: terms.noticeMonths,
    notice_to: terms.noticeTo ?? "",
    special_termination: terms.specialTermination,
    special_termination_note: terms.specialTerminationNote,
    statute_required: terms.statuteRequired,
    statute_title: terms.statuteTitle,
    statute_url: terms.statuteUrl,
    contract_partner: terms.contractPartner,
  };
}

function offeringFromBackend(
  row: traegerContractTemplatesContract.OfferingTemplate,
): OfferingTemplate {
  return {
    acceptanceText: row.acceptance_text,
    withdrawalText: row.withdrawal_text,
    earlyStartText: row.early_start_text,
    termText: row.term_text,
    noticeText: row.notice_text,
    schoolId: row.school_id,
    schoolName: row.school_name,
    offeringId: row.offering_id,
    offeringName: row.offering_name,
    phaseName: row.phase_name,
    priceCents: row.price_cents,
    active: row.active,
    template: row.template
      ? {
          ...termsFromBackend(row.template),
          id: row.template.id,
          updatedAt: row.template.updated_at,
        }
      : null,
  };
}

// A service on a weekday this build does not know is left out.
function servicesFromBackend(
  rows: readonly traegerContractsContract.Service[] | null,
): ContractService[] {
  return (rows ?? []).flatMap((row) => {
    const weekday = knownEnum(WEEKDAY_VALUES, row.weekday);
    if (!weekday) return [];
    return [
      {
        weekday,
        careOfferingId: row.care_offering_id,
        moduleName: row.module_name,
        endsAt: row.ends_at,
        lastDay: row.last_day,
      },
    ];
  });
}

function candidateFromBackend(
  row: traegerContractsContract.Candidate,
): ContractCandidate {
  return {
    schoolId: row.school_id,
    requestChildId: row.request_child_id,
    schoolName: row.school_name,
    childFirstName: row.child_first_name,
    childLastName: row.child_last_name,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
    phaseName: row.phase_name,
    services: servicesFromBackend(row.services),
    effectiveFrom: requiredDay(row.effective_from, "candidate.effective_from"),
    templateIssue: optionalReason(TEMPLATE_ISSUE_VALUES, row.template_issue),
    modulesText: row.modules_text,
    acceptanceIssue: optionalReason(
      ACCEPTANCE_ISSUE_VALUES,
      row.acceptance_issue,
    ),
    renewal: row.renewal,
    mailBlock: optionalReason(MAIL_BLOCK_VALUES, row.mail_block),
    importedContractId: row.imported_contract_id ?? null,
  };
}

function summaryFromBackend(
  row: traegerContractsContract.ContractSummary,
): CareContractSummary {
  return {
    id: row.id,
    status: knownContractStatus(row.status),
    schoolId: row.school_id,
    schoolName: row.school_name,
    childFirstName: row.child_first_name,
    childLastName: row.child_last_name,
    moduleNames: row.module_names ?? [],
    modulesText: row.modules_text,
    partyName: row.party_name,
    partyEmail: row.party_email,
    effectiveFrom: requiredDay(row.effective_from, "contract.effective_from"),
    createdAt: row.created_at,
    sentAt: row.sent_at,
    concluded: row.concluded
      ? {
          method: knownEnum(CONCLUSION_METHOD_VALUES, row.concluded.method),
          at: row.concluded.at,
          takenOver: row.concluded.taken_over,
          dateUnknown: row.concluded.date_unknown,
        }
      : null,
    endsOn: row.ends_on,
    studentId: row.student_id,
    imported: row.imported,
    followsBookings: row.follows_bookings,
    requestChildId: row.request_child_id,
  };
}

function detailFromBackend(
  row: traegerContractsContract.ContractDetail,
): CareContractDetail {
  return {
    ...summaryFromBackend(row),
    version: {
      number: row.version.number,
      effectiveFrom: requiredDay(
        row.version.effective_from,
        "contract_version.effective_from",
      ),
      endsOn: row.version.ends_on,
      childBirthDate: row.version.child_birth_date,
      schoolName: row.version.school_name,
      phaseName: row.version.phase_name,
      services: servicesFromBackend(row.version.services),
      priceCents: row.version.price_cents,
      terms: termsFromBackend(row.version.terms),
      createdAt: row.version.created_at,
    },
    parties: (row.parties ?? []).map((party) => ({
      firstName: party.first_name,
      lastName: party.last_name,
      email: party.email,
      hasAccount: party.has_account,
    })),
    mailings: (row.mailings ?? []).map((mailing) => ({
      recipient: mailing.recipient,
      sentAt: mailing.sent_at,
      outcome: knownMailOutcome(mailing.outcome),
      sendBlock: mailing.send_block
        ? reasonOf(SEND_BLOCK_VALUES, mailing.send_block)
        : undefined,
      // The backend names a state it cannot read "unknown" itself.
      state: knownEnum(MAIL_STATE_VALUES, mailing.state) ?? "unknown",
    })),
    documentFrozen: row.document_frozen,
    signature: row.signature
      ? {
          method: knownEnum(SIGNATURE_METHOD_VALUES, row.signature.method),
          channel: knownEnum(SIGNATURE_CHANNEL_VALUES, row.signature.channel),
          signerName: row.signature.signer_name,
          signedAt: row.signature.signed_at,
          signedOn: requiredDay(row.signature.signed_on, "signature.signed_on"),
          documentSha256: row.signature.document_sha256,
          earlyStartRequested: row.signature.early_start_requested,
          withdrawalEndsOn: row.signature.withdrawal_ends_on,
          imagePng: row.signature.image_png ?? "",
          paperFilename: row.signature.paper_filename,
          intact: row.signature.intact,
        }
      : null,
    reminders: (row.reminders ?? []).map((reminder) => ({
      number: reminder.number,
      sentAt: reminder.sent_at,
    })),
    versions: (row.versions ?? []).map((version) => ({
      number: version.number,
      status: knownEnum(VERSION_STATUS_VALUES, version.status),
      source: knownEnum(VERSION_SOURCE_VALUES, version.source),
      effectiveFrom: requiredDay(
        version.effective_from,
        "contract_version.effective_from",
      ),
      endsOn: version.ends_on,
      validUntil: version.valid_until,
      services: servicesFromBackend(version.services),
      createdAt: version.created_at,
    })),
    termText: row.term_text,
    noticeText: row.notice_text,
    feeText: row.fee_text,
    corrections: (row.corrections ?? []).map((correction) => ({
      correctedAt: correction.corrected_at,
      file: correction.file,
      evidence: correction.evidence,
      changes: correctionChangesFromBackend(correction.changes),
      before: correctionValuesFromBackend(correction.before),
      after: correctionValuesFromBackend(correction.after),
    })),
  };
}

function keyToBackend(key: CandidateKey) {
  return {
    school_id: key.schoolId,
    request_child_id: key.requestChildId,
  };
}

export async function fetchCareContracts(
  filter: {
    status?: CareContractStatus;
    schoolId?: string;
    search?: string;
    offset?: number;
  } = {},
): Promise<CareContractList> {
  const body = await bffJson("org", "GET /traeger/contracts/", {
    query: {
      status: filter.status || undefined,
      school_id: filter.schoolId || undefined,
      search: filter.search || undefined,
      offset: filter.offset || undefined,
    },
  });
  const counts: Partial<Record<CareContractStatus, number>> = {};
  for (const [status, count] of Object.entries(body.counts ?? {})) {
    const known = knownContractStatus(status);
    if (known) counts[known] = count;
  }
  return {
    contracts: (body.contracts ?? []).map(summaryFromBackend),
    counts,
    hasMore: body.has_more,
  };
}

export async function fetchConclusionModes(): Promise<SchoolConclusionMode[]> {
  const rows = await bffJson("org", "GET /traeger/contracts/conclusion-modes");
  return rows.map((row) => ({
    schoolId: row.school_id,
    schoolName: row.school_name,
    mode: knownEnum(CONCLUSION_MODE_VALUES, row.mode),
  }));
}

export async function fetchContractCandidates(): Promise<ContractCandidate[]> {
  const rows = await bffJson("org", "GET /traeger/contracts/candidates");
  return rows.map(candidateFromBackend);
}

// The backend accepts at most 200 items per request. Sequential batches
// keep large selections within that contract without concurrent PDF rendering.
const MAX_BATCH = 200;

export async function createCareContracts(
  keys: readonly CandidateKey[],
): Promise<CreateResult> {
  const result: {
    created: CareContractSummary[];
    skipped: CreateResult["skipped"][number][];
  } = { created: [], skipped: [] };
  for (let offset = 0; offset < keys.length; offset += MAX_BATCH) {
    const batch = await createCareContractBatch(
      keys.slice(offset, offset + MAX_BATCH),
    );
    result.created.push(...batch.created);
    result.skipped.push(...batch.skipped);
  }
  return result;
}

export async function sendCareContracts(
  ids: readonly string[],
): Promise<SendResult> {
  const result: { sent: string[]; skipped: SendResult["skipped"][number][] } = {
    sent: [],
    skipped: [],
  };
  for (let offset = 0; offset < ids.length; offset += MAX_BATCH) {
    const batch = await sendCareContractBatch(
      ids.slice(offset, offset + MAX_BATCH),
    );
    result.sent.push(...batch.sent);
    result.skipped.push(...batch.skipped);
  }
  return result;
}

async function createCareContractBatch(
  keys: readonly CandidateKey[],
): Promise<CreateResult> {
  const body = await bffJson("org", "POST /traeger/contracts/", {
    body: {
      contracts: keys.map(keyToBackend),
    } satisfies traegerContractsContract.CreateRequest,
  });
  return {
    created: (body.created ?? []).map(summaryFromBackend),
    skipped: (body.skipped ?? []).map((skip) => ({
      schoolId: skip.school_id,
      requestChildId: skip.request_child_id,
      reason: reasonOf(CREATE_SKIP_VALUES, skip.reason),
    })),
  };
}

/** Retries a failed delivery at a corrected address, keeping its PDF. */
export function resendCareContract(
  id: string,
  email: string,
): Promise<SendResult> {
  return sendCareContractBatch([id], email);
}

async function sendCareContractBatch(
  ids: readonly string[],
  recipientEmail?: string,
): Promise<SendResult> {
  const body = await bffJson("org", "POST /traeger/contracts/send", {
    body: {
      contract_ids: [...ids],
      ...(recipientEmail === undefined
        ? {}
        : { recipient_email: recipientEmail }),
    } satisfies traegerContractsContract.SendRequest,
  });
  return {
    sent: body.sent ?? [],
    skipped: (body.skipped ?? []).map((skip) => ({
      id: skip.id,
      reason: reasonOf(SEND_SKIP_VALUES, skip.reason),
    })),
  };
}

export async function fetchCareContract(
  id: string,
): Promise<CareContractDetail> {
  return detailFromBackend(
    await bffJson("org", "GET /traeger/contracts/{id}", { params: { id } }),
  );
}

export async function discardCareContract(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/contracts/{id}", { params: { id } });
}

/** The PDF: a preview of a draft, the stored document once sent. */
export async function downloadCareContract(id: string): Promise<ContractFile> {
  return downloadContractFile(
    bffFile("org", "GET /traeger/contracts/{id}/document", { params: { id } }),
  );
}

/**
 * The PDF of one version (#4681): the stored one when it was sent, else a
 * rendering with the current letterhead.
 */
export async function downloadCareContractVersion(
  id: string,
  number: number,
): Promise<ContractFile> {
  return downloadContractFile(
    bffFile("org", "GET /traeger/contracts/{id}/versions/{number}/document", {
      params: { id, number: String(number) },
    }),
  );
}

async function downloadContractFile(
  file: Promise<Response>,
  fallbackFilename = "betreuungsvertrag.pdf",
): Promise<ContractFile> {
  const response = await file;
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response) ?? fallbackFilename,
  };
}

export async function fetchContractTemplates(): Promise<OfferingTemplate[]> {
  const rows = await bffJson("org", "GET /traeger/contract-templates/");
  return rows.map(offeringFromBackend);
}

export async function saveContractTemplate(
  schoolId: string,
  offeringId: string,
  terms: ContractTerms,
): Promise<OfferingTemplate> {
  return offeringFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/contract-templates/{schoolId}/{offeringId}",
      { params: { schoolId, offeringId }, body: termsToBackend(terms) },
    ),
  );
}

/**
 * Records a contract the parents signed on paper (#4679): the signed PDF,
 * who signed and on which day. The contract is concluded afterwards.
 */
export async function recordPaperSignature(
  id: string,
  input: {
    readonly file: File;
    readonly signerName: string;
    readonly signedOn: string;
  },
): Promise<void> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("signer_name", input.signerName);
  form.append("signed_on", input.signedOn);
  await bffJson("org", "POST /traeger/contracts/{id}/paper-signature", {
    params: { id },
    body: form,
  });
}

export async function downloadPaperSignature(
  id: string,
): Promise<ContractFile> {
  return downloadContractFile(
    bffFile("org", "GET /traeger/contracts/{id}/paper-signature", {
      params: { id },
    }),
    "vertrag-papier.pdf",
  );
}
