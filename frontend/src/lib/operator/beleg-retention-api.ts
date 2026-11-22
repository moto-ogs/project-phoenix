import type * as operatorOrganizationsContract from "~/lib/contract/operator-organizations.generated";
import { bffJson } from "~/lib/bff-fetch";

/** Belegarten des Trägers (#4720, ADR 0184), in Anzeigereihenfolge. */
export const BELEG_TYPES = [
  "holiday_document",
  "care_invoice",
  "care_notice",
  "care_contract",
  "sepa_mandate",
  "sepa_debit",
] as const;

export type BelegType = (typeof BELEG_TYPES)[number];

const BELEG_TYPE_LABELS: Record<BelegType, string> = {
  holiday_document: "Ferienrechnungen, Stornos und Gutschriften",
  care_invoice: "Monatsrechnungen mit Storno",
  care_notice: "Jahresbescheide",
  care_contract: "Betreuungsverträge",
  sepa_mandate: "SEPA-Mandate",
  sepa_debit: "SEPA-Lastschriften",
};

export const TRIGGER_LABELS: Record<string, string> = {
  issued: "Ausstellung",
  contract_concluded: "Vertragsabschluss",
  contract_ended: "Vertragsende",
  last_collection: "Letzte eingezogene Lastschrift",
};

/** Ereignisse, die eine Weisung je Belegart nennen darf. */
export const TRIGGERS_BY_TYPE: Record<BelegType, readonly string[]> = {
  holiday_document: ["issued"],
  care_invoice: ["issued"],
  care_notice: ["issued"],
  care_contract: ["contract_ended", "contract_concluded"],
  sepa_mandate: ["last_collection"],
  sepa_debit: ["issued"],
};

/** Grundlagen einer Weisung (Löschkonzept Abschnitt 2). */
export const BASIS_LABELS: Record<string, string> = {
  booking_voucher: "Buchungsbeleg (AO, HGB, UStG)",
  business_letter: "Handels- oder Geschäftsbrief",
  collection_agreement: "Inkassovereinbarung",
  not_applicable: "Vorschriften nicht anwendbar",
};

/** Grundlagen, die eine Weisung je Belegart nennen darf. */
export const BASES_BY_TYPE: Record<BelegType, readonly string[]> = {
  holiday_document: ["booking_voucher", "not_applicable"],
  care_invoice: ["booking_voucher", "not_applicable"],
  care_notice: ["booking_voucher", "business_letter", "not_applicable"],
  care_contract: ["booking_voucher", "business_letter", "not_applicable"],
  sepa_mandate: ["collection_agreement"],
  sepa_debit: ["booking_voucher", "not_applicable"],
};

/** Kürzeste Frist je Grundlage; ein Mandat zählt Monate. */
export function minimumPeriod(type: string, basis: string): number {
  if (type === "sepa_mandate") return 14;
  if (basis === "booking_voucher") return 8;
  if (basis === "business_letter") return 6;
  return 1;
}

export const CLARIFICATION_REASON_LABELS: Record<string, string> = {
  no_instruction: "Keine Weisung",
  no_collection: "Mandat ohne Einzug",
  no_trigger_date: "Kein Datum für das Ereignis",
};

/**
 * Types the deletion log counts beside the Belege: the debtor numbers of
 * families without a care contract (#6692), which follow the instruction
 * for the holiday documents.
 */
const DELETION_ONLY_LABELS: Record<string, string> = {
  family_debtor_number: "Debitorennummern von Familien ohne Vertrag",
};

export function belegTypeLabel(type: string): string {
  return (
    BELEG_TYPE_LABELS[type as BelegType] ?? DELETION_ONLY_LABELS[type] ?? type
  );
}

/** Ein SEPA-Mandat zählt Monate, alle anderen Belegarten Jahre. */
export function periodUnit(type: string): "Monate" | "Jahre" {
  return type === "sepa_mandate" ? "Monate" : "Jahre";
}

export interface RetentionInstruction {
  readonly id: string;
  readonly belegType: string;
  readonly triggerEvent: string;
  readonly period: number;
  readonly basis: string;
  readonly legalBasis: string;
  readonly basisJustification: string;
  readonly instructedBy: string;
  readonly instructedOn: string;
  readonly instructionReference: string;
  /** Der Träger hat schriftlich bestätigt, dass AO, HGB und UStG nicht gelten. */
  readonly statutesNotApplicableConfirmed: boolean;
  readonly confirmedAt: string | null;
  readonly recordedAt: string;
}

export interface RetentionSuspension {
  readonly id: string;
  readonly belegType: string;
  readonly belegId: string | null;
  readonly reason: string;
  readonly scope: string;
  readonly responsible: string;
  readonly reviewOn: string;
}

export interface BelegSummary {
  readonly belegType: string;
  readonly scheduled: number;
  readonly running: number;
  readonly clarification: number;
  readonly suspended: number;
  readonly nextEnd: string | null;
}

