import { bffJson } from "~/lib/bff-fetch";
import { knownEnum, requiredEnum } from "~/lib/contract/known-enum";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import { translationsFromContract } from "~/lib/enrollment-form-schema-api";
import type { Translations } from "~/lib/enrollment-translations";

// Go does not register these sets; the contract types them as string.
export const PHASE_KINDS = ["school_year", "holiday", "custom"] as const;
export const PHASE_AUDIENCES = [
  "open",
  "new_students",
  "existing_students",
  "linked_parents",
] as const;
export const SELECTION_MODES = [
  "optional",
  "at_least_one",
  "exactly_one",
] as const;
const OVERFLOW_MODES = ["waitlist", "reject", "allow"] as const;
const ROLLOVER_MODES = ["opt_in", "opt_out"] as const;
const EXPIRY_STATES = ["missing_successor", "incomplete"] as const;

export type PhaseKind = (typeof PHASE_KINDS)[number];
// Who may apply to a phase (#1663). "open" = everyone (incl. anonymous);
// "new_students" = anonymous allowed but children already enrolled at the
// school are rejected server-side; "linked_parents" = hidden from the public
// listing, only parent accounts with a guardian link + submit permission may
// apply via the parents portal.
export type PhaseAudience = (typeof PHASE_AUDIENCES)[number];
export type CareOfferingSelectionMode = (typeof SELECTION_MODES)[number];
export type PhaseCareOverflowMode = (typeof OVERFLOW_MODES)[number];
export type RolloverMode = (typeof ROLLOVER_MODES)[number];

/**
 * A phase: the contract's answer with its enums narrowed and the lists Go
 * may write as null read as empty lists. `available_school_classes` is the
 * pick list the public form offers from grade 2 (#1833); `audience`,
 * `eligible_school_classes` and `eligible_grade_levels` gate who may apply
 * (#1663, [] = no restriction). The rollover fields are set only on phases
 * the "verlängern" flow created.
 */
export type Phase = Omit<
  enrollmentContract.PhaseResponse,
  | "kind"
  | "care_overflow_mode"
  | "care_offering_selection_mode"
  | "rollover_mode"
  | "available_school_classes"
  | "audience"
  | "eligible_school_classes"
  | "eligible_grade_levels"
  | "translations"
> & {
  kind: PhaseKind;
  care_overflow_mode: PhaseCareOverflowMode;
  care_offering_selection_mode: CareOfferingSelectionMode;
  rollover_mode?: RolloverMode;
  available_school_classes: string[];
  audience: PhaseAudience;
  eligible_school_classes: string[];
  eligible_grade_levels: number[];
  /** School-written translations of `name` (#3377). */
  translations?: Translations;
};

/**
 * Reads a phase of the contract. The editor saves the whole phase back, so
 * a kind, mode or audience this build does not know fails the read instead
 * of saving a guess.
 */
export function phaseFromContract(
  phase: enrollmentContract.PhaseResponse,
): Phase {
  const { rollover_mode, translations, ...rest } = phase;
  const mode = knownEnum(ROLLOVER_MODES, rollover_mode);
  const named = translationsFromContract(translations);
  return {
    ...rest,
    kind: requiredEnum(PHASE_KINDS, phase.kind, "Phase.kind"),
    care_overflow_mode: requiredEnum(
      OVERFLOW_MODES,
      phase.care_overflow_mode,
      "Phase.care_overflow_mode",
    ),
    care_offering_selection_mode: requiredEnum(
      SELECTION_MODES,
      phase.care_offering_selection_mode,
      "Phase.care_offering_selection_mode",
    ),
    ...(mode && { rollover_mode: mode }),
    available_school_classes: phase.available_school_classes ?? [],
    audience: requiredEnum(PHASE_AUDIENCES, phase.audience, "Phase.audience"),
    eligible_school_classes: phase.eligible_school_classes ?? [],
    eligible_grade_levels: phase.eligible_grade_levels ?? [],
    ...(named && { translations: named }),
  };
}

/** A phase whose end leaves children without a confirmed successor phase. */
export type PhaseExpiryWarning = Omit<
  enrollmentContract.PhaseExpiryWarningResponse,
  "state"
