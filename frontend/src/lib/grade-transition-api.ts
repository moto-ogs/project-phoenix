import type * as adminContract from "~/lib/contract/admin.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { compareIds } from "./compare-ids";
// grade-transition-api.ts
// Client for the Jahrgangsstufenwechsel (grade transition) admin flow (#405).
// Calls the registered routes under /api/admin/grade-transitions through the
// tenant BFF. Backend snake_case is mapped to camelCase here. A failure is
// an ApiError with the backend's stable `code` (a NOT_DRAFT_CODE or
// NOT_APPLIED_CODE conflict), so the caller can tell a recoverable conflict
// from a real failure.

// Wire shapes: lib/contract/admin.generated.ts. The decoder hands every id
// over as its exact decimal string, so ids beyond 2^53 survive (#405 review).

export type TransitionStatus = "draft" | "applied" | "reverted";
type MappingAction = "promote" | "graduate";
type HistoryAction = "promoted" | "graduated" | "unchanged";

// ---------------------------------------------------------------------------
// Frontend (camelCase) types
// ---------------------------------------------------------------------------

interface TransitionMapping {
  id: string;
  fromClass: string;
  toClass: string | null;
  action: MappingAction;
}

export interface GradeTransition {
  id: string;
  academicYear: string;
  status: TransitionStatus;
  appliedAt: string | null;
  revertedAt: string | null;
  createdAt: string;
  notes: string | null;
  mappings: TransitionMapping[];
  canModify: boolean;
  canApply: boolean;
  canRevert: boolean;
  /** Stand des Entwurfs; eine Änderung schickt ihn mit (ADR 0311). */
  version: string;
}

interface MappingPreview {
  fromClass: string;
  toClass: string | null;
  studentCount: number;
  action: MappingAction;
}

interface UnmappedClass {
  className: string;
  studentCount: number;
}

export interface TransitionPreview {
  transitionId: string;
  academicYear: string;
  totalStudents: number;
  toPromote: number;
  toGraduate: number;
  byMapping: MappingPreview[];
  unmappedClasses: UnmappedClass[];
  warnings: string[];
  /** @see adminContract.TransitionPreviewResponse.fingerprint */
  fingerprint: string;
}

export interface TransitionResult {
  transitionId: string;
  status: string;
  studentsPromoted: number;
  studentsGraduated: number;
  canRevert: boolean;
  warnings: string[];
}

export interface SuggestedMapping {
  fromClass: string;
  toClass: string | null;
  studentCount: number;
  isGraduating: boolean;
  /** true = class name has no grade pattern; do not preselect Abgang */
  ambiguous?: boolean;
}

/**
 * What is left of a graduated child today. The ledger is append-only, so its
 * `action` still says "graduated" for a child a revert brought back or a purge
 * removed — only this decides which actions the Abgänge list may offer.
 */
export type GraduateState = "alumnus" | "restored" | "purged";

export interface TransitionHistoryEntry {
  id: string;
  transitionId: string;
  studentId: string;
  personName: string;
  fromClass: string;
  toClass: string | null;
  action: HistoryAction;
  createdAt: string;
  /**
   * Defaults to "alumnus" when a backend predating the field answers: that is
   * the state every graduated ledger row had before purging existed, so an old
   * response degrades to "shown, deletable" rather than to a wrong state.
   */
  studentState: GraduateState;
}

export interface MappingInput {
  fromClass: string;
  /** null = Abgang (Kind verlässt die OGS, wird als Alumnus deaktiviert) */
  toClass: string | null;
}

export interface CreateTransitionInput {
  academicYear: string;
  notes?: string;
  mappings: MappingInput[];
}

