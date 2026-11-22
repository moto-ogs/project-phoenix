import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the Jahresbescheide of the monthly care (#6219, ADR 0182): a
 * run assesses the months of a year from its first month to December in one
 * fee notice per contract, with monthly installments and, after a change of
 * the contract, a change notice with „bisher / neu / Zu- bzw. Abgang“.
 * Money stays whole cent; backend IDs leave here as strings, calendar dates
 * stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as traegerCareNoticeRunsContract from "./contract/traeger-care-notice-runs.generated";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const RUN_STATUS_VALUES = ["calculated", "released", "discarded"] as const;
const NOTICE_KIND_VALUES = ["initial", "change"] as const;
const LINE_KIND_VALUES = ["module", "reduction", "cost_share"] as const;

export type CareNoticeRunStatus = (typeof RUN_STATUS_VALUES)[number];
export type CareNoticeKind = (typeof NOTICE_KIND_VALUES)[number];

/** The notice kind a value names, undefined when unknown. */
export function knownNoticeKind(value: string): CareNoticeKind | undefined {
  return knownEnum(NOTICE_KIND_VALUES, value);
}
type CareNoticeLineKind = (typeof LINE_KIND_VALUES)[number];

export interface CareNoticeRun {
  readonly id: string;
  readonly year: number;
  readonly periodFrom: string;
  readonly periodUntil: string;
  /** undefined: a status this build does not know. */
  readonly status: CareNoticeRunStatus | undefined;
  readonly schoolIds: readonly string[];
  readonly noticeDate: string | null;
  readonly createdAt: string;
  readonly issuedOn: string | null;
  readonly noticeCount: number | null;
  readonly totalCents: number | null;
  /** When the Abrechnung discarded the empty open run (#6626). */
  readonly discardedAt: string | null;
}

export interface CareNoticeRunList {
  readonly runs: readonly CareNoticeRun[];
  readonly suggestedYear: number;
  readonly suggestedMonth: string;
}

/** One basis of calculation over a span of months with one monthly amount. */
export interface CareNoticeLine {
  readonly kind: CareNoticeLineKind | undefined;
  readonly label: string;
  readonly detail: string;
  readonly periodFrom: string;
  readonly periodUntil: string;
  readonly months: number;
  readonly quantity: number;
  readonly monthlyPreviousCents: number;
  readonly monthlyCents: number;
  readonly annualPreviousCents: number;
  readonly annualCents: number;
  readonly deltaCents: number;
}

export interface CareNoticeInstallment {
  readonly month: string;
  readonly dueOn: string;
  readonly immediatelyDue: boolean;
  readonly previousCents: number;
  readonly amountCents: number;
  readonly deltaCents: number;
}

interface CareNoticeReference {
  readonly id: string;
  readonly number: string;
  readonly issuedOn: string | null;
}

interface CareNoticeRecipient {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly secondName: string;
  readonly address: {
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
  } | null;
}

export interface CareNotice {
  readonly id: string;
  readonly number: string;
  readonly issuedOn: string | null;
  /** undefined: a kind this build does not know. */
  readonly kind: CareNoticeKind | undefined;
  readonly contractId: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly recipient: CareNoticeRecipient;
  readonly paymentMethod: string;
  readonly year: number;
  readonly periodFrom: string;
  readonly periodUntil: string;
  readonly lines: readonly CareNoticeLine[];
  readonly installments: readonly CareNoticeInstallment[];
  readonly previousCents: number;
  readonly totalCents: number;
  readonly deltaCents: number;
  readonly amends: CareNoticeReference | null;
  readonly amendedBy: CareNoticeReference | null;
  readonly legalRemedy: string;
}

export interface CareNoticeRunDetail extends CareNoticeRun {
  readonly notices: readonly CareNotice[];
  readonly unchanged: number;
  readonly billed: number;
  readonly unpricedCount: number;
  readonly duplicateCount: number;
  readonly previewCount: number;
  readonly previewCents: number;
  readonly previewDeltaCents: number;
  readonly fingerprint: string;
  readonly numberPattern: string;
  readonly numberRangeSet: boolean;
  readonly legalRemedyMissing: boolean;
}

/** A notice with the letterhead of the Träger, as page 1 shows it. */
export interface CareNoticeLetter {
  readonly notice: CareNotice;
  readonly senderText: string;
  readonly footerText: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly contactEmail: string;
  readonly accentColor: string;
  readonly logoDataUrl: string;
  readonly bankAccount: {
    readonly accountHolder: string;
    readonly iban: string;
    readonly bic: string;
    readonly bankName: string;
  } | null;
}

function runFromBackend(
  run: traegerCareNoticeRunsContract.CareNoticeRun,
): CareNoticeRun {
  return {
    id: run.id,
    year: run.year,
    periodFrom: requiredDay(run.period_from, "care_notice_run.period_from"),
    periodUntil: requiredDay(run.period_until, "care_notice_run.period_until"),
    status: knownEnum(RUN_STATUS_VALUES, run.status),
    schoolIds: run.school_ids ?? [],
    noticeDate: run.notice_date,
    createdAt: run.created_at,
    issuedOn: run.issued_on,
    noticeCount: run.notice_count,
    totalCents: run.total_cents,
    discardedAt: run.discarded_at,
  };
}

function referenceFromBackend(
  reference: traegerCareNoticeRunsContract.CareNoticeReference | null,
): CareNoticeReference | null {
  return reference
    ? {
        id: reference.id,
        number: reference.number,
        issuedOn: reference.issued_on,
      }
    : null;
}

function noticeFromBackend(
  notice: traegerCareNoticeRunsContract.CareNotice,
): CareNotice {
  const { recipient } = notice;
  return {
    id: notice.id,
    number: notice.number,
    issuedOn: notice.issued_on,
    kind: knownNoticeKind(notice.kind),
    contractId: notice.contract_id,
    schoolId: notice.school_id,
    schoolName: notice.school_name,
    childFirstName: notice.child_first_name,
    childLastName: notice.child_last_name,
    recipient: {
      firstName: recipient.first_name,
      lastName: recipient.last_name,
      email: recipient.email,
      secondName: recipient.second_name,
      address: recipient.address
        ? {
            street: recipient.address.street,
            postalCode: recipient.address.postal_code,
            city: recipient.address.city,
          }
        : null,
    },
    paymentMethod: notice.payment_method,
    year: notice.year,
    periodFrom: requiredDay(notice.period_from, "care_notice.period_from"),
    periodUntil: requiredDay(notice.period_until, "care_notice.period_until"),
    lines: (notice.lines ?? []).map((line) => ({
      kind: knownEnum(LINE_KIND_VALUES, line.kind),
      label: line.label,
      detail: line.detail,
      periodFrom: requiredDay(line.period_from, "care_notice_line.period_from"),
      periodUntil: requiredDay(
        line.period_until,
        "care_notice_line.period_until",
      ),
      months: line.months,
      quantity: line.quantity,
      monthlyPreviousCents: line.monthly_previous_cents,
      monthlyCents: line.monthly_cents,
      annualPreviousCents: line.annual_previous_cents,
      annualCents: line.annual_cents,
      deltaCents: line.delta_cents,
    })),
    installments: (notice.installments ?? []).map((installment) => ({
      month: requiredDay(installment.month, "care_notice_installment.month"),
      dueOn: requiredDay(installment.due_on, "care_notice_installment.due_on"),
      immediatelyDue: installment.immediately_due,
      previousCents: installment.previous_cents,
      amountCents: installment.amount_cents,
      deltaCents: installment.delta_cents,
    })),
    previousCents: notice.previous_cents,
    totalCents: notice.total_cents,
    deltaCents: notice.delta_cents,
    amends: referenceFromBackend(notice.amends),
    amendedBy: referenceFromBackend(notice.amended_by),
    legalRemedy: notice.legal_remedy,
  };
}

function detailFromBackend(
  detail: traegerCareNoticeRunsContract.CareNoticeRunDetail,
): CareNoticeRunDetail {
  return {
    ...runFromBackend(detail),
    notices: (detail.notices ?? []).map(noticeFromBackend),
    unchanged: detail.unchanged,
    billed: detail.billed,
    unpricedCount: (detail.unpriced ?? []).length,
    duplicateCount: (detail.duplicates ?? []).length,
    previewCount: detail.preview_count,
    previewCents: detail.preview_cents,
    previewDeltaCents: detail.preview_delta_cents,
    fingerprint: detail.fingerprint,
    numberPattern: detail.number_pattern,
    numberRangeSet: detail.number_range_set,
    legalRemedyMissing: detail.legal_remedy_missing,
  };
}

export async function fetchCareNoticeRuns(): Promise<CareNoticeRunList> {
  const body = await bffJson("org", "GET /traeger/care-notice-runs/");
  return {
    runs: (body.runs ?? []).map(runFromBackend),
    suggestedYear: body.suggested_year,
    suggestedMonth: requiredDay(
      body.suggested_month,
      "care_notice_runs.suggested_month",
    ),
  };
}

/** What a new run assesses: the year from its first month on. */
export interface CareNoticeRunStartInput {
  readonly year: number;
  readonly fromMonth: string;
  /** Empty: every school of the Träger. */
  readonly schoolIds: readonly string[];
  /** Null takes the day of the release. */
  readonly noticeDate: string | null;
}

export async function startCareNoticeRun(
  input: CareNoticeRunStartInput,
): Promise<CareNoticeRun> {
  return runFromBackend(
    await bffJson("org", "POST /traeger/care-notice-runs/", {
      body: {
        year: input.year,
        from_month: input.fromMonth,
        school_ids: [...input.schoolIds],
        notice_date: input.noticeDate,
      } satisfies traegerCareNoticeRunsContract.CareNoticeRunRequest,
    }),
  );
}

export async function fetchCareNoticeRun(
  runId: string,
): Promise<CareNoticeRunDetail> {
  return detailFromBackend(
    await bffJson("org", "GET /traeger/care-notice-runs/{id}", {
      params: { id: runId },
    }),
  );
}

/** Issues the reviewed notices; a changed state is refused (409). */
export async function releaseCareNoticeRun(
  run: Pick<
    CareNoticeRunDetail,
    "id" | "previewCount" | "previewCents" | "fingerprint"
  >,
): Promise<CareNoticeRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/care-notice-runs/{id}/release", {
      params: { id: run.id },
      body: {
        document_count: run.previewCount,
        total_cents: run.previewCents,
        fingerprint: run.fingerprint,
      },
    }),
  );
}

