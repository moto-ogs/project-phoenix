import type { StammdatenGender } from "~/lib/staff-api";
import type {
  CreateSchoolInvitationRequest,
  SchoolInvitationResponse,
} from "~/lib/contract/auth-invitations.generated";
import { knownEnum } from "~/lib/contract/runtime";
import type {
  EmailAddressMark,
  MailProviderBlock,
  MailOutcome,
} from "~/lib/email-delivery-status";

export interface InvitationValidation {
  targetPortal?: "tenant" | "school";
  requiresAccountLogin?: boolean;
  email: string;
  roleName: string;
  firstName?: string | null;
  lastName?: string | null;
  position?: string | null;
  expiresAt: string;
}

export interface InvitationAcceptRequest {
  existingAccount?: boolean;
  firstName: string;
  lastName: string;
  password: string;
  confirmPassword: string;
}

const EMPLOYMENT_ACTIONS = ["resume", "new"] as const;
export type EmploymentAction = (typeof EMPLOYMENT_ACTIONS)[number];

export interface CreateInvitationRequest {
  resetMasterData?: boolean;
  resetQualifications?: boolean;
  resetWorkTime?: boolean;
  employmentAction?: EmploymentAction;
  email: string;
  roleId: string | undefined;
  firstName?: string;
  lastName?: string;
  position?: string;
  /** Geschlecht für die Stammdaten; fehlt bei „Keine Angabe“. */
  gender?: StammdatenGender;
}

export interface PendingInvitation {
  employmentAction?: EmploymentAction;
  /** Decimal string, as the contract delivers bigint ids (#7563). */
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  createdBy: string;
  creatorEmail?: string;
  expiresAt: string;
  token?: string;
  firstName?: string | null;
  lastName?: string | null;
  position?: string | null;
  /** What became of the last mail; only a provider's report says delivered. */
  mailOutcome?: MailOutcome;
  providerBlock?: MailProviderBlock;
  addressMark?: EmailAddressMark;
}

export interface BackendInvitationValidation {
  target_portal?: "tenant" | "school";
  requires_account_login?: boolean;
  email: string;
  role_name: string;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  expires_at: string;
}

export const mapInvitationValidationResponse = (
  data: BackendInvitationValidation,
): InvitationValidation => ({
  targetPortal: data.target_portal,
  requiresAccountLogin: data.requires_account_login,
  email: data.email,
  roleName: data.role_name,
  firstName: data.first_name,
  lastName: data.last_name,
  position: data.position,
  expiresAt: data.expires_at,
});

export const mapPendingInvitationResponse = (
  data: SchoolInvitationResponse,
): PendingInvitation => {
  return {
    employmentAction: knownEnum(EMPLOYMENT_ACTIONS, data.employment_action),
    id: data.id,
    email: data.email,
    roleId: data.role_id,
    roleName: data.role_name ?? "",
    createdBy: data.created_by,
    creatorEmail: data.creator,
    expiresAt: data.expires_at,
    token: data.token,
    firstName: data.first_name,
    lastName: data.last_name,
    position: data.position,
    // The contract names these as open strings; the values are Delivery's.
    mailOutcome: data.mail_outcome as MailOutcome | undefined,
    providerBlock: data.provider_block as MailProviderBlock | undefined,
    addressMark: data.address_mark as EmailAddressMark | undefined,
  };
};

/**
 * A role id goes out only as a plain positive decimal string. Anything else
 * (empty, a rounded JSON number) leaves the field out, so the backend answers
 * 400 with `role_id` in `errors` and the form marks the field (#2511).
 */
function wireRoleId(roleId: string | undefined): string | undefined {
  return roleId !== undefined && /^[1-9]\d*$/.test(roleId) ? roleId : undefined;
}

/** The body of POST /auth/invitations, in the contract's field names. */
export const toCreateInvitationBody = (
  data: CreateInvitationRequest,
): CreateSchoolInvitationRequest => {
  const roleId = wireRoleId(data.roleId);
  return {
    email: data.email,
    ...(roleId === undefined ? {} : { role_id: roleId }),
    first_name: data.firstName,
    last_name: data.lastName,
    position: data.position,
    gender: data.gender,
    employment_action: data.employmentAction,
    reset_master_data: data.resetMasterData,
    reset_qualifications: data.resetQualifications,
    reset_work_time: data.resetWorkTime,
  };
};

/**
 * The parts of a former employment the backend names (ADR 0021): what a
 * Wiederaufnahme brings back and what never returns.
 */
export const FORMER_EMPLOYMENT_PART_LABELS = {
  master_data: "Stammdaten",
  qualifications: "Qualifikationen",
  work_time: "Stundenkonto, Urlaub und Arbeitszeitmodell",
  past_shifts_and_absences: "vergangene Schichten und Abwesenheiten",
  staff_documents: "Dokumente",
  future_shifts_and_absences: "künftige Schichten und Abwesenheiten",
  groups_classes_substitutions: "Gruppen, Klassen und Vertretungen",
} as const;

export type FormerEmploymentPart = keyof typeof FORMER_EMPLOYMENT_PART_LABELS;

/**
 * The former employment an invitation to an address would continue at this
 * school (ADR 0021, #3402). Dates are calendar days ("YYYY-MM-DD"): the days
 * the person was entered in moto and left.
 */
export interface FormerEmployment {
  startedOn: string;
  endedOn: string;
  resumes: FormerEmploymentPart[];
  notReturning: FormerEmploymentPart[];
}

export interface BackendFormerEmployment {
  started_on: string;
  ended_on: string;
  resumes: string[];
  not_returning: string[];
}

const isFormerEmploymentPart = (part: string): part is FormerEmploymentPart =>
  Object.hasOwn(FORMER_EMPLOYMENT_PART_LABELS, part);

/** A part key this frontend does not know yet is left out, not shown raw. */
export const mapFormerEmploymentResponse = (
  data: BackendFormerEmployment | null | undefined,
): FormerEmployment | null =>
  data
    ? {
        startedOn: data.started_on,
        endedOn: data.ended_on,
        resumes: data.resumes.filter(isFormerEmploymentPart),
        notReturning: data.not_returning.filter(isFormerEmploymentPart),
      }
    : null;
