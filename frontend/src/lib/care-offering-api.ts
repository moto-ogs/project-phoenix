import { bffJson } from "~/lib/bff-fetch";
import { requiredEnum, knownEnum } from "~/lib/contract/known-enum";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import type { Translations } from "~/lib/enrollment-translations";
import { translationsFromContract } from "~/lib/enrollment-form-schema-api";

// Go does not register these sets; the contract types them as string.
const DAYS_OF_WEEK_MODES = ["fixed", "parent_choice"] as const;
const AVAILABILITY_MATCHES = ["all", "any"] as const;
const AVAILABILITY_OPERATORS = ["in", "not_in"] as const;
const AVAILABILITY_SOURCES = ["grade_level"] as const;
const SELECTION_RULES = [
  "optional",
  "exactly_one",
  "at_least_one",
  "at_most_one",
  "at_most_one_per_day",
] as const;

export type DaysOfWeekMode = (typeof DAYS_OF_WEEK_MODES)[number];

type CareOfferingAvailabilityMatch = (typeof AVAILABILITY_MATCHES)[number];
type CareOfferingAvailabilityOperator = (typeof AVAILABILITY_OPERATORS)[number];
export interface CareOfferingAvailabilityCondition {
  source: (typeof AVAILABILITY_SOURCES)[number];
  operator: CareOfferingAvailabilityOperator;
  value: number[];
}
export interface CareOfferingAvailabilityRule {
  match: CareOfferingAvailabilityMatch;
  conditions: CareOfferingAvailabilityCondition[];
}

/**
 * How many offerings within the same selection_group a parent must pick.
 * Mirrors the backend SelectionRule* constants.
 */
export type CareSelectionRule = (typeof SELECTION_RULES)[number];

/** German labels for the selection-rule dropdown in the admin editor. */
export const SELECTION_RULE_LABELS: Record<CareSelectionRule, string> = {
  optional: "Optional (frei wählbar)",
  exactly_one: "Genau eines (Pflicht)",
  at_least_one: "Mindestens eines (Pflicht)",
  at_most_one: "Höchstens eines",
  at_most_one_per_day: "Höchstens eines pro Tag",
};

/**
 * An offering of the staff catalog: the contract's answer with its enums
 * narrowed and the lists Go may write as null read as empty lists.
 */
export type CareOffering = Omit<
  sharedContract.CareOfferingResponse,
  | "days_of_week_mode"
  | "available_days"
  | "auto_add_grade_levels"
  | "auto_add_trigger_offering_ids"
  | "availability_rule"
  | "selection_rule"
  | "translations"
> & {
  days_of_week_mode: DaysOfWeekMode;
  available_days: string[];
  auto_add_grade_levels: number[];
  auto_add_trigger_offering_ids: string[];
  availability_rule?: CareOfferingAvailabilityRule;
  /** undefined: a rule this build does not know; it reads as "optional". */
  selection_rule?: CareSelectionRule;
  /** Von der Schule gepflegte Übersetzungen von Name und Beschreibung (#3377). */
  translations?: Translations;
};

/**
 * The editor's draft of an offering: the request body with the fields the
 * editor always fills and its enums narrowed.
 */
export type CareOfferingInput = Omit<
  enrollmentContract.CareOfferingRequest,
  | "phase_id"
  | "name"
  | "days_of_week_mode"
  | "available_days"
  | "includes_holiday_care"
  | "includes_lunch"
  | "is_active"
  | "is_required"
  | "counts_as_care"
  | "auto_add_grade_levels"
  | "availability_rule"
  | "auto_add_trigger_offering_ids"
  | "sort_order"
  | "selection_rule"
  | "translations"
> & {
  phase_id: string;
  name: string;
  days_of_week_mode: DaysOfWeekMode;
  available_days: string[];
  includes_holiday_care: boolean;
  includes_lunch: boolean;
  is_active: boolean;
  is_required: boolean;
  counts_as_care: boolean;
  auto_add_grade_levels: number[];
  availability_rule?: CareOfferingAvailabilityRule | null;
  auto_add_trigger_offering_ids: string[];
  sort_order: number;
  selection_rule?: CareSelectionRule;
  /** Vollständiges Übersetzungsdokument; `{}` löscht alle Übersetzungen. */
  translations?: Translations;
};

