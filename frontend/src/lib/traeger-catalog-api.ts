/**
 * Anmeldephasen und Betreuungsangebote des Trägers (#4704, ADR 0195).
 *
 * Das Träger-Büro pflegt eine Trägerphase mit ihren Trägerangeboten einmal.
 * Eine Vorschau zeigt je Schule, was das Übertragen ändert; erst „Freigeben
 * und übertragen“ legt die Kopie in jeder Schule an oder gleicht sie ab.
 * Ein Feld, das die Schule geändert hat, behält ihren Wert.
 */

import type {
  CareOfferingSelectionMode,
  PhaseAudience,
  PhaseCareOverflowMode,
  PhaseKind,
} from "./enrollment-phase-api";
import type { CareSelectionRule, DaysOfWeekMode } from "./care-offering-api";
import { knownEnum, requiredEnum } from "./contract/known-enum";
import type {
  TraegerFieldChange as FieldChangeWire,
  OfferingRequest,
  TraegerOfferingDraft as OfferingDraftWire,
  TraegerOfferingFields as OfferingFieldsWire,
  TraegerOffering as OfferingWire,
  PhaseDetail,
  PhaseRequest,
  TraegerPhaseFields as PhaseFieldsWire,
  TraegerPhase as PhaseWire,
  Preview,
  Rollout,
  RolloutRequest,
} from "./contract/traeger-catalog.generated";
import { CARE_WEEKDAYS, type CareWeekday } from "./traeger-care-billing-api";
import {
  type ContractTerms,
  termsFromBackend,
  termsToBackend,
} from "./traeger-care-contracts-api";
import { traegerRequest } from "./traeger-api";

/** Das letzte Ergebnis des Übertragens an eine Schule. */
export type TraegerCatalogOutcome =
  "applied" | "rejected" | "stale" | "withdrawn";

/** Was das Übertragen an einer Schule tut. */
export type TraegerCatalogAction = "create" | "update" | "withdraw";

/**
 * Ein Feld in der Vorschau: neu, ändert sich, bleibt wie die Schule es
 * geändert hat, oder bleibt gleich.
 */
type TraegerFieldState = "new" | "changes" | "keeps" | "unchanged";

/** Whether a school can take the plan over. */
type TraegerPlanOutcome = "ready" | "rejected";

export interface TraegerPhaseFields {
  /** Go reads a missing flag as active; false keeps the draft switched off. */
  readonly isActive?: boolean | undefined;
  readonly name: string;
  readonly kind: PhaseKind;
  /** YYYY-MM-DD */
  readonly serviceStartDate: string;
  /** YYYY-MM-DD */
  readonly serviceEndDate: string;
  /** RFC 3339 instant or null. */
  readonly enrollmentOpenAt: string | null;
  readonly enrollmentCloseAt: string | null;
  readonly audience: PhaseAudience;
  readonly careOverflowMode: PhaseCareOverflowMode;
  readonly careOfferingSelectionMode: CareOfferingSelectionMode;
}

export interface TraegerPhaseInput extends TraegerPhaseFields {
  /** Alle Schulen des Trägers, auch später hinzukommende. */
  readonly allSchools: boolean;
  /** Die gewählten Schulen; leer, wenn `allSchools` gilt. */
  readonly schoolIds: readonly string[];
}

export interface TraegerCatalogSchool {
  readonly schoolId: string;
  /** Gehört zur Auswahl der Phase. */
  readonly selected: boolean;
  readonly appliedVersion: number | null;
  /** null: not rolled out yet; undefined: a value this build does not know. */
  readonly outcome: TraegerCatalogOutcome | null | undefined;
  readonly errorCode: string | null;
  readonly recordedAt: string | null;
}

export interface TraegerOfferingFields {
  /** Go reads a missing flag as active; false keeps the draft switched off. */
  readonly isActive?: boolean | undefined;
  readonly name: string;
  readonly description: string | null;
  readonly daysOfWeekMode: DaysOfWeekMode;
  readonly availableDays: readonly CareWeekday[];
  readonly includesHolidayCare: boolean;
  readonly includesLunch: boolean;
  readonly capacity: number | null;
  /** Preis im Anmeldeformular, nur zur Anzeige. */
  readonly priceCents: number | null;
  readonly isRequired: boolean;
  readonly countsAsCare: boolean;
  readonly selectionGroup: string;
  readonly selectionRule: CareSelectionRule;
  readonly sortOrder: number;
  /** Gehzeit je Wochentag, "HH:MM". */
  readonly pickupTimes: Readonly<Partial<Record<CareWeekday, string>>>;
}