> & {
  /** undefined: a state this build does not know. */
  state: (typeof EXPIRY_STATES)[number] | undefined;
};

/**
 * The editor's draft of a phase: the request body with the fields the editor
 * always fills and its enums narrowed. Omitted translations keep the stored
 * ones; `{}` clears them.
 */
export type PhaseInput = Omit<
  enrollmentContract.EnrollmentPhaseRequest,
  | "name"
  | "kind"
  | "service_start_date"
  | "service_end_date"
  | "show_status_reason_to_parent"
  | "care_overflow_mode"
  | "care_offering_selection_mode"
  | "is_active"
  | "audience"
  | "translations"
> & {
  name: string;
  kind: PhaseKind;
  service_start_date: string;
  service_end_date: string;
  show_status_reason_to_parent: boolean;
  care_overflow_mode: PhaseCareOverflowMode;
  care_offering_selection_mode: CareOfferingSelectionMode;
  is_active: boolean;
  audience?: PhaseAudience;
  translations?: Translations;
};

/**
 * Maps a Phase back to the full PUT body. The backend rebuilds the whole
 * phase from the request, so partial updates would blank fields — every
 * caller that wants to change one field must send the complete input.
 */
export function phaseToInput(p: Phase): PhaseInput {
  return {
    name: p.name,
    kind: p.kind,
    service_start_date: p.service_start_date,
    service_end_date: p.service_end_date,
    enrollment_open_at: p.enrollment_open_at ?? null,
    enrollment_close_at: p.enrollment_close_at ?? null,
    form_schema_id: p.form_schema_id ?? null,
    calendar_period_id: p.calendar_period_id ?? null,
    show_status_reason_to_parent: p.show_status_reason_to_parent,
    care_overflow_mode: p.care_overflow_mode,
    care_offering_selection_mode: p.care_offering_selection_mode,
    is_active: p.is_active,
    available_school_classes: p.available_school_classes,
    require_school_class: p.require_school_class,
    audience: p.audience,
    eligible_school_classes: p.eligible_school_classes,
    eligible_grade_levels: p.eligible_grade_levels,
    // Undefined keeps the stored translations (#3377).
    translations: p.translations,
  };
}

/**
 * Links or unlinks a phase to a calendar period (periodId null = unlink).
 * Refetches the phase first and builds the PUT body from that fresh state:
 * the endpoint replaces the whole row, so writing from a possibly stale
 * list snapshot would silently revert concurrent edits to the phase.
 */
export async function setPhaseCalendarPeriod(
  phase: Phase,
  periodId: string | null,
): Promise<Phase> {
  const fresh = await getPhase(phase.id);
  return updatePhase(
    phase.id,
    { ...phaseToInput(fresh), calendar_period_id: periodId },
    // The link goes onto the phase as just read (ADR 0311).
    fresh.version,
  );
}

export async function getPhase(id: string): Promise<Phase> {
  return phaseFromContract(
    await bffJson("tenant", "GET /api/enrollment/phases/{id}/", {
      params: { id },
      errorMessage: "Phase konnte nicht geladen werden",
    }),
  );
}

export async function listPhases(): Promise<Phase[]> {
  const phases = await bffJson("tenant", "GET /api/enrollment/phases/", {
    errorMessage: "Phasen konnten nicht geladen werden",
  });
  return phases.map(phaseFromContract);
}

export async function listPhaseExpiryWarnings(): Promise<PhaseExpiryWarning[]> {
  const warnings = await bffJson(
    "tenant",
    "GET /api/enrollment/phases/expiry-warnings",
    { errorMessage: "Hinweise zum Phasenende konnten nicht geladen werden" },
  );
  return warnings.map(mapPhaseExpiryWarning);
}

export function mapPhaseExpiryWarning(
  warning: enrollmentContract.PhaseExpiryWarningResponse,
): PhaseExpiryWarning {
  return {
    ...warning,
    state: knownEnum(EXPIRY_STATES, warning.state),
  };
}

