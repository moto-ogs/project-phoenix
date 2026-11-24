import type * as guardiansContract from "~/lib/contract/guardians.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import {
  type EmailAddressMark,
  knownMailOutcome,
  knownMailProviderBlock,
  type MailOutcome,
  type MailProviderBlock,
} from "~/lib/email-delivery-status";
import { bffJson } from "./bff-fetch";
// Guardian API Client
// Calls Next.js API routes which proxy to the Go backend

import type {
  Guardian,
  GuardianWithRelationship,
  GuardianFormData,
  StudentGuardianLinkRequest,
  PhoneType,
  GuardianRole,
} from "./guardian-helpers";
import {
  mapGuardianPickerResponse,
  mapGuardianWithRelationshipResponse,
  mapStudentGuardianLinkToBackend,
} from "./guardian-helpers";

/**
 * Map frontend guardian form data to backend request format.
 * Only includes fields that are defined in the input.
 */
function mapGuardianFormToBackend(
  data: Partial<GuardianFormData>,
): guardiansContract.GuardianUpdateRequest {
  const result: guardiansContract.GuardianUpdateRequest = {};

  if (data.firstName) result.first_name = data.firstName;
  if (data.lastName) result.last_name = data.lastName;
  if (data.email !== undefined) result.email = data.email;
  if (data.addressStreet !== undefined)
    result.address_street = data.addressStreet;
  if (data.addressCity !== undefined) result.address_city = data.addressCity;
  if (data.addressPostalCode !== undefined)
    result.address_postal_code = data.addressPostalCode;
  if (data.preferredContactMethod)
    result.preferred_contact_method = data.preferredContactMethod;
  if (data.languagePreference)
    result.language_preference = data.languagePreference;
  if (data.notes !== undefined) result.notes = data.notes;

  return result;
}

// Guardian API Client Functions

/**
 * Fetch all guardians for a student
 */
export async function fetchStudentGuardians(
  studentId: string,
): Promise<GuardianWithRelationship[]> {
  const links = await bffJson(
    "tenant",
    "GET /api/guardians/students/{studentId}/guardians",
    { params: { studentId }, errorMessage: "Failed to fetch guardians" },
  );
  return links.flatMap((link) => {
    const mapped = mapGuardianWithRelationshipResponse(link);
    return mapped ? [mapped] : [];
  });
}

const SEND_BLOCKS = [
  "address",
  "delayed",
  "stopped",
  "departed",
  "provider",
  "provider_unknown",
] as const;
type GuardianSendBlock = (typeof SEND_BLOCKS)[number];
const ADDRESS_MARKS: readonly EmailAddressMark[] = ["failed", "complained"];

/** What the school knows about mail to one guardian's address (#5934). */
export interface GuardianEmailState {
  readonly mailOutcome?: MailOutcome;
  readonly addressMark?: EmailAddressMark;
  /** The school stopped mail to this person; a mark stays beside it. */
  readonly emailsStopped?: boolean;
  /** Another holder of the address carries no stop: mail to it still goes out. */
  readonly stopShared?: boolean;
  readonly providerBlock?: MailProviderBlock;
  /** Why a new invitation would change nothing. */
  readonly sendBlock?: GuardianSendBlock;
  readonly outcomeAt?: string;
}

/** The mail state of every guardian of a student, keyed by guardian ID. */
export async function fetchStudentGuardianEmailStates(
  studentId: string,
): Promise<Record<string, GuardianEmailState>> {
  const lines = await bffJson(
    "tenant",
    "GET /api/guardians/students/{studentId}/email-status",
    {
      params: { studentId },
      errorMessage: "Failed to fetch the guardian email status",
    },
  );
  const states: Record<string, GuardianEmailState> = {};
  for (const line of lines) {
    states[line.guardian_profile_id] = {
      mailOutcome: knownMailOutcome(line.mail_outcome),
      addressMark: knownEnum(ADDRESS_MARKS, line.address_mark),
      emailsStopped: line.emails_stopped,
      stopShared: line.stop_shared,
      providerBlock: knownMailProviderBlock(line.provider_block),
      sendBlock: knownEnum(SEND_BLOCKS, line.send_block),
      outcomeAt: line.outcome_at,
    };
  }
  return states;
}

