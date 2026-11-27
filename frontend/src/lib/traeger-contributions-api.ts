import type { z } from "zod";
import { bffJson } from "~/lib/bff-fetch";
/**
 * Client of the Elternabrechnung in the Träger portal (#4664): the
 * contribution rules of the Träger, the holiday contribution of a
 * registration and its confirmation, which freezes the contribution. Money
 * stays whole cent, shares stay basis points (10000 = 100 %). Backend int64
 * IDs leave here as strings.
 */

import type * as traegerHolidayContributionsContract from "./contract/traeger-holiday-contributions.generated";
import {
  contributionFromBackend,
  type HolidayContribution,
} from "./holiday-contribution";
import { ApiError, wireErrorCode } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import { FamilyDebtorNumberDetailsSchema } from "./contract/problem-details.generated";
import { requiredDay } from "./contract/required-day";
import type * as sharedContract from "./contract/shared.generated";
import type * as traegerContributionRulesContract from "./contract/traeger-contribution-rules.generated";
import type * as traegerCostBearersContract from "./contract/traeger-cost-bearers.generated";

// Go does not register the set; the contract types it as string.
const RULE_KIND_VALUES = ["sibling", "benefits_exemption"] as const;

export type {
  ContributionLine,
  HolidayContribution,
} from "./holiday-contribution";

export type ContributionRuleKind = (typeof RULE_KIND_VALUES)[number];

export interface ContributionRule {
  readonly id: string;
  readonly kind: ContributionRuleKind;
  /** Calendar dates "YYYY-MM-DD"; null is open. */
  readonly validFrom: string;
  readonly validUntil: string | null;
  /** Sibling rule: from which child on (2 or 3). */
  readonly siblingFromChild: number | null;
  readonly discountBasisPoints: number | null;
  readonly discountCents: number | null;
  /** Exemption: the note the contribution shows. */
  readonly note: string;
  /** The read-state token a change sends back (ADR 0311). */
  readonly version: string;
}

export type ContributionRuleInput = Omit<ContributionRule, "id" | "version">;

/** A rule of a kind this build does not know is left out of the list. */
export function rulesFromBackend(
  rules: readonly sharedContract.ContributionRule[],
): ContributionRule[] {
  return rules.flatMap((rule) => {
    const kind = knownEnum(RULE_KIND_VALUES, rule.kind);
    return kind ? [ruleFromBackend(rule, kind)] : [];
  });
}

function ruleFromBackend(
  rule: sharedContract.ContributionRule,
  kind: ContributionRuleKind,
): ContributionRule {
  return {
    id: rule.id,
    kind,
    validFrom: requiredDay(rule.valid_from, "contribution_rule.valid_from"),
    validUntil: rule.valid_until,
    siblingFromChild: rule.sibling_from_child,
    discountBasisPoints: rule.discount_basis_points,
    discountCents: rule.discount_cents,
    note: rule.note,
    version: rule.version,
  };
}

function ruleToBackend(
  rule: ContributionRuleInput,
): traegerContributionRulesContract.ContributionRuleRequest {
  return {
    service: "holiday",
    kind: rule.kind,
    valid_from: rule.validFrom,
    valid_until: rule.validUntil,
    sibling_from_child: rule.siblingFromChild,
    discount_basis_points: rule.discountBasisPoints,
    discount_cents: rule.discountCents,
    note: rule.note,
  };
}

/** The contribution rules of the Träger by kind and start. */
export async function fetchContributionRules(): Promise<ContributionRule[]> {
  const rules = await bffJson("org", "GET /traeger/contribution-rules/");
  return rulesFromBackend(rules);
}

export async function createContributionRule(
  rule: ContributionRuleInput,
): Promise<ContributionRule> {
  const saved = await bffJson("org", "POST /traeger/contribution-rules/", {
    body: ruleToBackend(rule),
  });
  return ruleFromBackend(saved, rule.kind);
}

