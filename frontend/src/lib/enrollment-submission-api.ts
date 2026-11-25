import { ApiError } from "~/lib/api-error";
import {
  bffFile,
  bffJson,
  bffJsonUncontracted,
  bffPath,
} from "~/lib/bff-fetch";
import { knownEnum, requiredEnum } from "~/lib/contract/known-enum";
import type * as enrollmentContract from "~/lib/contract/enrollment.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import type {
  PublicFormSchema,
  PublicLegalBlock,
  PublicLegalTexts,
} from "~/lib/enrollment-form-schema-api";
import {
  careOfferingFromContract,
  type CareOffering,
} from "~/lib/care-offering-api";
import type { Translations } from "~/lib/enrollment-translations";
import {
  formLabelsFromContract,
  type EnrollmentFormLabels,
} from "~/lib/enrollment-change-request-diff";
import {
  publicFormSchemaFromContract,
  publicLegalBlockFromContract,
  publicLegalTextsFromContract,
  translationsFromContract,
} from "~/lib/enrollment-form-schema-api";
import {
  PHASE_AUDIENCES,
  PHASE_KINDS,
  SELECTION_MODES,
  type CareOfferingSelectionMode,
  type PhaseAudience,
  type PhaseKind,
} from "~/lib/enrollment-phase-api";
import {
  CHANGE_REQUEST_STATUSES,
  CHILD_STATUSES,
  type ChangeRequestStatus,
  type ChildStatus,
} from "~/lib/enrollment-status";

// Go does not register these sets; the contract types them as string.
const EDIT_MODES = ["direct_edit", "change_request"] as const;
const STATUS_EDIT_MODES = [...EDIT_MODES, "none"] as const;
const PORTAL_ACCESS_VALUES = ["account", "invitation", "contact_ogs"] as const;
const SIGNATURE_METHODS = ["drawn", "typed"] as const;
const CHANGE_REQUEST_ORIGINS = ["parent", "admin"] as const;
const MESSAGE_AUTHORS = ["parent", "staff", "system"] as const;

/** An object answer the contract carries as unknown (form answers, consents). */

/**
 * Concrete-class config for a phase (#1833): whether the tenant collects a
 * concrete class at all, the phase's pick list, whether it is mandatory from
 * grade 2, and whether grade 1 declares one here (#1663): grade 1 is opt-in
 * and the form cannot derive it from the pick list.
 */
export type PublicSchoolClassConfig = Omit<
  sharedContract.PublicSchoolClassConfig,
  "available_classes"
> & { available_classes: string[] };

export const EMPTY_SCHOOL_CLASS_CONFIG: PublicSchoolClassConfig = {
  collect: false,
  available_classes: [],
  require: false,
  collect_grade_1: false,
};

function schoolClassFromContract(
  config: sharedContract.PublicSchoolClassConfig,
): PublicSchoolClassConfig {
  return { ...config, available_classes: config.available_classes ?? [] };
}

export interface LateInviteFetchOptions {
  lateInviteToken?: string;
}

/**
 * A phase of the public picker. `audience` names who may apply (#1663);
 * the picker labels a restriction so anonymous parents see it before filling
 * the form. `eligible_grade_levels` narrows the grade select ([] = no
 * restriction).
 */
export type PublicPhase = Omit<
  sharedContract.PublicPhase,
  | "kind"
  | "care_offering_selection_mode"
  | "audience"
  | "eligible_grade_levels"
  | "translations"
> & {
  kind: PhaseKind;
  care_offering_selection_mode: CareOfferingSelectionMode;
  audience: PhaseAudience;
  eligible_grade_levels: number[];
  /** Translations of `name` that still match the German name (#3377). */
  translations?: Translations;
};

