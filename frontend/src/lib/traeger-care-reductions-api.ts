import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the rule chain of the monthly contribution (#4685): the care
 * rules of the Träger (income levels, siblings, single parents, cap) and
 * the evidences of its contracts. Money stays whole cent, shares basis
 * points (10000 = 100 %). Backend int64 IDs leave here as strings; calendar
 * dates stay "YYYY-MM-DD".
 */

import { knownEnum } from "./contract/known-enum";
import { requiredDay } from "./contract/required-day";
import type * as sharedContract from "./contract/shared.generated";
import type * as traegerCareEvidencesContract from "./contract/traeger-care-evidences.generated";
import type * as traegerCareRulesContract from "./contract/traeger-care-rules.generated";
import {
  type CareModule,
  moduleFromBackend,
  schoolFromBackend,
} from "./traeger-care-billing-api";

// Go does not register these sets; the contract types them as string.
const RULE_KIND_VALUES = [
  "income_level",
  "sibling",
  "single_parent",
  "cap",
] as const;
const EVIDENCE_KIND_VALUES = ["income_level", "single_parent"] as const;

/** Kinds of a care rule, in the order of the chain. */
export type CareRuleKind = (typeof RULE_KIND_VALUES)[number];
export type CareEvidenceKind = (typeof EVIDENCE_KIND_VALUES)[number];

export const CARE_RULE_KINDS: readonly CareRuleKind[] = RULE_KIND_VALUES;

export interface CareRule {
  readonly id: string;
  readonly kind: CareRuleKind;
  readonly name: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly schoolIds: readonly string[];
  /** Empty: every module of the schools. */
  readonly careOfferingIds: readonly string[];
  /** Empty: the schools of the rule. */
  readonly countSchoolIds: readonly string[];
  readonly siblingFromChild: number | null;
  readonly discountBasisPoints: number | null;
  readonly discountCents: number | null;
  readonly priceCents: number | null;
  readonly capCents: number | null;
  /**
   * A sibling rule charges every further child the sibling prices of the
   * price list (#6196) instead of a share, an amount or one price.
   */
  readonly tariffSiblingPrice?: boolean;
  /**
   * A sibling rule counts the children the family stated and the
   * Abrechnung confirmed, siblings without a contract included (#5918).
   */
  readonly countsFamilyChildren: boolean;
  /**
   * A sibling rule chooses by the size of the family (#7765): from
   * `siblingFromChild` counted children on, every child gets the reduction,
   * the first too. Otherwise the children from that rank on.
   */
  readonly siblingAllChildren?: boolean;
  /** The read-state token a change sends back (ADR 0311). */
  readonly version: string;
}

export type CareRuleInput = Omit<CareRule, "id" | "version">;

export interface CareRuleSet {
  readonly rules: readonly CareRule[];
  readonly schools: readonly { readonly id: string; readonly name: string }[];
  readonly modules: readonly CareModule[];
}

export interface CareEvidence {
  readonly id: string;
  readonly contractId: string;
  readonly kind: CareEvidenceKind;
  readonly ruleId: string | null;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly evidence: string;
  readonly checkedOn: string;
  /** The read-state token a change sends back (ADR 0311). */
  readonly version: string;
}

export type CareEvidenceInput = Omit<CareEvidence, "id" | "version">;

export interface CareEvidenceContract {
  readonly contractId: string;
  readonly schoolId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
  readonly evidences: readonly CareEvidence[];
}

export interface CareEvidenceSet {
  readonly contracts: readonly CareEvidenceContract[];
  readonly levels: readonly CareRule[];
}

const ids = (values: readonly string[] | null): string[] => [...(values ?? [])];

/**
 * A rule of a kind this build does not know is left out: the chain editor
 * cannot show or save it, and the backend keeps it as it is.
 */
function rulesFromBackend(
  rules: readonly sharedContract.ContributionRule[] | null,
): CareRule[] {
  return (rules ?? []).flatMap((rule) => {
    const kind = knownEnum(RULE_KIND_VALUES, rule.kind);
    return kind ? [ruleFromBackend(rule, kind)] : [];
  });
}

function ruleFromBackend(
  rule: sharedContract.ContributionRule,
  kind: CareRuleKind,
): CareRule {
  return {
    id: rule.id,
    kind,
    name: rule.name,
    validFrom: requiredDay(rule.valid_from, "care_rule.valid_from"),
    validUntil: rule.valid_until,
    schoolIds: ids(rule.school_ids),
    careOfferingIds: ids(rule.care_offering_ids),
    countSchoolIds: ids(rule.count_school_ids),
    siblingFromChild: rule.sibling_from_child,
    discountBasisPoints: rule.discount_basis_points,
    discountCents: rule.discount_cents,
    priceCents: rule.price_cents,
    capCents: rule.cap_cents,
    tariffSiblingPrice: rule.tariff_sibling_price,
    countsFamilyChildren: rule.counts_family_children,
    siblingAllChildren: rule.sibling_all_children,
    version: rule.version,
  };
}

function ruleSetFromBackend(
  body: traegerCareRulesContract.CareRuleSet,
): CareRuleSet {
  return {
    rules: rulesFromBackend(body.rules),
    schools: (body.schools ?? []).map(schoolFromBackend),
    modules: (body.modules ?? []).map(moduleFromBackend),
  };
}

/** An evidence of a kind this build does not know is left out. */
function evidencesFromBackend(
  evidences: readonly traegerCareEvidencesContract.CareEvidence[] | null,
): CareEvidence[] {
  return (evidences ?? []).flatMap((evidence) => {
    const kind = knownEnum(EVIDENCE_KIND_VALUES, evidence.kind);
    if (!kind) return [];
    return [
      {
        id: evidence.id,
        contractId: evidence.contract_id,
        kind,
        ruleId: evidence.rule_id,
        validFrom: requiredDay(evidence.valid_from, "care_evidence.valid_from"),
        validUntil: evidence.valid_until,
        evidence: evidence.evidence,
        checkedOn: requiredDay(evidence.checked_on, "care_evidence.checked_on"),
        version: evidence.version,
      },
    ];
  });
}

function evidenceSetFromBackend(
  body: traegerCareEvidencesContract.CareEvidenceSet,
): CareEvidenceSet {
  return {
    contracts: (body.contracts ?? []).map((contract) => ({
      contractId: contract.contract_id,
      schoolId: contract.school_id,
      schoolName: contract.school_name,
      childFirstName: contract.child_first_name,
      childLastName: contract.child_last_name,
      evidences: evidencesFromBackend(contract.evidences),
    })),
    levels: rulesFromBackend(body.levels),
  };
}

function ruleBody(
  input: CareRuleInput,
): traegerCareRulesContract.CareRuleRequest {
  return {
    kind: input.kind,
    name: input.name,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    school_ids: [...input.schoolIds],
    care_offering_ids: [...input.careOfferingIds],
    count_school_ids: [...input.countSchoolIds],
    sibling_from_child: input.siblingFromChild,
    discount_basis_points: input.discountBasisPoints,
    discount_cents: input.discountCents,
    price_cents: input.priceCents,
    cap_cents: input.capCents,
    tariff_sibling_price: input.tariffSiblingPrice ?? false,
    counts_family_children: input.countsFamilyChildren,
    sibling_all_children: input.siblingAllChildren ?? false,
  };
}

function evidenceBody(
  input: CareEvidenceInput,
): traegerCareEvidencesContract.CareEvidenceRequest {
  return {
    contract_id: input.contractId,
    kind: input.kind,
    rule_id: input.ruleId === null ? null : input.ruleId,
    valid_from: input.validFrom,
    valid_until: input.validUntil,
    evidence: input.evidence,
    checked_on: input.checkedOn,
  };
}

export async function fetchCareRules(): Promise<CareRuleSet> {
  return ruleSetFromBackend(await bffJson("org", "GET /traeger/care-rules/"));
}

/**
 * Creates a rule without `ruleId`, changes that one otherwise, from the
 * `version` it was read at (ADR 0311).
 */
export async function saveCareRule(
  ruleId: string | null,
  input: CareRuleInput,
  version = "",
): Promise<CareRuleSet> {
  return ruleSetFromBackend(
    await (ruleId
      ? bffJson("org", "PUT /traeger/care-rules/{id}", {
          params: { id: ruleId },
          body: { ...ruleBody(input), expected_version: version },
        })
      : bffJson("org", "POST /traeger/care-rules/", { body: ruleBody(input) })),
  );
}

export async function deleteCareRule(ruleId: string): Promise<CareRuleSet> {
  return ruleSetFromBackend(
    await bffJson("org", "DELETE /traeger/care-rules/{id}", {
      params: { id: ruleId },
    }),
  );
}

/** Reads the evidences; the backend records the read per contract. */
export async function fetchCareEvidences(): Promise<CareEvidenceSet> {
  return evidenceSetFromBackend(
    await bffJson("org", "GET /traeger/care-evidences/"),
  );
}

/**
 * Creates an evidence without `evidenceId`, changes that one otherwise,
 * from the `version` it was read at (ADR 0311).
 */
export async function saveCareEvidence(
  evidenceId: string | null,
  input: CareEvidenceInput,
  version = "",
): Promise<CareEvidenceSet> {
  return evidenceSetFromBackend(
    await (evidenceId
      ? bffJson("org", "PUT /traeger/care-evidences/{id}", {
          params: { id: evidenceId },
          body: { ...evidenceBody(input), expected_version: version },
        })
      : bffJson("org", "POST /traeger/care-evidences/", {
          body: evidenceBody(input),
        })),
  );
}

export async function deleteCareEvidence(
  evidenceId: string,
): Promise<CareEvidenceSet> {
  return evidenceSetFromBackend(
    await bffJson("org", "DELETE /traeger/care-evidences/{id}", {
      params: { id: evidenceId },
    }),
  );
}