/** Changes a rule from the `version` it was read at (ADR 0311). */
export async function updateContributionRule(
  id: string,
  rule: ContributionRuleInput,
  version: string,
): Promise<ContributionRule> {
  const saved = await bffJson("org", "PUT /traeger/contribution-rules/{id}", {
    params: { id },
    body: { ...ruleToBackend(rule), expected_version: version },
  });
  return ruleFromBackend(saved, rule.kind);
}

export async function deleteContributionRule(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/contribution-rules/{id}", {
    params: { id },
  });
}

/**
 * A body that pays the contribution of a family in its place (#5627). One
 * that a frozen contribution or an invoice names is in use and can only be
 * switched off.
 */
export interface CostBearer {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly fileReference: string;
  readonly active: boolean;
  readonly inUse: boolean;
  /** The read-state token a change sends back (ADR 0311). */
  readonly version: string;
}

export type CostBearerInput = Omit<CostBearer, "id" | "inUse" | "version">;

function costBearerFromBackend(bearer: sharedContract.CostBearer): CostBearer {
  return {
    id: bearer.id,
    name: bearer.name,
    address: bearer.address,
    fileReference: bearer.file_reference,
    active: bearer.active,
    inUse: bearer.in_use,
    version: bearer.version,
  };
}

/** The cost bearers of the Träger by name. */
export async function fetchCostBearers(): Promise<CostBearer[]> {
  return mapCostBearers(await bffJson("org", "GET /traeger/cost-bearers/"));
}

export function mapCostBearers(
  bearers: z.output<
    (typeof traegerCostBearersContract.routes)["GET /traeger/cost-bearers/"]["response"]
  >["data"],
): CostBearer[] {
  return bearers.map(costBearerFromBackend);
}

function costBearerBody(
  bearer: CostBearerInput,
): traegerCostBearersContract.CostBearerRequest {
  return {
    name: bearer.name,
    address: bearer.address,
    file_reference: bearer.fileReference,
    active: bearer.active,
  };
}

/**
 * Creates a cost bearer, or changes the one id names from the `version` it
 * was read at (ADR 0311).
 */
export async function saveCostBearer(
  id: string | null,
  bearer: CostBearerInput,
  version = "",
): Promise<CostBearer> {
  return costBearerFromBackend(
    await (id
      ? bffJson("org", "PUT /traeger/cost-bearers/{id}", {
          params: { id },
          body: { ...costBearerBody(bearer), expected_version: version },
        })
      : bffJson("org", "POST /traeger/cost-bearers/", {
          body: costBearerBody(bearer),
        })),
  );
}

export async function deleteCostBearer(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/cost-bearers/{id}", { params: { id } });
}

/**
 * The frozen contribution of a registration, or what a confirmation would
 * freeze now: with the exemption the Träger-Büro is about to choose, or the
 * parents' statement when none is given.
 */
export async function fetchHolidayContribution(
  periodId: string,
  registrationId: string,
  benefitsExemption?: boolean,
  costBearerId?: string,
): Promise<HolidayContribution> {
  return contributionFromBackend(
    await bffJson(
      "org",
      "GET /traeger/holiday-contributions/{periodId}/registrations/{registrationId}",
      {
        params: { periodId, registrationId },
        query: {
          benefits_exemption: benefitsExemption,
          cost_bearer_id: costBearerId || undefined,
        },
      },
    ),
  );
}

/**
 * What a confirmation was read on (ADR 0311): the fingerprint of the preview
 * shown and, when it sends the numbers of the children, the version of the
 * numbers shown.
 */
export interface HolidayConfirmationRead {
  readonly fingerprint: string;
  readonly childNumbersVersion?: string;
}

/**
 * Confirms the registration and freezes the contribution of the preview
 * `read` names (ADR 0311), with the debtor number of the family (#5621); an
 * empty one confirms without. A cost bearer pays instead of the family
 * (#5627). childDebtorNumbers are the numbers of the children instead, when
 * the Träger keeps one per child (#7007).
 */