/** Ein Preis: je Wochentag oder je Zahl der Tage in der Woche. */
export interface TraegerCarePrice {
  readonly weekday: CareWeekday | null;
  readonly daysPerWeek: number | null;
  readonly monthlyCents: number;
  /** Endpreis für jedes weitere Kind; null = derselbe Preis. */
  readonly siblingCents: number | null;
  readonly mealExtra: boolean;
}

export interface TraegerOfferingDraft {
  readonly fields: TraegerOfferingFields;
  readonly prices: readonly TraegerCarePrice[];
  readonly contractTemplate: ContractTerms | null;
}

interface TraegerOfferingSchool {
  readonly schoolId: string;
  readonly appliedVersion: number | null;
  readonly outcome: TraegerCatalogOutcome | null | undefined;
  readonly errorCode: string | null;
}

export interface TraegerOffering {
  readonly id: string;
  readonly traegerPhaseId: string;
  readonly draft: TraegerOfferingDraft;
  readonly releasedVersion: number | null;
  readonly released: TraegerOfferingDraft | null;
  readonly withdrawnAt: string | null;
  readonly schools: readonly TraegerOfferingSchool[];
}

export interface TraegerPhase {
  readonly id: string;
  readonly draft: TraegerPhaseFields;
  readonly allSchools: boolean;
  readonly releasedVersion: number | null;
  readonly released: TraegerPhaseFields | null;
  readonly withdrawnAt: string | null;
  readonly schools: readonly TraegerCatalogSchool[];
  readonly updatedAt: string;
}

export interface TraegerPhaseDetail extends TraegerPhase {
  readonly offerings: readonly TraegerOffering[];
}

export interface TraegerFieldChange {
  /** Spalte der Kopie, etwa "name" oder "is_active". */
  readonly field: string;
  /** undefined: a state this build does not know; the preview hides it. */
  readonly state: TraegerFieldState | undefined;
  readonly traeger: unknown;
  readonly school: unknown;
}

export interface TraegerOfferingPlan {
  readonly traegerOfferingId: string;
  readonly name: string;
  readonly action: TraegerCatalogAction | undefined;
  readonly fields: readonly TraegerFieldChange[];
  /** Ab diesem Tag (Monatsbeginn) gelten neue Preise; null = keine neuen. */
  readonly pricesFrom: string | null;
  /** Das Übertragen schreibt die Vertragsvorlage der Schule. */
  readonly contractTemplate: boolean;
}

export interface TraegerSchoolPlan {
  readonly schoolId: string;
  readonly action: TraegerCatalogAction | undefined;
  /** undefined: unknown, so neither ready nor refused. */
  readonly outcome: TraegerPlanOutcome | undefined;
  readonly errorCode: string | null;
  readonly phase: readonly TraegerFieldChange[];
  readonly offerings: readonly TraegerOfferingPlan[];
  /** Kinder, deren Betreuung länger läuft als die gekürzte Phase (#6813). */
  readonly careBeyondEnd: number;
}

export interface TraegerCatalogPreview {
  readonly traegerPhaseId: string;
  readonly version: number;
  readonly fingerprint: string;
  readonly schools: readonly TraegerSchoolPlan[];
}

interface TraegerRolloutSchool {
  readonly schoolId: string;
  readonly outcome: TraegerCatalogOutcome | undefined;
  readonly errorCode: string | null;
  readonly careBeyondEnd: number;
}

export interface TraegerRollout {
  readonly traegerPhaseId: string;
  readonly version: number;
  readonly schools: readonly TraegerRolloutSchool[];
}

// --- Mapping -----------------------------------------------------------------

/** The values of a union, checked complete by the record's keys. */
function valuesOf<T extends string>(record: Record<T, true>): readonly T[] {
  return Object.keys(record) as T[];
}