/**
 * Discards an open run that has nothing to issue (#6626). The server checks
 * under the lock of the release; a run with content is refused (409).
 */
export async function discardCareNoticeRun(
  runId: string,
): Promise<CareNoticeRunDetail> {
  return detailFromBackend(
    await bffJson("org", "POST /traeger/care-notice-runs/{id}/discard", {
      params: { id: runId },
    }),
  );
}

export async function fetchCareNoticeLetter(
  runId: string,
  contractId: string,
): Promise<CareNoticeLetter> {
  const letter = await bffJson(
    "org",
    "GET /traeger/care-notice-runs/{id}/notices/{contractID}/letter",
    { params: { id: runId, contractID: contractId } },
  );
  return {
    notice: noticeFromBackend(letter.notice),
    senderText: letter.sender_text,
    footerText: letter.footer_text,
    contactName: letter.contact_name,
    contactPhone: letter.contact_phone,
    contactEmail: letter.contact_email,
    accentColor: letter.accent_color,
    logoDataUrl: letter.logo_data_url,
    bankAccount: letter.bank_account
      ? {
          accountHolder: letter.bank_account.account_holder,
          iban: letter.bank_account.iban,
          bic: letter.bank_account.bic,
          bankName: letter.bank_account.bank_name,
        }
      : null,
  };
}