export async function createPhase(input: PhaseInput): Promise<Phase> {
  return phaseFromContract(
    await bffJson("tenant", "POST /api/enrollment/phases/", {
      body: input,
      errorMessage: "Phase konnte nicht erstellt werden",
    }),
  );
}

/**
 * A child confirmed for the phase whose care still runs past the phase's
 * shortened end (#6598). The phase edit changed nothing about the child; the
 * school ends its care through „Betreuung beenden“.
 */
export interface CareBeyondPhaseEnd {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  /** The child's last care day as it stands (YYYY-MM-DD). */
  careEnd: string;
  /** The phase's new last day (YYYY-MM-DD). */
  phaseEnd: string;
}

/** The saved phase; `careBeyondEnd` lists the children a shortened end left in care. */
export type UpdatedPhase = Phase & { careBeyondEnd?: CareBeyondPhaseEnd[] };

/**
 * Saves the whole phase over the version its draft rests on; the backend
 * refuses a phase changed since (ADR 0311).
 */
export async function updatePhase(
  id: string,
  input: PhaseInput,
  version: string,
): Promise<UpdatedPhase> {
  const { care_beyond_end: careBeyondEnd, ...phase } = await bffJson(
    "tenant",
    "PUT /api/enrollment/phases/{id}/",
    {
      params: { id },
      body: { ...input, expected_version: version },
      errorMessage: "Phase konnte nicht gespeichert werden",
    },
  );
  return {
    ...phaseFromContract(phase),
    careBeyondEnd: (careBeyondEnd ?? []).map((child) => ({
      studentId: child.student_id,
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      careEnd: child.care_end,
      phaseEnd: child.phase_end,
    })),
  };
}

/**
 * Fetches the blast radius of deleting a phase so the confirmation modal
 * can warn the admin what will be removed vs kept: `requests` block the
 * delete (#6836); `care_offerings` are permanently deleted with the phase;
 * `students_kept` counts the children created from its requests.
 */
export async function getPhaseDeleteImpact(
  id: string,
): Promise<enrollmentContract.PhaseDeleteImpactResponse> {
  return bffJson("tenant", "GET /api/enrollment/phases/{id}/delete-impact", {
    params: { id },
    errorMessage: "Löschvorschau konnte nicht geladen werden",
  });
}

/**
 * Permanently deletes a phase and all of its enrollment records
 * (submissions, per-child decisions, care offerings). Students created
 * from the phase are preserved by the backend. Always allowed — there is
 * no "has enrollments" guard anymore.
 */
export async function deletePhase(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/enrollment/phases/{id}/", {
    params: { id },
    errorMessage: "Phase konnte nicht gelöscht werden",
  });
}

// --- Rollover (annual phase renewal) ---

/** The rollover form's draft: the request body with its enums narrowed. */
export type RolloverInput = Omit<
  enrollmentContract.RolloverCreateRequest,
  | "name"
  | "kind"
  | "service_start_date"
  | "service_end_date"
  | "rollover_mode"
  | "rollover_auto_approve"
  | "rollover_deadline"
> & {
  name: string;
  kind: PhaseKind;
  service_start_date: string;
  service_end_date: string;
  rollover_mode: RolloverMode;
  rollover_auto_approve: boolean;
  /** RFC 3339 */
  rollover_deadline: string;
};

export interface RolloverResult {
  phase: Phase;
  summary: enrollmentContract.RolloverSummary;
}

/**
 * Creates a new phase from an existing source phase, carrying forward
 * every approved enrollment. Returns the new phase plus a summary.
 */
export async function createRollover(
  sourcePhaseID: string,
  input: RolloverInput,
): Promise<RolloverResult> {
  const { phase, summary } = await bffJson(
    "tenant",
    "POST /api/enrollment/phases/{id}/rollover",
    {
      params: { id: sourcePhaseID },
      body: input,
      errorMessage: "Rollover konnte nicht erstellt werden",
    },
  );
  return { phase: phaseFromContract(phase), summary };
}

/**
 * Read-only dry run of a rollover (#2251): how many children would be
 * carried, need admin review, or are excluded (not approved in the
 * source phase). Shown in the rollover form before executing.
 */