function publicPhaseFromContract(
  phase: sharedContract.PublicPhase,
): PublicPhase {
  const { translations, ...rest } = phase;
  const named = translationsFromContract(translations);
  return {
    ...rest,
    kind: requiredEnum(PHASE_KINDS, phase.kind, "PublicPhase.kind"),
    care_offering_selection_mode: requiredEnum(
      SELECTION_MODES,
      phase.care_offering_selection_mode,
      "PublicPhase.care_offering_selection_mode",
    ),
    audience: requiredEnum(
      PHASE_AUDIENCES,
      phase.audience,
      "PublicPhase.audience",
    ),
    eligible_grade_levels: phase.eligible_grade_levels ?? [],
    ...(named && { translations: named }),
  };
}

/**
 * Fetches the currently-open phases for a tenant. Public route — no
 * JWT required. The parent landing page uses this for the phase
 * picker; clicking a phase navigates the parent into the form.
 */
export async function fetchPublicPhases(
  tenantSlug: string,
): Promise<PublicPhase[]> {
  const phases = await bffJson(
    "public",
    "GET /api/enrollment/phases/public/{tenantSlug}",
    {
      params: { tenantSlug },
      errorMessage: "Phasen konnten nicht geladen werden",
    },
  );
  return phases.map(publicPhaseFromContract);
}

/**
 * The signed-in guardian and the children the reuse picker offers. A child
 * is offered only with `enrollment_submit` (#1663) and an active or pending
 * `status`: an inactive child would be rejected by the existing_students
 * gate.
 */
export type MeProfileResponse = Omit<
  sharedContract.GuardianProfileResponse,
  "children"
> & { children: sharedContract.GuardianProfileChild[] };

/**
 * The configuration of one phase's form: the phase, the active schema, its
 * offerings and rules, the captcha and the legal texts. `profile` is set for
 * a signed-in staff member or parent, `late_invite` for a late invitation.
 */
export type PublicEnrollmentBootstrap = Omit<
  sharedContract.PublicEnrollmentFormBootstrapResponse,
  | "phase"
  | "schema"
  | "offerings"
  | "care_offering_selection_mode"
  | "school_class"
  | "legal_texts"
> & {
  phase: PublicPhase;
  schema: PublicFormSchema | null;
  offerings: CareOffering[];
  care_offering_selection_mode: CareOfferingSelectionMode;
  school_class: PublicSchoolClassConfig;
  legal_texts: PublicLegalTexts;
  profile?: MeProfileResponse | null;
};

/** The parts every form bootstrap shares (public, parent, edit, preview). */
export function formConfigurationFromContract<
  T extends Pick<
    sharedContract.PublicEnrollmentFormBootstrapResponse,
    "schema" | "offerings" | "care_offering_selection_mode" | "school_class"
  >,
>(
  bootstrap: T,
): Omit<
  T,
  "schema" | "offerings" | "care_offering_selection_mode" | "school_class"
> &
  Pick<
    PublicEnrollmentBootstrap,
    "schema" | "offerings" | "care_offering_selection_mode" | "school_class"
  > {
  return {
    ...bootstrap,
    schema: bootstrap.schema && publicFormSchemaFromContract(bootstrap.schema),
    offerings: (bootstrap.offerings ?? []).map(careOfferingFromContract),
    care_offering_selection_mode: requiredEnum(
      SELECTION_MODES,
      bootstrap.care_offering_selection_mode,
      "FormBootstrap.care_offering_selection_mode",
    ),
    school_class: schoolClassFromContract(bootstrap.school_class),
  };
}

type BootstrapAnswer = sharedContract.PublicEnrollmentFormBootstrapResponse & {
  profile?: sharedContract.GuardianProfileResponse | null;
};

export function bootstrapFromContract(
  bootstrap: BootstrapAnswer,
): PublicEnrollmentBootstrap {
  const { profile, ...rest } = bootstrap;
  const configured = formConfigurationFromContract(rest);
  return {
    ...configured,
    phase: publicPhaseFromContract(rest.phase),
    legal_texts: publicLegalTextsFromContract(rest.legal_texts),
    ...(profile && {
      profile: { ...profile, children: profile.children ?? [] },
    }),
  };
}