export interface BelegClarification {
  readonly belegType: string;
  readonly reason: string;
  readonly count: number;
  readonly overdue: number;
  readonly listedOn: string;
  readonly reviewOn: string;
  readonly responsible: string;
  readonly lastReview: BelegClarificationReview | null;
}

interface BelegClarificationReview {
  readonly note: string;
  readonly escalated: boolean;
  readonly escalationReason: string;
  readonly reviewedOn: string;
  readonly nextReviewOn: string;
}

export interface BelegDeletion {
  readonly belegType: string;
  readonly deletedOn: string;
  readonly count: number;
}

export interface BelegRetentionOverview {
  readonly instructions: readonly RetentionInstruction[];
  readonly suspensions: readonly RetentionSuspension[];
  readonly summary: readonly BelegSummary[];
  readonly clarifications: readonly BelegClarification[];
  readonly deletions: readonly BelegDeletion[];
  readonly evaluatedOn: string | null;
}

export type RecordInstructionRequest =
  operatorOrganizationsContract.instructionRequest;
export type RecordSuspensionRequest =
  operatorOrganizationsContract.suspensionRequest;
export type RecordClarificationReviewRequest =
  operatorOrganizationsContract.clarificationReviewRequest;

export function mapBelegRetentionOverview(
  wire: operatorOrganizationsContract.BelegRetentionOverview,
): BelegRetentionOverview {
  return {
    instructions: (wire.instructions ?? []).map((row) => ({
      id: row.id,
      belegType: row.beleg_type,
      triggerEvent: row.trigger_event,
      period: row.period,
      basis: row.basis,
      legalBasis: row.legal_basis,
      basisJustification: row.basis_justification ?? "",
      instructedBy: row.instructed_by,
      instructedOn: row.instructed_on ?? "",
      instructionReference: row.instruction_reference,
      statutesNotApplicableConfirmed: row.statutes_not_applicable_confirmed,
      confirmedAt: row.confirmed_at || null,
      recordedAt: row.recorded_at,
    })),
    suspensions: (wire.suspensions ?? []).map(mapSuspension),
    summary: (wire.summary ?? []).map((row) => ({
      belegType: row.beleg_type,
      scheduled: row.scheduled,
      running: row.running,
      clarification: row.clarification,
      suspended: row.suspended,
      nextEnd: row.next_end || null,
    })),
    clarifications: (wire.clarifications ?? []).map((row) => ({
      belegType: row.beleg_type,
      reason: row.reason,
      count: row.count,
      overdue: row.overdue,
      listedOn: row.listed_on ?? "",
      reviewOn: row.review_on ?? "",
      responsible: row.responsible,
      lastReview: row.last_review ? mapReview(row.last_review) : null,
    })),
    deletions: (wire.deletions ?? []).map((row) => ({
      belegType: row.beleg_type,
      deletedOn: row.deleted_on ?? "",
      count: row.count,
    })),
    evaluatedOn: wire.evaluated_on || null,
  };
}

function mapReview(
  row: operatorOrganizationsContract.BelegClarificationReview,
): BelegClarificationReview {
  return {
    note: row.note,
    escalated: row.escalated,
    escalationReason: row.escalation_reason ?? "",
    reviewedOn: row.reviewed_on ?? "",
    nextReviewOn: row.next_review_on ?? "",
  };
}

function mapSuspension(
  row: operatorOrganizationsContract.RetentionSuspension,
): RetentionSuspension {
  return {
    id: row.id,
    belegType: row.beleg_type,
    belegId: row.beleg_id || null,
    reason: row.reason,
    scope: row.scope,
    responsible: row.responsible,
    reviewOn: row.review_on ?? "",
  };
}

export const belegRetentionService = {
  async getOverview(orgId: string): Promise<BelegRetentionOverview> {
    return mapBelegRetentionOverview(
      await bffJson(
        "platform",
        "GET /operator/organizations/{id}/beleg-retention",
        { params: { id: orgId } },
      ),
    );
  },
  async recordInstruction(
    orgId: string,
    data: RecordInstructionRequest,
  ): Promise<void> {
    await bffJson(
      "platform",
      "POST /operator/organizations/{id}/beleg-retention/instructions",
      { params: { id: orgId }, body: data },
    );
  },
  async recordSuspension(
    orgId: string,
    data: RecordSuspensionRequest,
  ): Promise<void> {
    await bffJson(
      "platform",
      "POST /operator/organizations/{id}/beleg-retention/suspensions",
      { params: { id: orgId }, body: data },
    );
  },
  async recordClarificationReview(
    orgId: string,
    data: RecordClarificationReviewRequest,
  ): Promise<void> {
    await bffJson(
      "platform",
      "POST /operator/organizations/{id}/beleg-retention/clarification-reviews",
      { params: { id: orgId }, body: data },
    );
  },
  async liftSuspension(orgId: string, suspensionId: string): Promise<void> {
    await bffJson(
      "platform",
      "DELETE /operator/organizations/{id}/beleg-retention/suspensions/{suspensionId}",
      { params: { id: orgId, suspensionId } },
    );
  },
};