/** The school stops mail to this person, whatever address they hold later. */
export async function stopGuardianEmails(guardianId: string): Promise<void> {
  await bffJson("tenant", "POST /api/guardians/{id}/email-stop", {
    params: { id: guardianId },
    errorMessage: "Failed to stop the guardian emails",
  });
}

/** The school takes its stop back. */
export async function resumeGuardianEmails(guardianId: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/guardians/{id}/email-stop", {
    params: { id: guardianId },
    errorMessage: "Failed to resume the guardian emails",
  });
}

/** Someone checked the address after a mail bounced. */
export async function liftGuardianEmailBlock(
  guardianId: string,
): Promise<void> {
  await bffJson("tenant", "DELETE /api/guardians/{id}/email-block", {
    params: { id: guardianId },
    errorMessage: "Failed to lift the guardian email block",
  });
}

/** One number of the staff form's phone list; without `id` it is new. */
export interface GuardianEntryPhone {
  id?: string;
  phoneNumber: string;
  phoneType: PhoneType | undefined;
  label?: string;
  isPrimary: boolean;
}

/**
 * Saves the staff form of a child's guardian in one request: profile, this
 * child's link and the full phone list, against the version the list read
 * (ADR 0311). A changed guardian is refused with general.changed_since_read
 * and nothing is written. Answers the stored row with its new version.
 */
export async function saveStudentGuardian(
  studentId: string,
  guardianId: string,
  entry: {
    guardian: Partial<GuardianFormData>;
    relationship: Partial<StudentGuardianLinkRequest>;
    phoneNumbers?: readonly GuardianEntryPhone[];
  },
  expectedVersion: string,
): Promise<GuardianWithRelationship | null> {
  const saved = await bffJson(
    "tenant",
    "PUT /api/guardians/students/{studentId}/guardians/{guardianId}",
    {
      params: { studentId, guardianId },
      body: {
        guardian: mapGuardianFormToBackend(entry.guardian),
        relationship: mapRelationshipUpdateToBackend(entry.relationship),
        phone_numbers: entry.phoneNumbers?.map((phone) => ({
          id: phone.id,
          phone_number: phone.phoneNumber,
          phone_type: phone.phoneType,
          label: phone.label,
          is_primary: phone.isPrimary,
        })),
        expected_version: expectedVersion,
      },
      errorMessage: "Failed to save guardian",
    },
  );
  return mapGuardianWithRelationshipResponse(saved);
}

/**
 * Delete a guardian profile.
 *
 * By default this is a guarded delete: the backend refuses (409) a guardian
 * that is still linked to any student. Pass `{ force: true }` to perform the
 * deliberate full delete that also removes every student link — the backend
 * restricts that to administrators (403 otherwise). On any non-OK response a
 * {@link ApiError} carrying the HTTP status is thrown so the caller can
 * branch on 409 / 403.
 */
export async function deleteGuardian(
  guardianId: string,
  opts: { force?: boolean; expectedAffectedLinkIds?: readonly string[] } = {},
): Promise<void> {
  await bffJson("tenant", "DELETE /api/guardians/{id}", {
    params: { id: guardianId },
    query: {
      force: opts.force ? "true" : undefined,
      expected_link_ids: opts.expectedAffectedLinkIds,
    },
    errorMessage: "Failed to delete guardian",
  });
}

/** Read-only preview of what a full guardian delete would affect. */
export interface GuardianDeletePreview {
  /** How many students are still linked to the guardian. */
  linkedCount: number;
  /** Full names of the affected children. */
  affectedNames: string[];
  /** Relationship row IDs the server will compare on confirm. */
  affectedLinkIds: string[];
  /** Ready-to-show German warning describing the blast radius. */
  warning: string;
}

/**
 * Fetch the blast radius of a full guardian delete WITHOUT deleting anything.
 *
 * Backs the admin "Komplett löschen" confirmation: the modal shows
 * {@link GuardianDeletePreview.warning} (which children would lose the
 * guardian) before the user confirms the force delete. Admin-only on the
 * backend (403 otherwise), exposed via {@link ApiError}.
 */
export async function fetchGuardianDeletePreview(
  guardianId: string,
): Promise<GuardianDeletePreview> {
  const preview = await bffJson(
    "tenant",
    "GET /api/guardians/{id}/delete-preview",
    {
      params: { id: guardianId },
      errorMessage: "Failed to load delete preview",
    },
  );
  return {
    linkedCount: preview.linked_count,
    affectedNames: preview.affected_names ?? [],
    affectedLinkIds: preview.affected_link_ids ?? [],
    warning: preview.warning,
  };
}