export async function confirmHolidayRegistration(
  periodId: string,
  registrationId: string,
  read: HolidayConfirmationRead,
  benefitsExemption: boolean,
  debtorNumber = "",
  costBearerId?: string,
  familyDebtorNumber?: FamilyDebtorNumberChoice,
  childDebtorNumbers?: readonly HolidayChildDebtorNumberInput[],
): Promise<HolidayContribution> {
  const confirmation = await bffJson(
    "org",
    "POST /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/confirm",
    {
      params: { periodId, registrationId },
      body: {
        benefits_exemption: benefitsExemption,
        debtor_number: debtorNumber,
        ...(costBearerId ? { cost_bearer_id: costBearerId } : {}),
        ...(familyDebtorNumber
          ? { family_debtor_number: familyDebtorNumber }
          : {}),
        ...(childDebtorNumbers
          ? {
              child_debtor_numbers: childNumbersToBackend(childDebtorNumbers),
              expected_child_debtor_numbers_version:
                read.childNumbersVersion ?? "",
            }
          : {}),
        expected_fingerprint: read.fingerprint,
      },
    },
  );
  return contributionFromBackend(confirmation.contribution);
}

/**
 * Cancels the registration (#5662). In a sibling group the Elternabrechnung
 * takes it out of the group and computes the contribution of the other
 * registrations again; the caller reads the registration again.
 */
export async function cancelHolidayRegistration(
  periodId: string,
  registrationId: string,
): Promise<void> {
  await bffJson(
    "org",
    "POST /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/cancel",
    { params: { periodId, registrationId } },
  );
}

/**
 * Changes the debtor number of a confirmed registration until an invoice
 * bills it (#5621); returns the number the registration now has.
 */
export async function changeHolidayDebtorNumber(
  periodId: string,
  registrationId: string,
  debtorNumber: string,
  familyDebtorNumber?: FamilyDebtorNumberChoice,
): Promise<string> {
  const changed = await bffJson(
    "org",
    "PUT /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/debtor-number",
    {
      params: { periodId, registrationId },
      body: {
        debtor_number: debtorNumber,
        ...(familyDebtorNumber
          ? { family_debtor_number: familyDebtorNumber }
          : {}),
      } satisfies traegerHolidayContributionsContract.HolidayDebtorNumberRequest,
    },
  );
  return changed.debtor_number;
}

/** Who pays the contribution of a registration (#5627, #8158). */
export type HolidayPayerKind = "family" | "exemption" | "cost_bearer";

const PAYER_KIND_VALUES = [
  "family",
  "exemption",
  "cost_bearer",
] as const satisfies readonly HolidayPayerKind[];

/** A payer the Träger-Büro chooses; `costBearerId` only with a cost bearer. */
export interface HolidayPayerChoice {
  readonly kind: HolidayPayerKind;
  readonly costBearerId: string | null;
}

/** Who pays, with the copied name of a cost bearer ("" otherwise). */
interface HolidayPayer extends HolidayPayerChoice {
  readonly costBearerName: string;
}

/** What a payer change does to one child, in whole cent. */
interface HolidayPayerChildEffect {
  readonly childId: string;
  readonly position: number;
  readonly familyBeforeCents: number;
  readonly familyAfterCents: number;
  readonly costBearerBeforeCents: number;
  readonly costBearerAfterCents: number;
}

/**
 * What a change of the payer of a confirmed registration would freeze
 * (#8158), before the Träger-Büro saves it.
 */
export interface HolidayPayerPreview {
  readonly current: HolidayPayer;
  readonly chosen: HolidayPayer;
  readonly changed: boolean;
  readonly children: readonly HolidayPayerChildEffect[];
  /** The Träger has a valid exemption rule. */
  readonly exemptionAvailable: boolean;
  /** An issued invoice bills the registration; it keeps its amounts. */
  readonly invoiced: boolean;
  /** The token the save sends back (ADR 0311). */
  readonly fingerprint: string;
}