const PHASE_KINDS = valuesOf<PhaseKind>({
  school_year: true,
  holiday: true,
  custom: true,
});
const AUDIENCES = valuesOf<PhaseAudience>({
  open: true,
  new_students: true,
  existing_students: true,
  linked_parents: true,
});
const OVERFLOW_MODES = valuesOf<PhaseCareOverflowMode>({
  waitlist: true,
  reject: true,
  allow: true,
});
const PHASE_SELECTION_MODES = valuesOf<CareOfferingSelectionMode>({
  optional: true,
  at_least_one: true,
  exactly_one: true,
});
const DAYS_OF_WEEK_MODES = valuesOf<DaysOfWeekMode>({
  fixed: true,
  parent_choice: true,
});
const SELECTION_RULES = valuesOf<CareSelectionRule>({
  optional: true,
  exactly_one: true,
  at_least_one: true,
  at_most_one: true,
  at_most_one_per_day: true,
});
const OUTCOMES = valuesOf<TraegerCatalogOutcome>({
  applied: true,
  rejected: true,
  stale: true,
  withdrawn: true,
});
const ACTIONS = valuesOf<TraegerCatalogAction>({
  create: true,
  update: true,
  withdraw: true,
});
const PLAN_OUTCOMES = valuesOf<TraegerPlanOutcome>({
  ready: true,
  rejected: true,
});
const FIELD_STATES = valuesOf<TraegerFieldState>({
  new: true,
  changes: true,
  keeps: true,
  unchanged: true,
});

/** No outcome yet is null; one this build does not know is undefined. */
function outcomeOf(
  value: string | undefined,
): TraegerCatalogOutcome | null | undefined {
  return value ? knownEnum(OUTCOMES, value) : null;
}

/**
 * The editor saves a draft back whole, so a draft with a value this build
 * does not know fails the read instead of saving a guess (#2353). Go writes
 * every one of these fields normalized, never empty.
 */
function phaseFieldsFromBackend(
  fields: PhaseFieldsWire,
  at: string,
): TraegerPhaseFields {
  return {
    isActive: fields.is_active,
    name: fields.name,
    kind: requiredEnum(PHASE_KINDS, fields.kind, `${at}.kind`),
    serviceStartDate: fields.service_start_date,
    serviceEndDate: fields.service_end_date,
    enrollmentOpenAt: fields.enrollment_open_at,
    enrollmentCloseAt: fields.enrollment_close_at,
    audience: requiredEnum(AUDIENCES, fields.audience, `${at}.audience`),
    careOverflowMode: requiredEnum(
      OVERFLOW_MODES,
      fields.care_overflow_mode,
      `${at}.care_overflow_mode`,
    ),
    careOfferingSelectionMode: requiredEnum(
      PHASE_SELECTION_MODES,
      fields.care_offering_selection_mode,
      `${at}.care_offering_selection_mode`,
    ),
  };
}

function weekdayOf(value: string, field: string): CareWeekday {
  return requiredEnum(CARE_WEEKDAYS, value, field);
}

function offeringFieldsFromBackend(
  fields: OfferingFieldsWire,
  at: string,
): TraegerOfferingFields {
  const pickupTimes: Partial<Record<CareWeekday, string>> = {};
  for (const [day, time] of Object.entries(fields.pickup_times ?? {})) {
    pickupTimes[weekdayOf(day, `${at}.pickup_times`)] = time;
  }
  return {
    isActive: fields.is_active,
    name: fields.name,
    description: fields.description,
    daysOfWeekMode: requiredEnum(
      DAYS_OF_WEEK_MODES,
      fields.days_of_week_mode,
      `${at}.days_of_week_mode`,
    ),
    availableDays: (fields.available_days ?? []).map((day) =>
      weekdayOf(day, `${at}.available_days`),
    ),
    includesHolidayCare: fields.includes_holiday_care,
    includesLunch: fields.includes_lunch,
    capacity: fields.capacity,
    priceCents: fields.price_cents,
    isRequired: fields.is_required,
    countsAsCare: fields.counts_as_care,
    selectionGroup: fields.selection_group,
    selectionRule: requiredEnum(
      SELECTION_RULES,
      fields.selection_rule,
      `${at}.selection_rule`,
    ),
    sortOrder: fields.sort_order,
    pickupTimes,
  };
}

function offeringDraftFromBackend(
  draft: OfferingDraftWire,
  at: string,
): TraegerOfferingDraft {
  return {
    fields: offeringFieldsFromBackend(draft.fields, `${at}.fields`),
    prices: (draft.prices ?? []).map((price) => ({
      weekday: price.weekday
        ? weekdayOf(price.weekday, `${at}.prices.weekday`)
        : null,
      daysPerWeek: price.days_per_week ?? null,
      monthlyCents: price.monthly_cents,
      siblingCents: price.sibling_cents ?? null,
      mealExtra: price.meal_extra,
    })),
    contractTemplate: draft.contract_template
      ? termsFromBackend(draft.contract_template)
      : null,
  };
}

