/**
 * Withdrawal and termination of a care contract (#4682): what a contract
 * allows today and the declaration made, for the Träger-Büro and for the
 * parents' button „Verträge hier kündigen“ (§ 312k BGB). Backend int64 IDs
 * leave here as strings; calendar dates stay "YYYY-MM-DD". Types and mapping
 * only; the Träger client lives in care-contract-notices-api.ts.
 */

import { knownEnum } from "./contract/known-enum";
import type { ContractNoticeOptions as ParentNoticeOptions } from "./contract/parent-me.generated";
import { requiredDay } from "./contract/required-day";
import type { NoticeOptions as OfficeNoticeOptions } from "./contract/traeger-contract-notices.generated";
import {
  type CareContractStatus,
  knownContractStatus,
} from "./care-contract-status";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const NOTICE_KIND_VALUES = ["kuendigung", "widerruf"] as const;
const TERMINATION_KIND_VALUES = [
  "ordentlich",
  "sonderkuendigung",
  "ausserordentlich",
] as const;
const CHANNEL_VALUES = ["eltern_app", "traeger_buero"] as const;
const END_DECISION_VALUES = ["festgelegt", "umgedeutet"] as const;

export type NoticeKind = (typeof NOTICE_KIND_VALUES)[number];
/**
 * How the parents terminate (§ 312k Abs. 2 BGB): to the next date, to the
 * special date, or extraordinarily for a reason they name. The Träger sets
 * the end of an extraordinary termination after it checked the reason.
 */
export type TerminationKind = (typeof TERMINATION_KIND_VALUES)[number];

/** Why the notice of a decided end was not mailed, recorded at decision time. */
const END_NOTICE_NOT_SENT_REASONS = [
  "letterhead_missing",
  "missing_student",
  "no_permitted_address",
] as const;
type EndNoticeNotSentReason = (typeof END_NOTICE_NOT_SENT_REASONS)[number];

/** A reason this client does not know yet reads as no recorded reason. */
function endNoticeNotSentReason(
  reason: string | undefined,
): EndNoticeNotSentReason | null {
  return END_NOTICE_NOT_SENT_REASONS.find((known) => known === reason) ?? null;
}

/**
 * How the Träger-Büro decided the end of an extraordinary termination: it
 * set the last day, or it did not accept the reason and the declaration
 * holds as an ordinary termination (Umdeutung, § 140 BGB).
 */
type EndDecision = (typeof END_DECISION_VALUES)[number];

/** A declaration as recorded, with its confirmation as sent. */
export interface ContractNotice {
  /** undefined: a kind this build does not know. */
  readonly kind: NoticeKind | undefined;
  readonly terminationKind: TerminationKind | null;
  /** The parents' reason of an extraordinary termination, else null. */
  readonly reason: string | null;
  /** The parents with the button, or the office for a received letter. */
  readonly channel: (typeof CHANNEL_VALUES)[number] | undefined;
  readonly declaredAt: string;
  readonly receivedOn: string;
  readonly dispatchedOn?: string | null;
  /**
   * Last day of a terminated contract; null after a withdrawal and while
   * the Träger checks an extraordinary termination.
   */
  readonly endsOn: string | null;
  readonly recipient: string;
  readonly confirmationText: string;
  /** Null while the end is open and for every other declaration. */
  readonly endDecision?: EndDecision | null;
  readonly endDecidedAt?: string | null;
  /** The notice of the decided end the parents got, as sent. */
  readonly endNoticeText?: string | null;
  /**
   * Whether the end notice was queued. When false, the office tells the
   * parents itself; endNoticeNotSentReason explains the recorded cause.
   */
  readonly endNoticeSent?: boolean;
  readonly endNoticeNotSentReason?: EndNoticeNotSentReason | null;
}

/** What can be declared on a contract today, or the declaration made. */
export interface ContractNoticeOptions {
  readonly contractId: string;
  readonly traegerName: string;
  /** undefined: a status this build does not know. */
  readonly status: CareContractStatus | undefined;
  readonly childName: string;
  readonly modules: string;
  readonly schoolName: string;
  /** The notice terms as the contract PDF says them. */
  readonly terms: string;
  readonly ordinaryEndsOn: string | null;
  /** Earlier end of the special termination; null when there is none. */
  readonly specialEndsOn: string | null;
  /** Last dispatch day. Office reads retain expired deadlines for postal notices. */
  readonly withdrawalUntil: string | null;
  readonly earlyStart: boolean;
  /**
   * For the office, while an extraordinary termination waits: the last day
   * if it does not accept the reason. Null otherwise.
   */
  readonly reinterpretedEndsOn?: string | null;
  readonly notice: ContractNotice | null;
}

export interface NoticeDeclaration {
  readonly kind: NoticeKind;
  readonly terminationKind?: TerminationKind;
  readonly expectedEndsOn?: string;
  /** Required with an extraordinary termination, never sent otherwise. */
  readonly reason?: string;
}

/**
 * The options as the office route or the parents' route sends them; only
 * the parents' route names the Träger, only the office's the decided end.
 */
export type NoticeOptionsWire = OfficeNoticeOptions | ParentNoticeOptions;

export function noticeOptionsFromBackend(
  row: NoticeOptionsWire,
): ContractNoticeOptions {
  const notice = row.notice;
  return {
    contractId: row.contract_id,
    traegerName: "traeger_name" in row ? row.traeger_name : "",
    status: knownContractStatus(row.status),
    childName: row.child_name,
    modules: row.modules,
    schoolName: row.school_name,
    terms: row.terms,
    ordinaryEndsOn: row.ordinary_ends_on,
    specialEndsOn: row.special_ends_on,
    withdrawalUntil: row.withdrawal_until,
    earlyStart: row.early_start,
    reinterpretedEndsOn:
      ("reinterpreted_ends_on" in row ? row.reinterpreted_ends_on : null) ??
      null,
    notice: notice
      ? {
          kind: knownEnum(NOTICE_KIND_VALUES, notice.kind),
          terminationKind:
            knownEnum(TERMINATION_KIND_VALUES, notice.termination_kind) ?? null,
          reason: notice.reason ?? null,
          channel: knownEnum(CHANNEL_VALUES, notice.channel),
          declaredAt: notice.declared_at,
          receivedOn: requiredDay(notice.received_on, "notice.received_on"),
          dispatchedOn: notice.dispatched_on ?? null,
          endsOn: notice.ends_on,
          recipient: notice.recipient,
          confirmationText: notice.confirmation_text,
          endDecision:
            knownEnum(END_DECISION_VALUES, notice.end_decision) ?? null,
          endDecidedAt: notice.end_decided_at ?? null,
          endNoticeText: notice.end_notice_text ?? null,
          endNoticeSent:
            "end_notice_sent" in notice
              ? (notice.end_notice_sent ?? false)
              : false,
          endNoticeNotSentReason: endNoticeNotSentReason(
            "end_notice_not_sent_reason" in notice
              ? notice.end_notice_not_sent_reason
              : undefined,
          ),
        }
      : null,
  };
}

export function declarationBody(declaration: NoticeDeclaration) {
  return {
    kind: declaration.kind,
    ...(declaration.kind === "kuendigung"
      ? {
          termination_kind: declaration.terminationKind ?? "ordentlich",
          ...(declaration.expectedEndsOn
            ? { expected_ends_on: declaration.expectedEndsOn }
            : {}),
          ...(declaration.terminationKind === "ausserordentlich"
            ? { reason: declaration.reason ?? "" }
            : {}),
        }
      : {}),
  };
}