function payerFromBackend(
  payer: traegerHolidayContributionsContract.HolidayPayer,
): HolidayPayer {
  return {
    // A kind this build does not know reads as the family: the amounts of
    // the preview still say what changes.
    kind: knownEnum(PAYER_KIND_VALUES, payer.kind) ?? "family",
    costBearerId: payer.cost_bearer_id,
    costBearerName: payer.cost_bearer_name,
  };
}

function payerQuery(choice: HolidayPayerChoice) {
  return {
    benefits_exemption: choice.kind === "exemption" ? true : undefined,
    cost_bearer_id:
      choice.kind === "cost_bearer"
        ? (choice.costBearerId ?? undefined)
        : undefined,
  };
}

/**
 * Previews the change of the payer of a confirmed registration to `choice`
 * (#8158): the amounts per child before and after. Stores nothing.
 */
export async function fetchHolidayPayerChange(
  periodId: string,
  registrationId: string,
  choice: HolidayPayerChoice,
): Promise<HolidayPayerPreview> {
  const preview = await bffJson(
    "org",
    "GET /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/payer",
    { params: { periodId, registrationId }, query: payerQuery(choice) },
  );
  return {
    current: payerFromBackend(preview.current),
    chosen: payerFromBackend(preview.chosen),
    changed: preview.changed,
    children: (preview.children ?? []).map((child) => ({
      childId: child.child_id,
      position: child.position,
      familyBeforeCents: child.family_before_cents,
      familyAfterCents: child.family_after_cents,
      costBearerBeforeCents: child.cost_bearer_before_cents,
      costBearerAfterCents: child.cost_bearer_after_cents,
    })),
    exemptionAvailable: preview.exemption_available,
    invoiced: preview.invoiced,
    fingerprint: preview.fingerprint,
  };
}

/**
 * Saves the payer of a confirmed registration from the preview `fingerprint`
 * names (ADR 0311), with the reason for the history (#8158). Answers the
 * contribution as it is frozen now.
 */
export async function changeHolidayPayer(
  periodId: string,
  registrationId: string,
  choice: HolidayPayerChoice,
  reason: string,
  fingerprint: string,
): Promise<HolidayContribution> {
  const query = payerQuery(choice);
  return contributionFromBackend(
    await bffJson(
      "org",
      "PUT /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/payer",
      {
        params: { periodId, registrationId },
        body: {
          benefits_exemption: query.benefits_exemption ?? false,
          ...(query.cost_bearer_id
            ? { cost_bearer_id: query.cost_bearer_id }
            : {}),
          reason,
          expected_fingerprint: fingerprint,
        } satisfies traegerHolidayContributionsContract.HolidayPayerRequest,
      },
    ),
  );
}

/**
 * Which number applies when the number entered at a registration differs
 * from the one the family has (#6692): "replace" makes it the family's,
 * "keep" gives it to this registration only.
 */
export type FamilyDebtorNumberChoice = "keep" | "replace";

/** A child of a registration with its debtor number (#7007). */
export interface HolidayChildDebtorNumber {
  readonly childId: string;
  readonly firstName: string;
  readonly lastName: string;
  /** "" without a number. */
  readonly debtorNumber: string;
}

/** The number the office enters for a child; "" removes it (#7007). */
export interface HolidayChildDebtorNumberInput {
  readonly childId: string;
  readonly debtorNumber: string;
}

/**
 * The debtor numbers the confirmation proposes: the family's (#6692), or,
 * when the Träger keeps the number per child, each child's (#7007); then
 * `debtorNumber` is the first child's. `children` is empty with a number per
 * payer.
 */