function offeringFromBackend(offering: OfferingWire): TraegerOffering {
  return {
    id: offering.id,
    traegerPhaseId: offering.traeger_phase_id,
    draft: offeringDraftFromBackend(offering.draft, "traeger_offering.draft"),
    releasedVersion: offering.released_version ?? null,
    released: offering.released
      ? offeringDraftFromBackend(offering.released, "traeger_offering.released")
      : null,
    withdrawnAt: offering.withdrawn_at ?? null,
    schools: (offering.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      appliedVersion: school.applied_version ?? null,
      outcome: outcomeOf(school.outcome),
      errorCode: school.error_code || null,
    })),
  };
}

function phaseFromBackend(phase: PhaseWire): TraegerPhase {
  return {
    id: phase.id,
    draft: phaseFieldsFromBackend(phase.draft, "traeger_phase.draft"),
    allSchools: phase.all_schools,
    releasedVersion: phase.released_version ?? null,
    released: phase.released
      ? phaseFieldsFromBackend(phase.released, "traeger_phase.released")
      : null,
    withdrawnAt: phase.withdrawn_at ?? null,
    schools: (phase.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      selected: school.selected,
      appliedVersion: school.applied_version ?? null,
      outcome: outcomeOf(school.outcome),
      errorCode: school.error_code || null,
      recordedAt: school.recorded_at ?? null,
    })),
    updatedAt: phase.updated_at,
  };
}

function phaseDetailFromBackend(phase: PhaseDetail): TraegerPhaseDetail {
  return {
    ...phaseFromBackend(phase),
    offerings: (phase.offerings ?? []).map(offeringFromBackend),
  };
}

// The preview only shows: an unknown state is left undefined and hidden.
function fieldChangesFromBackend(
  changes: readonly FieldChangeWire[] | null,
): TraegerFieldChange[] {
  return (changes ?? []).map((change) => ({
    field: change.field,
    state: knownEnum(FIELD_STATES, change.state),
    traeger: change.traeger,
    school: change.school,
  }));
}

/** The body the backend reads; IDs travel as numbers. */
function phaseInputToBackend(input: TraegerPhaseInput): PhaseRequest {
  return {
    // Go reads a missing flag as active: a deactivated draft stays so.
    is_active: input.isActive ?? null,
    name: input.name.trim(),
    kind: input.kind,
    service_start_date: input.serviceStartDate,
    service_end_date: input.serviceEndDate,
    enrollment_open_at: input.enrollmentOpenAt,
    enrollment_close_at: input.enrollmentCloseAt,
    audience: input.audience,
    care_overflow_mode: input.careOverflowMode,
    care_offering_selection_mode: input.careOfferingSelectionMode,
    all_schools: input.allSchools,
    school_ids: input.allSchools ? [] : input.schoolIds.map(Number),
  } satisfies PhaseRequest;
}

function offeringDraftToBackend(draft: TraegerOfferingDraft): OfferingRequest {
  const { fields } = draft;
  return {
    fields: {
      is_active: fields.isActive ?? null,
      name: fields.name.trim(),
      description: fields.description?.trim()
        ? fields.description.trim()
        : null,
      days_of_week_mode: fields.daysOfWeekMode,
      available_days: [...fields.availableDays],
      includes_holiday_care: fields.includesHolidayCare,
      includes_lunch: fields.includesLunch,
      capacity: fields.capacity,
      price_cents: fields.priceCents,
      is_required: fields.isRequired,
      counts_as_care: fields.countsAsCare,
      selection_group: fields.selectionGroup.trim(),
      selection_rule: fields.selectionRule,
      sort_order: fields.sortOrder,
      pickup_times: { ...fields.pickupTimes },
    },
    prices: draft.prices.map((price) => ({
      ...(price.weekday === null
        ? { days_per_week: price.daysPerWeek }
        : { weekday: price.weekday }),
      monthly_cents: price.monthlyCents,
      ...(price.siblingCents === null
        ? {}
        : { sibling_cents: price.siblingCents }),
      meal_extra: price.mealExtra,
    })),
    ...(draft.contractTemplate
      ? { contract_template: termsToBackend(draft.contractTemplate) }
      : {}),
  } satisfies OfferingRequest;
}

