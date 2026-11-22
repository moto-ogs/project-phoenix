import { ApiError, enrichApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as authAccountsContract from "./contract/auth-accounts.generated";

export interface BlockerSupervision {
  id: string;
  groupName: string;
  startDate: string;
}

export interface BlockerSubstitution {
  id: string;
  groupName: string;
  startDate: string;
  endDate: string;
}

export interface BlockerActivity {
  id: string;
  activityId: string;
  activityName: string;
  isPrimary: boolean;
}

export interface BlockerGroup {
  id: string;
  groupId: string;
  groupName: string;
  teacherId: string;
  teacherIds: string[];
}

export interface CaregiverCapabilityState {
  accountId: string;
  email: string;
  firstName: string;
  lastName: string;
  personId: string | null;
  staffId: string | null;
  teacherId: string | null;
  hasAdminRole: boolean;
  hasUserRole: boolean;
  hasPerson: boolean;
  hasStaff: boolean;
  hasTeacher: boolean;
  hasCaregiverProfile: boolean;
  isActiveCaregiver: boolean;
  disableBlocked: boolean;
  disableBlockers: string[];
  activeSupervisions: BlockerSupervision[];
  activeSubstitutions: BlockerSubstitution[];
  activitySupervisions: BlockerActivity[];
  groupAssignments: BlockerGroup[];
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function translateCapabilityBlocker(
  blocker: string,
  state?: authAccountsContract.CaregiverCapabilityState,
): string {
  switch (blocker) {
    case "missing_usable_role":
      return "Ohne Betreuerfähigkeit bliebe dem Konto keine nutzbare Systemrolle.";
    case "active_group_supervisions":
      if (!state) {
        return "Aktive Gruppenaufsichten";
      }
      return formatCount(
        state?.active_supervisions?.length ?? 0,
        "aktive Gruppenaufsicht",
        "aktive Gruppenaufsichten",
      );
    case "active_group_substitutions":
      if (!state) {
        return "Aktive Gruppenübergaben";
      }
      return formatCount(
        state?.active_substitutions?.length ?? 0,
        "aktive Gruppenübergabe",
        "aktive Gruppenübergaben",
      );
    case "activity_supervisions":
      if (!state) {
        return "Aktivitätsleitungen";
      }
      return formatCount(
        state?.activity_supervisions?.length ?? 0,
        "Aktivitätsleitung",
        "Aktivitätsleitungen",
      );
    case "group_assignments":
      if (!state) {
        return "Stammgruppen-Zuordnungen";
      }
      return formatCount(
        state?.group_assignments?.length ?? 0,
        "Stammgruppen-Zuordnung",
        "Stammgruppen-Zuordnungen",
      );
    default:
      return blocker;
  }
}

export class CaregiverCapabilityApiError extends ApiError {
  status: number;
  blockers: string[];

  constructor(message: string, status: number, blockers: string[] = []) {
    super(message, status);
    this.name = "CaregiverCapabilityApiError";
    this.status = status;
    this.blockers = blockers;
  }
}

function mapCapabilityState(
  state: authAccountsContract.CaregiverCapabilityState,
): CaregiverCapabilityState {
  return {
    accountId: state.account_id,
    email: state.email,
    firstName: state.first_name,
    lastName: state.last_name,
    personId: state.person_id ?? null,
    staffId: state.staff_id ?? null,
    teacherId: state.teacher_id ?? null,
    hasAdminRole: state.has_admin_role,
    hasUserRole: state.has_user_role,
    hasPerson: state.has_person,
    hasStaff: state.has_staff,
    hasTeacher: state.has_teacher,
    hasCaregiverProfile: state.has_caregiver_profile,
    isActiveCaregiver: state.is_active_caregiver,
    disableBlocked: state.disable_blocked,
    disableBlockers: (state.disable_blockers ?? []).map((blocker) =>
      translateCapabilityBlocker(blocker, state),
    ),
    activeSupervisions: (state.active_supervisions ?? []).map((s) => ({
      id: s.id,
      groupName: s.group_name,
      startDate: s.start_date,
    })),
    activeSubstitutions: (state.active_substitutions ?? []).map((s) => ({
      id: s.id,
      groupName: s.group_name,
      startDate: s.start_date,
      endDate: s.end_date,
    })),
    activitySupervisions: (state.activity_supervisions ?? []).map((a) => ({
      id: a.id,
      activityId: a.activity_id,
      activityName: a.activity_name,
      isPrimary: a.is_primary,
    })),
    groupAssignments: (state.group_assignments ?? []).map((g) => ({
      id: g.id,
      groupId: g.group_id,
      groupName: g.group_name,
      teacherId: g.teacher_id,
      teacherIds: g.teacher_ids ?? [],
    })),
  };
}

/**
 * A refusal as CaregiverCapabilityApiError: a 409 names the People Directory
 * blockers in its `blockers` extension member, translated for the dialog.
 */
function capabilityError(error: unknown): never {
  if (!(error instanceof ApiError)) throw error;
  const raw = error.problem?.blockers;
  const blockers = Array.isArray(raw)
    ? raw
        .filter((blocker): blocker is string => typeof blocker === "string")
        .map((blocker) => translateCapabilityBlocker(blocker))
    : [];
  throw enrichApiError(
    new CaregiverCapabilityApiError(
      error.detail ?? error.message,
      error.status ?? 500,
      blockers,
    ),
    error.problem,
  );
}

const FAILED = "Betreuung konnte nicht geändert werden";

function tenant(
  answer: Promise<authAccountsContract.CaregiverCapabilityState>,
): Promise<CaregiverCapabilityState> {
  return answer.then(mapCapabilityState, capabilityError);
}

// The operator routes carry no answer type in their contract (`z.unknown()`);
// Go answers with the same CaregiverCapabilityState as the tenant route.
function operator(answer: Promise<unknown>): Promise<CaregiverCapabilityState> {
  return answer.then(
    (state) =>
      mapCapabilityState(
        state as authAccountsContract.CaregiverCapabilityState,
      ),
    capabilityError,
  );
}

class CaregiverCapabilityService {
  getTenantAccountCapability(accountId: string) {
    return tenant(
      bffJson("tenant", "GET /auth/accounts/{accountId}/caregiver-capability", {
        params: { accountId },
        errorMessage: FAILED,
      }),
    );
  }

  enableTenantAccountCapability(
    accountId: string,
    body: authAccountsContract.EnableCaregiverCapabilityRequest,
  ) {
    return tenant(
      bffJson(
        "tenant",
        "POST /auth/accounts/{accountId}/caregiver-capability",
        { params: { accountId }, body, errorMessage: FAILED },
      ),
    );
  }

  disableTenantAccountCapability(accountId: string) {
    return tenant(
      bffJson(
        "tenant",
        "DELETE /auth/accounts/{accountId}/caregiver-capability",
        { params: { accountId }, errorMessage: FAILED },
      ),
    );
  }

  getOperatorAccountCapability(schoolId: string, accountId: string) {
    return operator(
      bffJson(
        "platform",
        "GET /operator/schools/{id}/accounts/{accountId}/caregiver-capability/",
        { params: { id: schoolId, accountId }, errorMessage: FAILED },
      ),
    );
  }

  enableOperatorAccountCapability(
    schoolId: string,
    accountId: string,
    body: authAccountsContract.EnableCaregiverCapabilityRequest,
  ) {
    return operator(
      bffJson(
        "platform",
        "POST /operator/schools/{id}/accounts/{accountId}/caregiver-capability/",
        { params: { id: schoolId, accountId }, body, errorMessage: FAILED },
      ),
    );
  }

  disableOperatorAccountCapability(schoolId: string, accountId: string) {
    return operator(
      bffJson(
        "platform",
        "DELETE /operator/schools/{id}/accounts/{accountId}/caregiver-capability/",
        { params: { id: schoolId, accountId }, errorMessage: FAILED },
      ),
    );
  }
}

export const caregiverCapabilityService = new CaregiverCapabilityService();