export interface HolidayFamilyDebtorNumbers {
  readonly debtorNumber: string;
  readonly children: readonly HolidayChildDebtorNumber[];
  /**
   * The token of the children's numbers (ADR 0311) a change of them and a
   * confirmation that sends them send back; "" with a number per payer.
   */
  readonly version: string;
}

function childNumberFromBackend(
  child: traegerHolidayContributionsContract.HolidayChildDebtorNumber,
): HolidayChildDebtorNumber {
  return {
    childId: child.child_id,
    firstName: child.first_name,
    lastName: child.last_name,
    debtorNumber: child.debtor_number,
  };
}

function childNumbersToBackend(
  numbers: readonly HolidayChildDebtorNumberInput[],
): NonNullable<
  traegerHolidayContributionsContract.HolidayChildDebtorNumbersRequest["children"]
> {
  return numbers.map((number) => ({
    child_id: number.childId,
    debtor_number: number.debtorNumber,
  }));
}

/**
 * The debtor numbers the family of the registration and its children
 * already have at the Träger, which the confirmation proposes.
 */
export async function fetchHolidayFamilyDebtorNumber(
  periodId: string,
  registrationId: string,
): Promise<HolidayFamilyDebtorNumbers> {
  const family = await bffJson(
    "org",
    "GET /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/family-debtor-number",
    { params: { periodId, registrationId } },
  );
  return {
    debtorNumber: family.debtor_number,
    children: (family.children ?? []).map(childNumberFromBackend),
    version: family.version ?? "",
  };
}

/** The answer of a change of the children's numbers. */
export interface SavedHolidayChildDebtorNumbers {
  /** The children named, with their numbers now. */
  readonly children: readonly HolidayChildDebtorNumber[];
  /** The version of the numbers now stored, for the next change. */
  readonly version: string;
}

/**
 * Changes the debtor numbers of the children of a confirmed registration
 * (#7007) from the `version` they were read at (ADR 0311).
 */
export async function setHolidayChildDebtorNumbers(
  periodId: string,
  registrationId: string,
  numbers: readonly HolidayChildDebtorNumberInput[],
  version: string,
): Promise<SavedHolidayChildDebtorNumbers> {
  const saved = await bffJson(
    "org",
    "PUT /traeger/holiday-contributions/{periodId}/registrations/{registrationId}/child-debtor-numbers",
    {
      params: { periodId, registrationId },
      body: {
        children: childNumbersToBackend(numbers),
        expected_version: version,
      } satisfies traegerHolidayContributionsContract.HolidayChildDebtorNumbersRequest,
    },
  );
  return {
    children: (saved.children ?? []).map(childNumberFromBackend),
    version: saved.version ?? "",
  };
}

/** Both numbers of a refusal because the family has another number. */
export interface FamilyDebtorNumberConflict {
  readonly families: readonly { familyEmail: string; familyNumber: string }[];
  readonly familyNumber: string;
  readonly enteredNumber: string;
  /**
   * The family whose number differs: the registration's or, in a sibling
   * group, a sibling's; "" when the backend names none.
   */
  readonly familyEmail: string;
}

/**
 * Reads the refusal "the family has another number" (#6692); null for any
 * other failure.
 */
export function familyDebtorNumberConflictOf(
  error: unknown,
): FamilyDebtorNumberConflict | null {
  if (
    !(error instanceof ApiError) ||
    wireErrorCode(error.code) !== "parent_billing.family_debtor_number_conflict"
  ) {
    return null;
  }
  const parsed = FamilyDebtorNumberDetailsSchema.safeParse(error.details);
  if (!parsed.success) return null;
  const {
    family_debtor_number: familyNumber,
    debtor_number: enteredNumber,
    family_email: familyEmail,
  } = parsed.data;
  const families = parsed.data.families?.map((family) => ({
    familyEmail: family.family_email,
    familyNumber: family.family_debtor_number,
  })) ?? [{ familyEmail, familyNumber }];
  return {
    families,
    familyNumber,
    enteredNumber,
    familyEmail,
  };
}