/**
 * Link a guardian to a student
 */
export async function linkGuardianToStudent(
  studentId: string,
  linkData: StudentGuardianLinkRequest,
): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/guardians/students/{studentId}/guardians",
    {
      params: { studentId },
      body: mapStudentGuardianLinkToBackend(linkData),
      errorMessage: "Failed to link guardian",
    },
  );
}

/**
 * One guardian to create and link to an existing student in a single atomic
 * request. This flow always creates a NEW profile; the sibling/existing-guardian
 * case is handled separately by {@link linkGuardianToStudent} via the picker.
 */
export interface NewStudentGuardianInput {
  firstName: string;
  lastName: string;
  email?: string;
  addressStreet?: string;
  addressCity?: string;
  addressPostalCode?: string;
  languagePreference?: string;
  notes?: string;
  relationshipType: string;
  guardianRole?: GuardianRole;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  canPickup: boolean;
  pickupNotes?: string;
  emergencyPriority: number;
  phoneNumbers?: Array<{
    phoneNumber: string;
    phoneType: PhoneType | undefined;
    label?: string;
    isPrimary: boolean;
  }>;
}

/**
 * Atomically create one or more guardians for an existing student.
 *
 * The backend creates every guardian profile, links it to the student, and adds
 * its phone numbers inside ONE transaction (#819). Any failure rolls the whole
 * batch back server-side, so there are no orphaned profiles and the client needs
 * no compensating delete (which a non-admin supervisor could not perform once a
 * guardian had lost its links). Bad input (e.g. a duplicate email) comes back as
 * a 400; the shared error display shows the catalog text for its code.
 */
export async function createStudentGuardians(
  studentId: string,
  guardians: NewStudentGuardianInput[],
): Promise<void> {
  const body = {
    guardians: guardians.map((g) => ({
      first_name: g.firstName,
      last_name: g.lastName,
      email: g.email,
      address_street: g.addressStreet,
      address_city: g.addressCity,
      address_postal_code: g.addressPostalCode,
      language_preference: g.languagePreference,
      notes: g.notes,
      relationship_type: g.relationshipType,
      guardian_role: g.guardianRole,
      is_primary: g.isPrimary,
      is_emergency_contact: g.isEmergencyContact,
      can_pickup: g.canPickup,
      pickup_notes: g.pickupNotes,
      emergency_priority: g.emergencyPriority,
      phone_numbers: g.phoneNumbers?.map((p) => ({
        phone_number: p.phoneNumber,
        phone_type: p.phoneType,
        label: p.label,
        is_primary: p.isPrimary,
      })),
    })),
  };

  await bffJson(
    "tenant",
    "POST /api/guardians/students/{studentId}/guardians/batch",
    { params: { studentId }, body, errorMessage: "Failed to create guardians" },
  );
}

/** The link fields of the staff form that are defined. */
function mapRelationshipUpdateToBackend(
  updates: Partial<StudentGuardianLinkRequest>,
): guardiansContract.StudentGuardianUpdateRequest {
  const backendData: guardiansContract.StudentGuardianUpdateRequest = {};

  if (updates.relationshipType !== undefined) {
    backendData.relationship_type = updates.relationshipType;
  }
  if (updates.guardianRole !== undefined) {
    backendData.guardian_role = updates.guardianRole;
  }
  if (updates.isPrimary !== undefined) {
    backendData.is_primary = updates.isPrimary;
  }
  if (updates.isEmergencyContact !== undefined) {
    backendData.is_emergency_contact = updates.isEmergencyContact;
  }
  if (updates.canPickup !== undefined) {
    backendData.can_pickup = updates.canPickup;
  }
  if (updates.pickupNotes !== undefined) {
    backendData.pickup_notes = updates.pickupNotes;
  }
  if (updates.emergencyPriority !== undefined) {
    backendData.emergency_priority = updates.emergencyPriority;
  }

  return backendData;
}

/**
 * Remove a guardian from a student
 */
export async function removeGuardianFromStudent(
  studentId: string,
  guardianId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/guardians/students/{studentId}/guardians/{guardianId}",
    {
      params: { studentId, guardianId },
      errorMessage: "Failed to remove guardian",
    },
  );
}