// --- Requests ----------------------------------------------------------------

const BASE = "/api/traeger/catalog";

function phasePath(id: string): string {
  return `${BASE}/phases/${encodeURIComponent(id)}`;
}

export async function fetchTraegerPhases(): Promise<TraegerPhase[]> {
  const phases = await traegerRequest<PhaseWire[]>(`${BASE}/phases`);
  return phases.map(phaseFromBackend);
}

export async function fetchTraegerPhase(
  id: string,
): Promise<TraegerPhaseDetail> {
  return phaseDetailFromBackend(
    await traegerRequest<PhaseDetail>(phasePath(id)),
  );
}

export async function createTraegerPhase(
  input: TraegerPhaseInput,
): Promise<TraegerPhaseDetail> {
  return phaseDetailFromBackend(
    await traegerRequest<PhaseDetail>(`${BASE}/phases`, {
      method: "POST",
      body: phaseInputToBackend(input),
    }),
  );
}

export async function updateTraegerPhase(
  id: string,
  input: TraegerPhaseInput,
): Promise<TraegerPhaseDetail> {
  return phaseDetailFromBackend(
    await traegerRequest<PhaseDetail>(phasePath(id), {
      method: "PUT",
      body: phaseInputToBackend(input),
    }),
  );
}

export async function withdrawTraegerPhase(
  id: string,
): Promise<TraegerPhaseDetail> {
  return phaseDetailFromBackend(
    await traegerRequest<PhaseDetail>(`${phasePath(id)}/withdraw`, {
      method: "POST",
    }),
  );
}

export async function createTraegerOffering(
  phaseId: string,
  draft: TraegerOfferingDraft,
): Promise<TraegerOffering> {
  return offeringFromBackend(
    await traegerRequest<OfferingWire>(`${phasePath(phaseId)}/offerings`, {
      method: "POST",
      body: offeringDraftToBackend(draft),
    }),
  );
}

export async function updateTraegerOffering(
  id: string,
  draft: TraegerOfferingDraft,
): Promise<TraegerOffering> {
  return offeringFromBackend(
    await traegerRequest<OfferingWire>(
      `${BASE}/offerings/${encodeURIComponent(id)}`,
      { method: "PUT", body: offeringDraftToBackend(draft) },
    ),
  );
}

export async function withdrawTraegerOffering(
  id: string,
): Promise<TraegerOffering> {
  return offeringFromBackend(
    await traegerRequest<OfferingWire>(
      `${BASE}/offerings/${encodeURIComponent(id)}/withdraw`,
      { method: "POST" },
    ),
  );
}

export async function previewTraegerPhase(
  id: string,
): Promise<TraegerCatalogPreview> {
  const preview = await traegerRequest<Preview>(`${phasePath(id)}/preview`, {
    method: "POST",
  });
  return {
    traegerPhaseId: preview.traeger_phase_id,
    version: preview.version,
    fingerprint: preview.fingerprint,
    schools: (preview.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      action: knownEnum(ACTIONS, school.action),
      outcome: knownEnum(PLAN_OUTCOMES, school.outcome),
      errorCode: school.error_code || null,
      careBeyondEnd: school.care_beyond_end,
      phase: fieldChangesFromBackend(school.phase),
      offerings: (school.offerings ?? []).map((offering) => ({
        traegerOfferingId: offering.traeger_offering_id,
        name: offering.name,
        action: knownEnum(ACTIONS, offering.action),
        fields: fieldChangesFromBackend(offering.fields),
        pricesFrom: offering.prices_from ?? null,
        contractTemplate: offering.contract_template,
      })),
    })),
  };
}

export async function rolloutTraegerPhase(
  id: string,
  fingerprint: string,
): Promise<TraegerRollout> {
  const rollout = await traegerRequest<Rollout>(`${phasePath(id)}/rollout`, {
    method: "POST",
    body: { fingerprint } satisfies RolloutRequest,
  });
  return {
    traegerPhaseId: rollout.traeger_phase_id,
    version: rollout.version,
    schools: (rollout.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      outcome: knownEnum(OUTCOMES, school.outcome),
      errorCode: school.error_code || null,
      careBeyondEnd: school.care_beyond_end,
    })),
  };
}