export async function fetchRolloverPreview(
  sourcePhaseID: string,
  bumpsGrade: boolean,
): Promise<enrollmentContract.RolloverPreviewResponse> {
  return bffJson("tenant", "GET /api/enrollment/phases/{id}/rollover-preview", {
    params: { id: sourcePhaseID },
    query: { bumps_grade: bumpsGrade },
    errorMessage: "Vorschau konnte nicht geladen werden",
  });
}

export async function listRolloverReview(
  phaseID: string,
): Promise<enrollmentContract.ReviewItemResponse[]> {
  return bffJson("tenant", "GET /api/enrollment/phases/{id}/review", {
    params: { id: phaseID },
    errorMessage: "Prüfliste konnte nicht geladen werden",
  });
}

type ReviewDecision = "keep" | "drop" | "defer";

export interface ReviewDecisionInput {
  decision: ReviewDecision;
  new_grade_level?: number | null;
}

export async function decideRolloverReview(
  requestChildID: string,
  input: ReviewDecisionInput,
): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/enrollment/admin/request-children/{id}/rollover-review",
    {
      params: { id: requestChildID },
      body: input,
      errorMessage: "Entscheidung konnte nicht gespeichert werden",
    },
  );
}

// Rücklauf der bestehenden Kinder (#3379)

// Go does not register this set; the contract types it as string.
const EXCLUSION_REASON_VALUES = [
  "care_ending",
  "graduating",
  "not_in_scope",
] as const;

/**
 * Why children do not count for the response rate. "other": a reason this
 * build does not know; the children stay excluded (ADR 0270 point 6).
 */
type PhaseResponseExclusionReason =
  (typeof EXCLUSION_REASON_VALUES)[number] | "other";

export interface PhaseResponseChild {
  studentId: string;
  firstName: string;
  lastName: string;
  schoolClass: string;
  // Mindestens ein Elternteil nutzt die Eltern-App. Nur ein Kontakthinweis,
  // fließt nie in die Rücklaufzahl ein.
  hasParentApp: boolean;
  responded: boolean;
  // Die Anmeldung, die als Antwort zählt.
  requestId: string | null;
  // Übernommener Eintrag, der noch auf Eltern oder Schule wartet.
  pendingRequestId: string | null;
  childStatus: string | null;
}

export interface PhaseResponseExclusion {
  reason: PhaseResponseExclusionReason;
  count: number;
}

export interface PhaseResponseOverview {
  // false: Die Phase ordnet Anmeldungen keinem bestehenden Kind zu.
  applicable: boolean;
  expected: number;
  responded: number;
  children: PhaseResponseChild[];
  excluded: PhaseResponseExclusion[];
}

export function mapPhaseResponseOverview(
  data: enrollmentContract.PhaseResponseOverviewResponse,
): PhaseResponseOverview {
  return {
    applicable: data.applicable,
    expected: data.expected,
    responded: data.responded,
    children: (data.children ?? []).map((child) => ({
      studentId: child.student_id,
      firstName: child.first_name,
      lastName: child.last_name,
      schoolClass: child.school_class,
      hasParentApp: child.has_parent_app,
      responded: child.responded,
      requestId: child.request_id ?? null,
      pendingRequestId: child.pending_request_id ?? null,
      childStatus: child.child_status ?? null,
    })),
    excluded: (data.excluded ?? []).map((entry) => ({
      reason: knownEnum(EXCLUSION_REASON_VALUES, entry.reason) ?? "other",
      count: entry.count,
    })),
  };
}

export async function getPhaseResponseOverview(
  phaseID: string,
): Promise<PhaseResponseOverview> {
  return mapPhaseResponseOverview(
    await bffJson("tenant", "GET /api/enrollment/phases/{id}/responses", {
      params: { id: phaseID },
      errorMessage: "Rücklauf konnte nicht geladen werden",
    }),
  );
}

/** The first phase shown by the offering catalog, in the list's server order. */
export function initialOfferingPhaseId(phases: readonly Phase[]): string {
  return (phases.find((phase) => phase.is_active) ?? phases[0])?.id ?? "";
}