export async function fetchPublicEnrollmentBootstrap(
  tenantSlug: string,
  phaseId: string,
  options: LateInviteFetchOptions = {},
): Promise<PublicEnrollmentBootstrap> {
  // Its own route file adds the signed-in staff member's profile, so the
  // path has no Go contract of its own.
  const lateInvite = options.lateInviteToken?.trim();
  return bootstrapFromContract(
    await bffJsonUncontracted<BootstrapAnswer>(
      "public",
      "GET",
      bffPath(
        "tenant",
        "GET /api/enrollment/form-bootstrap/public/{tenantSlug}/{phaseId}",
        {
          params: { tenantSlug, phaseId },
          query: lateInvite ? { late_invite: lateInvite } : {},
        },
      ),
      {
        errorMessage: "Anmeldeformular konnte nicht geladen werden",
      },
    ),
  );
}

/**
 * Authenticated parents-portal form-load bootstrap. Hits the parent-scoped
 * endpoint instead of the anonymous public path, so audience-restricted
 * (linked_parents) phases — which the public endpoint refuses (#1663) — load
 * for a logged-in guardian. The response shape matches the public bootstrap
 * (captcha is empty; the parent JWT is the anti-bot signal).
 */
export async function fetchParentEnrollmentBootstrap(
  tenantSlug: string,
  phaseId: string,
  options: LateInviteFetchOptions = {},
): Promise<PublicEnrollmentBootstrap> {
  return bootstrapFromContract(
    await bffJson(
      "parent",
      "GET /parent/enrollments/{tenantSlug}/bootstrap/{phaseId}",
      {
        params: { tenantSlug, phaseId },
        query: { late_invite: options.lateInviteToken?.trim() || undefined },
        errorMessage: "Anmeldeformular konnte nicht geladen werden",
      },
    ),
  );
}

/**
 * Submits an enrollment for the given tenant slug. The backend handles
 * captcha verification, schema pinning, and outbox enqueueing.
 */
export async function submitEnrollment(
  tenantSlug: string,
  payload: sharedContract.SubmitEnrollmentRequest,
): Promise<sharedContract.SubmitEnrollmentResponse> {
  return bffJson("public", "POST /api/enrollment/{tenantSlug}/submit", {
    params: { tenantSlug },
    body: payload,
    errorMessage: "Anmeldung konnte nicht übermittelt werden",
  });
}

/**
 * A child on the status page. `locked` is true once the child is taken over
 * into care: its data stays readable, but changes run through the parents
 * app only (ADR 0003).
 */
export type StatusChild = Omit<
  enrollmentContract.StatusChildResponse,
  "status"
> & { status: ChildStatus };

/** The terms a renewal asks the parents to accept (#6456). */
export type StatusRenewalTerms = Omit<
  enrollmentContract.StatusRenewalTermsResponse,
  "blocks"
> & { blocks: PublicLegalBlock[] };

/**
 * A stored signature of an enrollment (#4786): a simple electronic
 * signature with a drawn signature. `image_png` (base64, no `data:` prefix)
 * reaches only the staff detail.
 */
export type EnrollmentSignature = Omit<
  enrollmentContract.RequestSignatureResponse,
  "method"
> & { method: (typeof SIGNATURE_METHODS)[number] };

export function signatureFromContract(
  signature: enrollmentContract.RequestSignatureResponse,
): EnrollmentSignature {
  return {
    ...signature,
    method: requiredEnum(
      SIGNATURE_METHODS,
      signature.method,
      "EnrollmentSignature.method",
    ),
  };
}

/**
 * The status behind a status link. `has_parent_account` and
 * `parent_portal_access` are set only while a child is taken over into care
 * and the backend could check the account; `signature_required` lets the
 * page offer only the full form (#4786); `renewal_terms` are set while a
 * child waits for its renewal (#6456).
 */