// Outcome returned by the unified invite resolve, mirroring the backend.
type InviteGuardianOutcome =
  | "linked_existing_account"
  | "already_linked"
  | "invited"
  | "pending_approval"
  | "existing_contact_restricted";

// `mail_held`: the access exists, but no mail will reach the person.
// `existing_role`: the current role for existing_contact_restricted, so the UI
// can name it in the upgrade confirmation (#2172).
export type InviteGuardianResult = guardiansContract.inviteToStudentResponse & {
  outcome: InviteGuardianOutcome;
};

/**
 * Invite a guardian to a student by email. For a guardian whose info is already
 * on file (no account yet), pass their on-file email — the backend resolves the
 * existing profile and sends the invite without creating a duplicate. Staff
 * path: invites act immediately (no approval queue).
 */
export async function inviteGuardianToStudent(
  studentId: string,
  email: string,
  options?: {
    firstName?: string;
    lastName?: string;
    relationshipType?: string;
    confirmRoleUpgrade?: boolean;
  },
): Promise<InviteGuardianResult> {
  const result = await bffJson(
    "tenant",
    "POST /api/guardians/students/{studentId}/invite",
    {
      params: { studentId },
      body: {
        email,
        first_name: options?.firstName ?? "",
        last_name: options?.lastName ?? "",
        relationship_type: options?.relationshipType ?? "",
        // Only sent when confirming an upgrade; a plain invite keeps the
        // historical four-field body.
        ...(options?.confirmRoleUpgrade ? { confirm_role_upgrade: true } : {}),
      },
      errorMessage: "Failed to invite guardian",
    },
  );
  return { ...result, outcome: result.outcome as InviteGuardianOutcome };
}

// Hard ceiling on guardian picker results, requested explicitly so the picker
// doesn't silently ride on whatever the backend's default page size happens to
// be. The backend clamps to the same value (maxGuardianPickerResults); keep the
// two in sync. The picker uses it to detect "the list was capped" — when a
// search returns exactly this many rows, more may exist and the user should
// narrow their query rather than assume the person isn't there (#1513).
export const GUARDIAN_PICKER_RESULT_LIMIT = 50;

/**
 * Search for existing guardians (for linking)
 */
export async function searchGuardians(query: string): Promise<Guardian[]> {
  const page = await bffJson("tenant", "GET /api/guardians/search", {
    query: { q: query, page_size: GUARDIAN_PICKER_RESULT_LIMIT },
    errorMessage: "Failed to search guardians",
  });
  return page.data.map(mapGuardianPickerResponse);
}

// ============================================================================
// Guardian invitation approval queue (parent-initiated invites)
// ============================================================================

// Staff-facing approval-queue row.
export interface PendingApproval {
  id: string;
  guardianProfileId: string;
  guardianName: string;
  guardianEmail?: string;
  studentId?: string;
  studentName?: string;
  requestedByEmail?: string;
  createdAt: string;
  expiresAt: string;
  // Approving this request also upgrades an existing restrictive contact
  // link to full portal access (#2172).
  roleUpgrade: boolean;
}

function mapPendingApproval(
  data: guardiansContract.pendingApprovalResponse,
): PendingApproval {
  return {
    id: data.id,
    guardianProfileId: data.guardian_profile_id,
    guardianName: data.guardian_name,
    guardianEmail: data.guardian_email,
    studentId: data.student_id,
    studentName: data.student_name,
    requestedByEmail: data.requested_by_email,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
    roleUpgrade: data.role_upgrade,
  };
}

/** List parent-initiated guardian invitations awaiting staff approval. */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const rows = await bffJson(
    "tenant",
    "GET /api/guardians/invitations/pending-approval",
    { errorMessage: "Failed to load approvals" },
  );
  return rows.map(mapPendingApproval);
}

/** Approve a pending parent-initiated invitation. */
export async function approveGuardianInvitation(
  invitationId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/guardians/invitations/{invitationId}/approve",
    { params: { invitationId }, errorMessage: "Failed to approve invitation" },
  );
}

/** Reject a pending parent-initiated invitation. */
export async function rejectGuardianInvitation(
  invitationId: string,
): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/guardians/invitations/{invitationId}/reject",
    { params: { invitationId }, errorMessage: "Failed to reject invitation" },
  );
}