export interface UpdateTransitionInput {
  /** Der gelesene Stand; ein seither geänderter Entwurf wird abgelehnt. */
  expectedVersion: string;
  academicYear?: string;
  notes?: string;
  /** undefined = Mappings unverändert lassen; [] = alle entfernen */
  mappings?: MappingInput[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

const STATUSES: readonly TransitionStatus[] = ["draft", "applied", "reverted"];
const MAPPING_ACTIONS: readonly MappingAction[] = ["promote", "graduate"];
const HISTORY_ACTIONS: readonly HistoryAction[] = [
  "promoted",
  "graduated",
  "unchanged",
];
const GRADUATE_STATES: readonly GraduateState[] = [
  "alumnus",
  "restored",
  "purged",
];

const mappingAction = (value: string): MappingAction =>
  knownEnum(MAPPING_ACTIONS, value) ?? "promote";

export function mapTransition(
  data: adminContract.TransitionResponse,
): GradeTransition {
  return {
    id: data.id,
    academicYear: data.academic_year,
    // A status this build does not know offers no edit: the backend's
    // can_* flags still decide what the admin may do.
    status: knownEnum(STATUSES, data.status) ?? "applied",
    appliedAt: data.applied_at ?? null,
    revertedAt: data.reverted_at ?? null,
    createdAt: data.created_at,
    notes: data.notes ?? null,
    mappings: (data.mappings ?? []).map((m) => ({
      id: m.id,
      fromClass: m.from_class,
      toClass: m.to_class ?? null,
      action: mappingAction(m.action),
    })),
    canModify: data.can_modify,
    canApply: data.can_apply,
    canRevert: data.can_revert,
    version: data.version,
  };
}

export function mapPreview(
  data: adminContract.TransitionPreviewResponse,
): TransitionPreview {
  return {
    transitionId: data.transition_id,
    academicYear: data.academic_year,
    totalStudents: data.total_students,
    toPromote: data.to_promote,
    toGraduate: data.to_graduate,
    byMapping: (data.by_mapping ?? []).map((m) => ({
      fromClass: m.from_class,
      toClass: m.to_class ?? null,
      studentCount: m.student_count,
      action: mappingAction(m.action),
    })),
    unmappedClasses: (data.unmapped_classes ?? []).map((u) => ({
      className: u.class_name,
      studentCount: u.student_count,
    })),
    warnings: data.warnings ?? [],
    // An older backend sent no digest; apply then sends no expected_fingerprint.
    fingerprint: data.fingerprint ?? "",
  };
}

export function mapResult(
  data: adminContract.TransitionResultResponse,
): TransitionResult {
  return {
    transitionId: data.transition_id,
    status: data.status,
    studentsPromoted: data.students_promoted,
    studentsGraduated: data.students_graduated,
    canRevert: data.can_revert,
    warnings: data.warnings ?? [],
  };
}

export function mapSuggestion(
  data: adminContract.SuggestedMappingResponse,
): SuggestedMapping {
  return {
    fromClass: data.from_class,
    toClass: data.to_class ?? null,
    studentCount: data.student_count,
    isGraduating: data.is_graduating,
    // Left undefined when the backend omits it (confident suggestion), which
    // the mapper's toEqual tests treat as absent.
    ambiguous: data.ambiguous,
  };
}

export function mapHistoryEntry(
  data: adminContract.TransitionHistoryResponse,
): TransitionHistoryEntry {
  return {
    id: data.id,
    transitionId: data.transition_id,
    studentId: data.student_id,
    personName: data.person_name,
    fromClass: data.from_class,
    toClass: data.to_class ?? null,
    action: knownEnum(HISTORY_ACTIONS, data.action) ?? "unchanged",
    createdAt: data.created_at,
    studentState: knownEnum(GRADUATE_STATES, data.student_state) ?? "alumnus",
  };
}

function toBackendMappings(mappings: MappingInput[]) {
  return mappings.map((m) => ({
    from_class: m.fromClass,
    to_class: m.toClass,
  }));
}

/**
 * Stable backend error code returned (409) when a revert is refused because the
 * targeted transition is no longer the latest applied one — another
 * administrator applied a newer transition since this page loaded. Recoverable:
 * the caller must reload the list and revert the new latest first. Mirrors the
 * code the Go handler sets via ErrorConflictWithCode (#405).
 */
export const NOT_LATEST_TRANSITION_CODE: ErrorCode =
  "grade_transition.not_latest_transition";

/**
 * Stable backend error code returned (409) when an apply is refused because the
 * previewed cohort has changed since the preview was rendered — another admin
 * edited the mappings or moved a child between classes. The UI must reload the
 * preview and ask for a fresh confirmation instead of retrying blindly (#405).
 */
export const PREVIEW_STALE_CODE: ErrorCode = "grade_transition.preview_stale";

/**
 * Stable backend error code returned (409) when an update or delete targets a
 * transition that is no longer a draft — another administrator applied it since
 * this page loaded. Retrying is pointless; the caller must reload the list.
 * Mirrors the code the Go handler sets via ErrorConflictWithCode (#405).
 */
export const NOT_DRAFT_CODE: ErrorCode = "grade_transition.not_draft";

/**
 * Stable backend error code returned (409) when a revert targets a transition
 * that is not in applied status — it is still a draft, or another
 * administrator already reverted it since this page loaded. Retrying is
 * pointless; the caller must reload the list. Mirrors the code the Go handler
 * sets via ErrorConflictWithCode (#405 review).
 */
export const NOT_APPLIED_CODE: ErrorCode = "grade_transition.not_applied";

/** A failure keeps the backend's code; its message names the HTTP status. */
function statusMessage(error: unknown): never {
  if (error instanceof ApiError && error.status !== undefined) {
    error.message = `HTTP ${error.status}`;
  }
  throw error;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

const LIST_PAGE_SIZE = 100;

// Safety bound against a backend that ignores `after_id` and would loop
// forever — 100 windows is 10.000 transitions, far past anything a school can
// produce, so it never truncates in practice.
const LIST_PAGE_LIMIT = 100;

// Newest-first by autoincrement key, without rounding ids above 2^53.
function compareByIdDesc(
  a: adminContract.TransitionResponse,
  b: adminContract.TransitionResponse,
): number {
  return compareIds(b.id, a.id);
}

// Fetches every transition, not just the first page. The list feeds both the
// table and the revert-target picker, and reverts must unwind newest-first: with
// more than one page of rows, a single created_at DESC window can hide the only
// revertable transition, or point the dialog at an applied row that is not the
// latest — which 409s, refreshes the same truncated window, and re-picks the
// same dead target (#405 review).
export async function listGradeTransitions(): Promise<GradeTransition[]> {
  // Keyset windows (`after_id`, id ASC) instead of page offsets: offset pages
  // re-slice the whole result on every request, so a row created or deleted
  // between two requests shifts the slicing and a survivor can fall between
  // pages and vanish from the merged list — including the next valid revert
  // target. An id cursor never re-slices what was already read: concurrent
  // inserts sort behind the cursor and arrive in a later window, deletions
  // cannot move unread rows across it (#405 review). The cursor travels as the
  // exact string id so values above 2^53 cannot round.
  // Keyed by the exact string id: a correct keyset backend never repeats a
  // row, but one that ignores `after_id` would send the same window forever —
  // the map keeps that failure mode at "truncated list", not "duplicated
  // rows".
  const byID = new Map<string, adminContract.TransitionResponse>();
  let afterID = "0";

  for (let window = 0; window < LIST_PAGE_LIMIT; window++) {
    const page = await bffJson("tenant", "GET /api/admin/grade-transitions/", {
      query: { after_id: afterID, page_size: LIST_PAGE_SIZE },
    }).catch(statusMessage);
    const data = page.data ?? [];
    for (const transition of data) {
      byID.set(transition.id, transition);
    }
    const last = data.at(-1);
    if (data.length < LIST_PAGE_SIZE || !last) break;
    afterID = last.id;
  }

  return Array.from(byID.values()).sort(compareByIdDesc).map(mapTransition);
}

export async function createGradeTransition(
  input: CreateTransitionInput,
): Promise<GradeTransition> {
  return mapTransition(
    await bffJson("tenant", "POST /api/admin/grade-transitions/", {
      body: {
        academic_year: input.academicYear,
        notes: input.notes,
        mappings: toBackendMappings(input.mappings),
      },
    }).catch(statusMessage),
  );
}

export async function updateGradeTransition(
  id: string,
  input: UpdateTransitionInput,
): Promise<GradeTransition> {
  // Keeps the stable code: a NOT_DRAFT_CODE conflict means the loaded draft
  // was applied by another admin, and the editor must say so instead of
  // suggesting a retry that can never succeed (#405 review).
  return mapTransition(
    await bffJson("tenant", "PUT /api/admin/grade-transitions/{id}/", {
      params: { id },
      body: {
        academic_year: input.academicYear,
        notes: input.notes,
        mappings: input.mappings
          ? toBackendMappings(input.mappings)
          : undefined,
        expected_version: input.expectedVersion,
      },
    }).catch(statusMessage),
  );
}

export async function deleteGradeTransition(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/admin/grade-transitions/{id}/", {
    params: { id },
  }).catch(statusMessage);
}

export async function previewGradeTransition(
  id: string,
): Promise<TransitionPreview> {
  return mapPreview(
    await bffJson("tenant", "GET /api/admin/grade-transitions/{id}/preview", {
      params: { id },
    }).catch(statusMessage),
  );
}

/**
 * Applies a transition. `expectedFingerprint` binds the call to the preview the
 * admin confirmed: the backend refuses with {@link PREVIEW_STALE_CODE} when the
 * affected children or mappings have changed since (#405).
 */
export async function applyGradeTransition(
  id: string,
  expectedFingerprint?: string,
): Promise<TransitionResult> {
  return mapResult(
    await bffJson("tenant", "POST /api/admin/grade-transitions/{id}/apply", {
      params: { id },
      body: expectedFingerprint
        ? { expected_fingerprint: expectedFingerprint }
        : {},
    }).catch(statusMessage),
  );
}

export async function revertGradeTransition(
  id: string,
): Promise<TransitionResult> {
  return mapResult(
    await bffJson("tenant", "POST /api/admin/grade-transitions/{id}/revert", {
      params: { id },
    }).catch(statusMessage),
  );
}

export async function fetchTransitionClasses(): Promise<string[]> {
  return (
    (await bffJson(
      "tenant",
      "GET /api/admin/grade-transitions/classes",
      {},
    ).catch(statusMessage)) ?? []
  );
}

export async function fetchSuggestedMappings(): Promise<SuggestedMapping[]> {
  const data = await bffJson(
    "tenant",
    "GET /api/admin/grade-transitions/suggest",
  ).catch(statusMessage);
  return (data ?? []).map(mapSuggestion);
}

export async function fetchTransitionHistory(
  id: string,
): Promise<TransitionHistoryEntry[]> {
  const data = await bffJson(
    "tenant",
    "GET /api/admin/grade-transitions/{id}/history",
    {
      params: { id },
    },
  ).catch(statusMessage);
  return (data ?? []).map(mapHistoryEntry);
}

/**
 * Permanently deletes a child that a grade transition graduated — student row,
 * person row, photo, and their name in the transition ledger.
 *
 * This is the counterpart to the soft delete graduation performs: the child is
 * hidden everywhere and every ordinary student route answers 404 for them, so
 * without this there is no way to honour a retention rule or an erasure
 * request for a departed child. Not reversible by `Zurücksetzen` afterwards —
 * the ledger row survives to keep the transition's count honest, but there is
 * nothing left to restore.
 */
export async function purgeGraduatedStudent(studentId: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/students/{id}/purge", {
    params: { id: studentId },
  }).catch(statusMessage);
}