export type StatusResponse = Omit<
  enrollmentContract.StatusResponse,
  | "edit_mode"
  | "children"
  | "parent_portal_access"
  | "signature"
  | "renewal_terms"
> & {
  edit_mode: (typeof STATUS_EDIT_MODES)[number];
  children: StatusChild[];
  /** undefined: not determined, or a step this build does not know. */
  parent_portal_access?: (typeof PORTAL_ACCESS_VALUES)[number];
  signature?: EnrollmentSignature;
  renewal_terms?: StatusRenewalTerms;
};

export type EnrollmentStatusDisplay = Omit<
  StatusResponse,
  "request_id" | "signature"
> & {
  signature?: Pick<
    EnrollmentSignature,
    "method" | "typed_name" | "signer_name" | "signed_at" | "integrity_ok"
  >;
};

export function statusFromContract(
  status: enrollmentContract.StatusResponse,
): StatusResponse {
  const {
    parent_portal_access: access,
    signature,
    renewal_terms: terms,
    ...rest
  } = status;
  const known = knownEnum(PORTAL_ACCESS_VALUES, access);
  return {
    ...rest,
    edit_mode: requiredEnum(
      STATUS_EDIT_MODES,
      status.edit_mode,
      "Status.edit_mode",
    ),
    children: (status.children ?? []).map((child) => ({
      ...child,
      status: requiredEnum(CHILD_STATUSES, child.status, "StatusChild.status"),
    })),
    ...(known && { parent_portal_access: known }),
    ...(signature && { signature: signatureFromContract(signature) }),
    ...(terms && {
      renewal_terms: {
        ...terms,
        blocks: (terms.blocks ?? []).map((block, index) =>
          publicLegalBlockFromContract(
            block,
            `StatusRenewalTerms.blocks.${index}`,
          ),
        ),
      },
    }),
  };
}

/**
 * Loads the status payload for a token. Returns null when the token is
 * unknown or expired (404).
 */