/**
 * Reads a rule of the contract. The editor saves the rule back, so an
 * operator or source this build does not know fails the read instead of
 * saving a guess.
 */
function availabilityRuleFromContract(
  rule: sharedContract.CareOfferingAvailabilityRule,
  at: string,
): CareOfferingAvailabilityRule {
  return {
    match: requiredEnum(AVAILABILITY_MATCHES, rule.match, `${at}.match`),
    conditions: (rule.conditions ?? []).map((condition) => ({
      source: requiredEnum(
        AVAILABILITY_SOURCES,
        condition.source,
        `${at}.conditions.source`,
      ),
      operator: requiredEnum(
        AVAILABILITY_OPERATORS,
        condition.operator,
        `${at}.conditions.operator`,
      ),
      value: condition.value ?? [],
    })),
  };
}

/** Reads an offering of the contract; see `CareOffering`. */
export function careOfferingFromContract(
  offering: sharedContract.CareOfferingResponse,
): CareOffering {
  const {
    availability_rule: rule,
    selection_rule,
    translations,
    ...rest
  } = offering;
  return {
    ...rest,
    days_of_week_mode: requiredEnum(
      DAYS_OF_WEEK_MODES,
      offering.days_of_week_mode,
      "CareOffering.days_of_week_mode",
    ),
    available_days: offering.available_days ?? [],
    auto_add_grade_levels: offering.auto_add_grade_levels ?? [],
    auto_add_trigger_offering_ids: offering.auto_add_trigger_offering_ids ?? [],
    ...(rule && {
      availability_rule: availabilityRuleFromContract(
        rule,
        "CareOffering.availability_rule",
      ),
    }),
    selection_rule: knownEnum(SELECTION_RULES, selection_rule),
    ...(translations && {
      translations: translationsFromContract(translations),
    }),
  };
}

export async function listCareOfferings(
  phaseId?: string | null,
): Promise<CareOffering[]> {
  const offerings = await bffJson(
    "tenant",
    "GET /api/enrollment/care-offerings/",
    {
      query: { phase_id: phaseId || undefined },
      errorMessage: "Betreuungsangebote konnten nicht geladen werden",
    },
  );
  return offerings.map(careOfferingFromContract);
}

export async function createCareOffering(
  input: CareOfferingInput,
): Promise<CareOffering> {
  return careOfferingFromContract(
    await bffJson("tenant", "POST /api/enrollment/care-offerings/", {
      body: input,
      errorMessage: "Betreuungsangebot konnte nicht angelegt werden",
    }),
  );
}

/**
 * Saves the offering over the version its editor read (ADR 0311); the
 * server refuses another one with `general.changed_since_read`.
 */
export async function updateCareOffering(
  id: string,
  input: CareOfferingInput,
  version: string,
): Promise<CareOffering> {
  return careOfferingFromContract(
    await bffJson("tenant", "PUT /api/enrollment/care-offerings/{id}/", {
      params: { id },
      body: { ...input, expected_version: version },
      errorMessage: "Betreuungsangebot konnte nicht gespeichert werden",
    }),
  );
}

export async function deleteCareOffering(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/enrollment/care-offerings/{id}/", {
    params: { id },
    errorMessage: "Betreuungsangebot konnte nicht gelöscht werden",
  });
}

export async function cloneCareOffering(
  id: string,
  input: enrollmentContract.CloneCareOfferingRequest,
): Promise<CareOffering> {
  return careOfferingFromContract(
    await bffJson("tenant", "POST /api/enrollment/care-offerings/{id}/clone", {
      params: { id },
      body: input,
      errorMessage: "Klonen fehlgeschlagen",
    }),
  );
}