export async function fetchStatus(
  token: string,
): Promise<StatusResponse | null> {
  try {
    return statusFromContract(
      await bffJson("public", "GET /api/enrollment/requests/{statusToken}", {
        params: { statusToken: token },
        errorMessage: "Status konnte nicht geladen werden",
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Downloads the proof of the parent's signature behind the status link. */
export async function downloadEnrollmentSignatureProof(
  token: string,
): Promise<void> {
  const response = await bffFile(
    "public",
    "GET /api/enrollment/requests/{statusToken}/signature-proof",
    {
      params: { statusToken: token },
      errorMessage: "Nachweis konnte nicht geladen werden",
    },
  );
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ?? "anmeldenachweis.pdf",
  );
}

type EnrollmentEditDraftChild = Omit<
  enrollmentContract.EditDraftChildResponse,
  "custom_data" | "offering_ids" | "offering_days"
> & {
  custom_data: Record<string, unknown>;
  offering_ids: string[];
  offering_days?: (Omit<
    enrollmentContract.EditDraftOfferingDayResponse,
    "selected_days"
  > & { selected_days: string[] })[];
};

/** The stored enrollment a status link edits. */
export type EnrollmentEditDraft = Omit<
  enrollmentContract.EditDraftResponse,
  "consent_flags" | "custom_data" | "children"
> & {
  consent_flags: NonNullable<
    enrollmentContract.EditDraftResponse["consent_flags"]
  >;
  custom_data: Record<string, unknown>;
  children: EnrollmentEditDraftChild[];
};

/**
 * The form of a status-link edit: the configuration of the request's phase,
 * the tenant cap `grade_level_max` and the stored draft.
 */
export type EnrollmentEditBootstrap = Omit<
  enrollmentContract.EditBootstrapResponse,
  | "phase"
  | "schema"
  | "offerings"
  | "care_offering_selection_mode"
  | "school_class"
  | "legal_texts"
  | "draft"
  | "edit_mode"
> &
  Pick<
    PublicEnrollmentBootstrap,
    | "phase"
    | "schema"
    | "offerings"
    | "care_offering_selection_mode"
    | "school_class"
    | "legal_texts"
  > & {
    draft: EnrollmentEditDraft;
    edit_mode: (typeof EDIT_MODES)[number];
  };

export async function fetchEnrollmentEditBootstrap(
  token: string,
  fallback = "Anmeldung kann nicht bearbeitet werden",
): Promise<EnrollmentEditBootstrap> {
  const bootstrap = await bffJson(
    "public",
    "GET /api/enrollment/requests/{statusToken}/edit-bootstrap",
    { params: { statusToken: token }, errorMessage: fallback },
  );
  const { draft } = bootstrap;
  return {
    ...formConfigurationFromContract(bootstrap),
    phase: publicPhaseFromContract(bootstrap.phase),
    legal_texts: publicLegalTextsFromContract(bootstrap.legal_texts),
    edit_mode: requiredEnum(
      EDIT_MODES,
      bootstrap.edit_mode,
      "EnrollmentEditBootstrap.edit_mode",
    ),
    draft: {
      ...draft,
      consent_flags: draft.consent_flags ?? {},
      custom_data: draft.custom_data ?? {},
      children: (draft.children ?? []).map(
        ({ offering_days: days, ...child }) => ({
          ...child,
          custom_data: child.custom_data ?? {},
          offering_ids: child.offering_ids ?? [],
          ...(days && {
            offering_days: days.map((day) => ({
              ...day,
              selected_days: day.selected_days ?? [],
            })),
          }),
        }),
      ),
    },
  };
}

export async function updateEnrollmentRequest(
  token: string,
  payload: sharedContract.SubmitEnrollmentRequest,
  fallback = "Änderungen konnten nicht gespeichert werden",
): Promise<sharedContract.SubmitEnrollmentResponse> {
  return bffJson("public", "PUT /api/enrollment/requests/{statusToken}", {
    params: { statusToken: token },
    body: payload,
    errorMessage: fallback,
  });
}

type EnrollmentChangeRequestMessage = Omit<
  enrollmentContract.ChangeRequestMessageResponse,
  "author_type"
> & {
  /** undefined: an author this build does not know. */
  author_type: (typeof MESSAGE_AUTHORS)[number] | undefined;
};

/** A change request of an enrollment, with its snapshots and messages. */
export type EnrollmentChangeRequest = Omit<
  enrollmentContract.ChangeRequestResponse,
  | "origin"
  | "status"
  | "base_snapshot"
  | "proposed_snapshot"
  | "diff"
  | "messages"
> & {
  /** undefined: an origin this build does not know. */
  origin: (typeof CHANGE_REQUEST_ORIGINS)[number] | undefined;
  status: ChangeRequestStatus;
  base_snapshot: NonNullable<
    enrollmentContract.ChangeRequestResponse["base_snapshot"]
  >;
  proposed_snapshot: NonNullable<
    enrollmentContract.ChangeRequestResponse["proposed_snapshot"]
  >;
  diff: NonNullable<enrollmentContract.ChangeRequestResponse["diff"]>;
  messages?: EnrollmentChangeRequestMessage[];
};

export function changeRequestFromContract(
  request: enrollmentContract.ChangeRequestResponse,
): EnrollmentChangeRequest {
  const { messages, ...rest } = request;
  return {
    ...rest,
    origin: knownEnum(CHANGE_REQUEST_ORIGINS, request.origin),
    status: requiredEnum(
      CHANGE_REQUEST_STATUSES,
      request.status,
      "EnrollmentChangeRequest.status",
    ),
    base_snapshot: request.base_snapshot ?? {},
    proposed_snapshot: request.proposed_snapshot ?? {},
    diff: request.diff ?? {},
    ...(messages && {
      messages: messages.map((message) => ({
        ...message,
        author_type: knownEnum(MESSAGE_AUTHORS, message.author_type),
      })),
    }),
  };
}

export async function createEnrollmentChangeRequest(
  token: string,
  payload: sharedContract.SubmitEnrollmentRequest,
  parentNote = "",
  fallback = "Änderungsanfrage konnte nicht gespeichert werden",
): Promise<EnrollmentChangeRequest> {
  return changeRequestFromContract(
    await bffJson(
      "public",
      "POST /api/enrollment/requests/{statusToken}/change-requests",
      {
        params: { statusToken: token },
        body: { ...payload, parent_note: parentNote },
        errorMessage: fallback,
      },
    ),
  );
}

export async function listEnrollmentChangeRequests(
  token: string,
): Promise<EnrollmentChangeRequest[]> {
  const requests = await bffJson(
    "public",
    "GET /api/enrollment/requests/{statusToken}/change-requests",
    {
      params: { statusToken: token },
      errorMessage: "Änderungsanfragen konnten nicht geladen werden",
    },
  );
  return requests.map(changeRequestFromContract);
}

/**
 * Questions and consent titles of the form version behind a status link
 * (#6142), which name the rows of a change request.
 */
export async function getEnrollmentFormLabels(
  token: string,
): Promise<EnrollmentFormLabels> {
  return formLabelsFromContract(
    await bffJson(
      "public",
      "GET /api/enrollment/requests/{statusToken}/form-labels",
      {
        params: { statusToken: token },
        errorMessage:
          "Fragen des Anmeldeformulars konnten nicht geladen werden",
      },
    ),
  );
}

export async function replyEnrollmentChangeRequest(
  token: string,
  changeRequestId: string,
  body: string,
): Promise<EnrollmentChangeRequest> {
  return changeRequestFromContract(
    await bffJson(
      "public",
      "POST /api/enrollment/requests/{statusToken}/change-requests/{changeRequestId}/messages",
      {
        params: { statusToken: token, changeRequestId },
        body: { body },
        errorMessage: "Antwort konnte nicht gesendet werden",
      },
    ),
  );
}

export async function patchStatus(
  token: string,
  patch: enrollmentContract.EditPatchRequest,
): Promise<void> {
  await bffJson("public", "PATCH /api/enrollment/requests/{statusToken}", {
    params: { statusToken: token },
    body: patch,
    errorMessage: "Änderungen konnten nicht gespeichert werden",
  });
}

export async function withdrawStatus(
  token: string,
  childID?: string,
): Promise<void> {
  await bffJson(
    "public",
    "POST /api/enrollment/requests/{statusToken}/withdraw",
    {
      params: { statusToken: token },
      body: childID ? { child_id: childID } : {},
      errorMessage: "Rücknahme nicht möglich",
    },
  );
}

/** The parents' answer to the renewal terms (#6456). */
export interface RenewalConfirmation {
  /** Key of every block the parents ticked. */
  consentFlags: Record<string, boolean>;
  /** `renewal_terms.form_schema_id` of the status the page showed. */
  formSchemaId: string;
  termsFingerprint: string;
}

/**
 * Accepts the renewal terms. An opt_in renewal also moves every
 * pending_renewal child to submitted, where the admin's review queue picks
 * them up; an opt_out renewal keeps its status. Returns the number of
 * children promoted.
 */
export async function confirmRenewal(
  token: string,
  confirmation: RenewalConfirmation,
): Promise<number> {
  const { confirmed } = await bffJson(
    "public",
    "POST /api/enrollment/requests/{statusToken}/confirm-renewal",
    {
      params: { statusToken: token },
      body: {
        consent_flags: confirmation.consentFlags,
        form_schema_id: confirmation.formSchemaId,
        terms_fingerprint: confirmation.termsFingerprint,
      },
      errorMessage: "Bestätigung nicht möglich",
    },
  );
  return confirmed;
}
