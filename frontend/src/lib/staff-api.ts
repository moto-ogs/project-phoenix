// Staff API service for fetching all staff members and their supervision status

import type * as staffContract from "~/lib/contract/staff.generated";
import type { RoleForm } from "~/lib/position-title";
import { bffJson } from "./bff-fetch";
import type { ActiveGroupResponse } from "~/lib/contract/active.generated";
import { ApiError } from "~/lib/api-error";
import {
  knownMailOutcome,
  type MailOutcome,
} from "~/lib/email-delivery-status";
import type {
  ExternalStaffResponse,
  FormerStaffResponse,
  MinimalStaffProfileResponse,
  ScheduleEntryResponse,
  ScheduleResponse,
  ScheduleUpdateRequest,
  StaffRecordResponse,
  StammdatenResponse,
} from "~/lib/contract/staff.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";
import type { ModelResponse } from "~/lib/contract/work-time-models.generated";
import {
  EXTERNAL_ACCOUNT_STATUS_VALUES,
  ROLE_FORM_VALUES,
} from "~/lib/staff-wire-enums";
import { knownEnum } from "~/lib/contract/known-enum";

/**
 * Adresse des Profilbilds einer Kollegin, `undefined` ohne hochgeladenes Bild
 * (#4432). Das Bild kommt über die schulbezogene Staff-Route, nie über den
 * gespeicherten Pfad selbst. Jeder Upload bekommt einen neuen Dateinamen;
 * als `v` macht er die Adresse pro Bild eindeutig, sodass der Browser sie
 * ohne erneutes Laden wiederverwenden darf.
 */
export function staffAvatarUrl(
  staffId: string,
  avatar: string | null | undefined,
): string | undefined {
  if (!avatar) return undefined;
  const version = avatar.split("/").pop();
  const base = `/api/staff/${staffId}/avatar`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

/**
 * A staff record as the contract delivers it (#7563): the person nested,
 * ids as decimal strings. The external caregiver writes answer the same
 * record without the teacher fields.
 */
type StaffRecord = StaffRecordResponse | ExternalStaffResponse;

/**
 * Account state of an external caregiver (#4573): `account` signs in,
 * `invitation_pending` has an unused invitation, `none` has neither. `none`
 * is a deliberate state (Kein Zugang), not a gap (ADR 0091).
 */
export type ExternalAccountStatus = "account" | "invitation_pending" | "none";

/**
 * Access chosen for an external caregiver (ADR 0091): `none` records a
 * placeholder without account, `view` invites into the system role „Gast“,
 * `supervise` into „AG-Leitung“.
 */
export type ExternalAccess = "none" | "view" | "supervise";

/** The two levels an invitation can grant. */
export type ExternalInvitationAccess = Exclude<ExternalAccess, "none">;

// Individual supervision entry for a staff member
interface StaffSupervision {
  roomId: string;
  roomName: string;
  activeGroupId: string;
}

// Frontend types
export interface Staff {
  startedOn?: string;
  endedOn?: string | null;
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string;
  /** Profilbild über `/api/staff/[id]/avatar`, fehlt ohne Bild (#4432). */
  avatarUrl?: string;
  role?: string; // Display role (custom position from teacher profile)
  roleForm?: RoleForm; // Form der Position aus den Stammdaten
  accountRole?: string; // Auth role (Admin/Betreuer/Extern)
  specialization?: string;
  qualifications?: string;
  staffNotes?: string;
  employmentType?: string; // full_time, part_time, minijob
  hasRfid: boolean;
  isTeacher: boolean;
  // Supervision status
  isSupervising: boolean;
  currentLocation?: string;
  supervisionRole?: string;
  supervisions: StaffSupervision[]; // Array of active supervisions
  wasPresentToday?: boolean;
  // Time-tracking
  workStatus?: string;
  absenceType?: string;
  /** The school's own Abwesenheitsart wording, "" for a standard type (#2403). */
  absenceTypeLabel?: string;
  /** Geplanter letzter Arbeitstag, "YYYY-MM-DD" (#4809). */
  plannedExitDate?: string;
  isFinancialProfile?: boolean;
  isLimitedProfile?: boolean;
  /** Externe Betreuungskraft, mit oder ohne moto-Konto (#3823, #4573). */
  isExternal?: boolean;
  /** Organisation der externen Kraft, z. B. die Musikschule. */
  externalOrganization?: string;
  /** Kontostand der externen Kraft; `null` für alle anderen (#4573). */
  externalAccountStatus?: ExternalAccountStatus | null;
}

/**
 * An external caregiver to record (#3823, ADR 0091). The email address is
 * only sent with an access that invites.
 */
interface ExternalStaffInput {
  firstName: string;
  lastName: string;
  access: ExternalAccess;
  email?: string;
  organization?: string;
  /** Stammdaten gender; left out when nobody chose one. */
  gender?: StammdatenGender;
}

interface StaffFilters {
  status?: "all" | "supervising" | "available";
  type?: "all" | "teachers" | "staff";
}

export interface StaffDocumentDirectoryEntry {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
}

/**
 * A former employment at this school, the Ehemalige filter of the staff list
 * (ADR 0021, #3403). Dates are calendar days ("YYYY-MM-DD"): the days the
 * person was entered in moto and left.
 */
export interface FormerStaff {
  id: string;
  firstName: string;
  lastName: string;
  startedOn: string;
  endedOn: string;
}

/**
 * Builds a map of staff_id to their supervised groups for O(1) lookup
 */
/** A group a staff member supervises right now, with the role there. */
interface SupervisedGroupEntry {
  group: ActiveGroupResponse;
  role?: string;
}

function buildStaffGroupsMap(
  activeGroups: readonly ActiveGroupResponse[],
): Record<string, SupervisedGroupEntry[]> {
  const map: Record<string, SupervisedGroupEntry[]> = {};
  for (const group of activeGroups) {
    for (const supervisor of group.supervisors ?? []) {
      map[supervisor.staff_id] ??= [];
      map[supervisor.staff_id]!.push({ group, role: supervisor.role });
    }
  }
  return map;
}

/** Absence type label mapping */
const absenceLabels: Record<string, string> = {
  sick: "Krank",
  vacation: "Urlaub",
  training: "Fortbildung",
  comp_time: "Freizeitausgleich",
  other: "Abwesend", // Shows red, same as "not clocked in"
};

/**
 * Determines location and supervision info for a staff member.
 *
 * Badge shows time clock status. Absence only shown when NOT clocked in.
 * Supervisions are returned separately as an array of rooms.
 *
 * Priority for currentLocation (badge):
 * 1. Time clock present → "Anwesend" (green)
 * 2. Time clock home_office → "Homeoffice" (blue)
 * 3. Not clocked in + absence → "Krank"/"Urlaub"/"Fortbildung" (gray), "other" → "Abwesend" (red)
 * 4. Legacy fallback (no work_status) → "Anwesend"
 * 5. Not clocked in, no absence → "Abwesend" (red)
 */
function getSupervisionInfo(
  staffId: string | undefined,
  staffGroupsMap: Record<string, SupervisedGroupEntry[]>,
  wasPresentToday?: boolean,
  workStatus?: string,
  absenceType?: string,
): {
  isSupervising: boolean;
  currentLocation: string;
  supervisionRole?: string;
  supervisions: StaffSupervision[];
} {
  // Build supervisions array (independent of time clock status)
  const supervisedGroups = staffId ? staffGroupsMap[staffId] : undefined;
  const supervisions: StaffSupervision[] = [];
  let supervisionRole: string | undefined;
  let isSupervising = false;

  if (supervisedGroups) {
    isSupervising = true;
    for (const { group, role } of supervisedGroups) {
      if (group.room) {
        supervisions.push({
          roomId: group.room.id,
          roomName: group.room.name,
          activeGroupId: group.id,
        });
      }
      supervisionRole ??= role;
    }
  }

  // Determine badge location (time clock status only)
  let currentLocation: string;

  // Priority 1: Time clock present → always wins
  if (workStatus === "present") {
    currentLocation = "Anwesend";
  }
  // Priority 2: Time clock home office → always wins
  else if (workStatus === "home_office") {
    currentLocation = "Unterwegs";
  }
  // Priority 3: Not clocked in - check for absence reason
  // (checked_out, no work_status, or legacy fallback)
  else if (absenceType && absenceLabels[absenceType]) {
    // Absence provides more detail on WHY they're absent
    currentLocation = absenceLabels[absenceType];
  }
  // Priority 4: Legacy fallback (only if NO work_status and NO absence)
  else if (wasPresentToday && !workStatus) {
    currentLocation = "Anwesend";
  }
  // Priority 5: Not present (checked out or never clocked in, no absence)
  else {
    currentLocation = "Abwesend";
  }

  return { isSupervising, currentLocation, supervisionRole, supervisions };
}

/** First and last name of a record's person, empty without a person. */
function personNames(staff: StaffRecord) {
  const firstName = staff.person?.first_name ?? "";
  const lastName = staff.person?.last_name ?? "";
  return {
    name: staff.person ? `${firstName} ${lastName}` : "",
    firstName,
    lastName,
  };
}

/** The teacher fields; the external caregiver writes answer without them. */
function teacherFields(staff: StaffRecord): Partial<StaffRecordResponse> {
  return staff;
}

/** The fields the staff list and the record header share. */
function mapStaffFields(staff: StaffRecord) {
  const teacher = teacherFields(staff);
  return {
    ...personNames(staff),
    email: undefined,
    role: teacher.role,
    roleForm: knownEnum(ROLE_FORM_VALUES, teacher.role_form),
    accountRole: staff.account_role,
    specialization: teacher.specialization?.trim(),
    qualifications: teacher.qualifications,
    staffNotes: staff.staff_notes,
    hasRfid: !!staff.person?.tag_id,
    isTeacher: !!teacher.teacher_id,
    wasPresentToday: staff.was_present_today,
    workStatus: staff.work_status,
    absenceType: staff.absence_type,
    absenceTypeLabel: staff.absence_type_label,
    isExternal: staff.is_external,
    externalOrganization: staff.external_organization,
    externalAccountStatus:
      knownEnum(
        EXTERNAL_ACCOUNT_STATUS_VALUES,
        staff.external_account_status,
      ) ?? null,
    plannedExitDate: staff.planned_exit_date,
  };
}

/**
 * Maps a staff record of the contract to the frontend Staff type
 */
function mapStaffMember(
  staff: StaffRecord,
  staffGroupsMap: Record<string, SupervisedGroupEntry[]>,
): Staff {
  const { isSupervising, currentLocation, supervisionRole, supervisions } =
    getSupervisionInfo(
      staff.id,
      staffGroupsMap,
      staff.was_present_today,
      staff.work_status,
      staff.absence_type,
    );

  return {
    ...mapStaffFields(staff),
    id: staff.id,
    isSupervising,
    currentLocation,
    supervisionRole,
    supervisions,
  };
}

/**
 * Applies client-side filters to staff list
 */
function applyStaffFilters(staff: Staff[], filters?: StaffFilters): Staff[] {
  let result = staff;

  if (filters?.status === "supervising") {
    result = result.filter((s) => s.isSupervising);
  } else if (filters?.status === "available") {
    result = result.filter((s) => !s.isSupervising);
  }

  if (filters?.type === "teachers") {
    result = result.filter((s) => s.isTeacher);
  } else if (filters?.type === "staff") {
    result = result.filter((s) => !s.isTeacher);
  }

  return result;
}

/**
 * Fetches active groups data, returning empty array on failure. Deliberately
 * quiet: the groups only add the current location to each staff row, and the
 * staff list itself must not fail because the location could not be read.
 */
async function fetchActiveGroups(): Promise<ActiveGroupResponse[]> {
  try {
    return await bffJson("tenant", "GET /api/active/groups/", {
      query: { active: true },
    });
  } catch (error) {
    // Wer laufende Aufsichten nicht lesen darf, sieht die Liste ohne sie; das
    // ist eine Verweigerung, kein Ausfall. Jeder andere Fehler bleibt einer,
    // sonst stünde das ganze Personal ohne Aufsicht da (#2353).
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return [];
    }
    throw error;
  }
}

/** Kopf der Personalakte aus dem Datensatz von GET /api/staff/{id}. */
export function mapStaffRecord(staff: StaffRecordResponse): Staff {
  const { currentLocation, supervisionRole } = getSupervisionInfo(
    staff.id,
    {},
    staff.was_present_today,
    staff.work_status,
    staff.absence_type,
  );
  return {
    ...mapStaffFields(staff),
    id: staff.id,
    startedOn: staff.started_on ?? undefined,
    endedOn: staff.ended_on,
    avatarUrl: staffAvatarUrl(staff.id, staff.person?.avatar),
    employmentType: staff.employment_type,
    isSupervising: false,
    currentLocation,
    supervisionRole,
    supervisions: [],
  };
}

/** A former employment of the Ehemalige filter (#3403). */
function mapFormerStaff(entry: FormerStaffResponse): FormerStaff {
  return {
    id: entry.id,
    firstName: entry.first_name,
    lastName: entry.last_name,
    startedOn: entry.started_on ?? "",
    endedOn: entry.ended_on ?? "",
  };
}

// Staff service
class StaffService {
  async getDocumentDirectory(): Promise<StaffDocumentDirectoryEntry[]> {
    return bffJson("tenant", "GET /api/staff/documents-directory");
  }

  // Former employments of this school, for the Ehemalige filter (#3403).
  async getFormerStaff(): Promise<FormerStaff[]> {
    const former = await bffJson("tenant", "GET /api/staff/former");
    return former.map(mapFormerStaff);
  }

  // Get all staff members with their current supervision status. A failed
  // read rejects; it never arrives as an empty staff list (#1840, #2353).
  async getAllStaff(filters?: StaffFilters): Promise<Staff[]> {
    const [staffList, activeGroups] = await Promise.all([
      bffJson("tenant", "GET /api/staff/"),
      fetchActiveGroups(),
    ]);
    const staffGroupsMap = buildStaffGroupsMap(activeGroups);

    const mappedStaff = staffList.map((staff) =>
      mapStaffMember(staff, staffGroupsMap),
    );

    return applyStaffFilters(mappedStaff, filters);
  }

  // Records an external caregiver (#3823) with the chosen access (ADR 0091);
  // `view` and `supervise` invite by email. The new entry is selectable
  // right away, with or without account.
  async createExternal(input: ExternalStaffInput): Promise<Staff> {
    const external = await bffJson("tenant", "POST /api/staff/externals", {
      body: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        organization: input.organization?.trim() ?? "",
        access: input.access,
        ...(input.gender ? { gender: input.gender } : {}),
        ...(input.access === "none"
          ? {}
          : { email: input.email?.trim() ?? "" }),
      },
    });
    return mapStaffMember(external, {});
  }

  // Invites an external caregiver who has no account yet (#4573) with the
  // chosen access (ADR 0091). A second invitation replaces an open one, for
  // example with a corrected address.
  async inviteExternal(
    id: string,
    email: string,
    access: ExternalInvitationAccess,
  ): Promise<Staff> {
    const external = await bffJson(
      "tenant",
      "POST /api/staff/externals/{id}/invitation",
      { params: { id }, body: { email: email.trim(), access } },
    );
    return mapStaffMember(external, {});
  }

  // Rohdaten von GET /api/staff/{id}. Kopf der Personalakte (mapStaffRecord)
  // und Konto-Reiter leiten ihre Abbildungen aus demselben Abruf ab (#4993).
  async getStaffRecord(id: string): Promise<StaffRecordResponse> {
    return bffJson("tenant", "GET /api/staff/{id}", { params: { id } });
  }

  async getFinancialProfile(id: string): Promise<Staff> {
    return minimalProfile(
      await bffJson("tenant", "GET /api/staff/financial-profile/{id}", {
        params: { id },
      }),
      "financial",
    );
  }

  async getDocumentProfile(id: string): Promise<Staff> {
    return minimalProfile(
      await bffJson("tenant", "GET /api/staff/documents-profile/{id}", {
        params: { id },
      }),
      "document",
    );
  }
}

function minimalProfile(
  profile: MinimalStaffProfileResponse,
  profileType: "financial" | "document",
): Staff {
  const { started_on, ended_on, ...name } = profile;
  return {
    ...name,
    startedOn: started_on,
    endedOn: ended_on,
    hasRfid: false,
    isTeacher: false,
    isSupervising: false,
    supervisions: [],
    isFinancialProfile: profileType === "financial",
    isLimitedProfile: true,
  };
}

// Work Schedule types and service
interface ScheduleEntry {
  weekIndex: number;
  dayOfWeek: number;
  targetMinutes: number;
  startTime?: string;
}

interface ScheduleModelInfo {
  id: string;
  name: string;
  rotationLength: number;
  rotationAnchorDate: string;
}

export interface StaffSchedule {
  mode: "template" | "custom";
  model: ScheduleModelInfo | null;
  rotationLength: number;
  rotationAnchorDate: string;
  entries: ScheduleEntry[];
  weeklyTotals: number[];
  // Earliest date on which any version of this schedule was in effect.
  // Anchored as YYYY-MM-DD. Empty string when no schedule rows exist.
  validFrom: string;
  // True while a contract of the Träger keeps the Soll (#4706): the school
  // reads it but changes neither the model nor a Sonderarbeitszeit.
  keptByTraeger?: boolean;
}

const SCHEDULE_MODES: readonly StaffSchedule["mode"][] = ["template", "custom"];

function mapScheduleEntries(
  entries: readonly ScheduleEntryResponse[] | null,
): ScheduleEntry[] {
  return (entries ?? []).map((e) => ({
    weekIndex: e.week_index,
    dayOfWeek: e.day_of_week,
    targetMinutes: e.target_minutes,
    startTime: e.start_time,
  }));
}

function mapScheduleResponse(data: ScheduleResponse): StaffSchedule {
  return {
    mode: knownEnum(SCHEDULE_MODES, data.mode) ?? "custom",
    model: data.model
      ? {
          id: data.model.id,
          name: data.model.name,
          rotationLength: data.model.rotation_length,
          rotationAnchorDate: data.model.rotation_anchor_date,
        }
      : null,
    rotationLength: data.rotation_length,
    rotationAnchorDate: data.rotation_anchor_date,
    entries: mapScheduleEntries(data.entries),
    weeklyTotals: data.weekly_totals ?? [],
    validFrom: (data.valid_from ?? "").slice(0, 10),
    keptByTraeger: data.kept_by_traeger,
  };
}

interface UpdateScheduleCustomRequest {
  mode: "custom";
  rotationLength: number;
  rotationAnchorDate?: string;
  entries: Array<{
    weekIndex: number;
    dayOfWeek: number;
    targetMinutes: number;
    startTime?: string;
  }>;
  saveAsTemplate?: string;
}

interface UpdateScheduleTemplateRequest {
  mode: "template";
  modelId: string;
}

export type UpdateScheduleRequest =
  UpdateScheduleCustomRequest | UpdateScheduleTemplateRequest;

class StaffScheduleService {
  async getSchedule(staffId: string): Promise<StaffSchedule> {
    return mapScheduleResponse(
      await bffJson("tenant", "GET /api/staff/{id}/schedule", {
        params: { id: staffId },
      }),
    );
  }

  async updateSchedule(
    staffId: string,
    update: UpdateScheduleRequest,
  ): Promise<StaffSchedule> {
    const body: ScheduleUpdateRequest =
      update.mode === "template"
        ? { mode: "template", model_id: update.modelId }
        : {
            mode: "custom",
            rotation_length: update.rotationLength,
            rotation_anchor_date: update.rotationAnchorDate,
            entries: update.entries.map((e) => ({
              week_index: e.weekIndex,
              day_of_week: e.dayOfWeek,
              target_minutes: e.targetMinutes,
              start_time: e.startTime,
            })),
            save_as_template: update.saveAsTemplate,
          };
    return mapScheduleResponse(
      await bffJson("tenant", "PUT /api/staff/{id}/schedule", {
        params: { id: staffId },
        body,
      }),
    );
  }
}

// Work Time Models (tenant templates)
interface WorkTimeModelEntry {
  weekIndex: number;
  dayOfWeek: number;
  targetMinutes: number;
  startTime?: string;
}

export interface WorkTimeModel {
  id: string;
  name: string;
  rotationLength: number;
  rotationAnchorDate: string;
  entries: WorkTimeModelEntry[];
  weeklyTotals: number[];
  /** Gesetzt, solange die Schule die Vorlage nicht mehr anbietet (#6891). */
  archivedAt: string | null;
  /** Nur aus `listWithUsage`: so viele Personen erreicht eine Änderung. */
  assignedStaffCount?: number;
}

interface WorkTimeModelInput {
  name: string;
  rotationLength: number;
  rotationAnchorDate: string;
  entries: WorkTimeModelEntry[];
}

function workTimeModelBody(input: WorkTimeModelInput) {
  return {
    name: input.name,
    rotation_length: input.rotationLength,
    rotation_anchor_date: input.rotationAnchorDate,
    entries: input.entries.map((e) => ({
      week_index: e.weekIndex,
      day_of_week: e.dayOfWeek,
      target_minutes: e.targetMinutes,
      ...(e.startTime ? { start_time: e.startTime } : {}),
    })),
  };
}

function mapWorkTimeModel(m: ModelResponse): WorkTimeModel {
  return {
    id: m.id,
    name: m.name,
    rotationLength: m.rotation_length,
    rotationAnchorDate: m.rotation_anchor_date,
    entries: mapScheduleEntries(m.entries),
    weeklyTotals: m.weekly_totals ?? [],
    archivedAt: m.archived_at ?? null,
    ...(m.assigned_staff_count === undefined
      ? {}
      : { assignedStaffCount: m.assigned_staff_count }),
  };
}

/**
 * Was über die Zuordnung einer Vorlage an eine Person entscheidet (#6921).
 * Eine Person ohne Eintrag hat keine Vorlage, kein Soll, keinen Vertrag des
 * Trägers und keinen abgeschlossenen Monat.
 */
export interface StaffWorkTimeFact {
  staffId: string;
  workTimeModelId: string | null;
  /** Es gibt schon ein Soll: ein früheres Startdatum geht dann nicht. */
  hasSchedule: boolean;
  /** Ein laufender Vertrag des Trägers legt das Soll fest. */
  sollKeptByTraeger: boolean;
  /** Letzter abgeschlossener Monat („YYYY-MM“), sonst `null`. */
  closedThrough: string | null;
}

interface WorkTimeModelAssignmentResult {
  assignedStaffIds: string[];
  unchangedStaffIds: string[];
  /** Erster Tag des neuen Solls, „YYYY-MM-DD“. */
  validFrom: string;
}

class WorkTimeModelService {
  async list(): Promise<WorkTimeModel[]> {
    const models = await bffJson("tenant", "GET /api/work-time-models/", {
      errorMessage: "Vorlagen konnten nicht geladen werden",
    });
    return models.map(mapWorkTimeModel);
  }

  /** Für die Katalogseite: archivierte Vorlagen und die Nutzungszahl. */
  async listWithUsage(): Promise<WorkTimeModel[]> {
    const models = await bffJson("tenant", "GET /api/work-time-models/", {
      query: { with_usage: true },
      errorMessage: "Vorlagen konnten nicht geladen werden",
    });
    return models.map(mapWorkTimeModel);
  }

  async create(input: WorkTimeModelInput): Promise<WorkTimeModel> {
    const model = await bffJson("tenant", "POST /api/work-time-models/", {
      body: workTimeModelBody(input),
      errorMessage: "Vorlage konnte nicht angelegt werden",
    });
    return mapWorkTimeModel(model);
  }

  async update(id: string, input: WorkTimeModelInput): Promise<WorkTimeModel> {
    const model = await bffJson("tenant", "PUT /api/work-time-models/{id}", {
      params: { id },
      body: workTimeModelBody(input),
      errorMessage: "Vorlage konnte nicht gespeichert werden",
    });
    return mapWorkTimeModel(model);
  }

  async archive(id: string): Promise<WorkTimeModel> {
    const model = await bffJson(
      "tenant",
      "POST /api/work-time-models/{id}/archive",
      {
        params: { id },
        errorMessage: "Vorlage konnte nicht aus der Auswahl genommen werden",
      },
    );
    return mapWorkTimeModel(model);
  }

  async restore(id: string): Promise<WorkTimeModel> {
    const model = await bffJson(
      "tenant",
      "POST /api/work-time-models/{id}/restore",
      {
        params: { id },
        errorMessage: "Vorlage konnte nicht wieder angeboten werden",
      },
    );
    return mapWorkTimeModel(model);
  }

  /** Für den Zuordnungsdialog: Vorlage, Soll und Sperren je Person. */
  async staffFacts(): Promise<StaffWorkTimeFact[]> {
    const facts = await bffJson(
      "tenant",
      "GET /api/work-time-models/staff-facts",
      { errorMessage: "Die Zuordnungen konnten nicht geladen werden" },
    );
    return facts.map((fact) => ({
      staffId: fact.staff_id,
      workTimeModelId: fact.work_time_model_id,
      hasSchedule: fact.has_schedule,
      sollKeptByTraeger: fact.soll_kept_by_traeger,
      closedThrough: fact.closed_through,
    }));
  }

  /**
   * Ordnet die Vorlage mehreren Personen auf einmal zu. Ohne `validFrom`
   * gilt das neue Soll ab heute.
   */
  async assign(
    id: string,
    staffIds: readonly string[],
    validFrom?: string,
  ): Promise<WorkTimeModelAssignmentResult> {
    const result = await bffJson(
      "tenant",
      "POST /api/work-time-models/{id}/assignments",
      {
        params: { id },
        body: {
          staff_ids: [...staffIds],
          ...(validFrom ? { valid_from: validFrom } : {}),
        },
        errorMessage: "Die Vorlage konnte nicht zugeordnet werden",
      },
    );
    return {
      assignedStaffIds: result.assigned_staff_ids ?? [],
      unchangedStaffIds: result.unchanged_staff_ids ?? [],
      validFrom: result.valid_from,
    };
  }

  async remove(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/work-time-models/{id}", {
      params: { id },
      errorMessage: "Vorlage konnte nicht gelöscht werden",
    });
  }
}

// One session of the staff history: the fields the views read, with the
// enums known and an open block's checkout as null. Metrics can supply only
// intervals; the history also carries the exact identity and recorded
// minutes the correction dialog uses. `net_minutes` already deducts a running
// break (#1842); `pack_up_minutes` and `rounding_minutes` are the credits
// inside it (#6851, #6852). `source`: `app` = self-service Web/App, `nfc` =
// kiosk auto-stamp, `unknown` = pre-migration legacy row (#1368).
export type StaffHistorySession = Pick<
  sharedContract.HistorySessionResponse,
  "date" | "net_minutes" | "check_in_time" | "break_minutes"
> &
  Partial<
    Pick<
      sharedContract.HistorySessionResponse,
      | "id"
      | "auto_checked_out"
      | "notes"
      | "edit_count"
      | "audit_count"
      | "pack_up_minutes"
      | "rounding_minutes"
    >
  > & {
    status?: "present" | "home_office";
    source?: "app" | "nfc" | "unknown";
    check_out_time: string | null;
    breaks?: readonly StaffSessionBreak[] | null;
  };

// A break of a history session; metrics supply only its interval.
type StaffSessionBreak = Pick<sharedContract.WorkSessionBreak, "started_at"> &
  Partial<Pick<sharedContract.WorkSessionBreak, "id" | "duration_minutes">> & {
    ended_at?: string | null;
  };

/** Die Antwort der Verlaufsroute samt Wochensummen und ArbZG-Hinweisen. */
export interface StaffHistoryDetails {
  sessions: StaffHistorySession[];
  weeklySummaries: WeeklySummary[];
  laborDays: WorkDayLaborHint[];
}

const SESSION_STATUSES = ["present", "home_office"] as const;
const SESSION_SOURCES = ["app", "nfc", "unknown"] as const;

class StaffHistoryService {
  async getHistory(
    staffId: string,
    from: string,
    to: string,
  ): Promise<StaffHistorySession[]> {
    return (await this.getHistoryDetails(staffId, from, to)).sessions;
  }

  // Dieselbe Route wie getHistory, mit Wochensummen und Hinweisen zu Pausen
  // und Höchstarbeitszeit (#4804).
  async getHistoryDetails(
    staffId: string,
    from: string,
    to: string,
  ): Promise<StaffHistoryDetails> {
    const history = await bffJson(
      "tenant",
      "GET /api/staff/{id}/time-tracking/history",
      { params: { id: staffId }, query: { from, to } },
    );
    return {
      sessions: (history.sessions ?? []).map((row) => ({
        ...row,
        status: knownEnum(SESSION_STATUSES, row.status),
        source: knownEnum(SESSION_SOURCES, row.source),
        check_out_time: row.check_out_time ?? null,
        breaks: (row.breaks ?? []).filter((item) => item !== null),
      })),
      weeklySummaries: mapWeeklySummaries(history.weekly_summaries),
      laborDays: (history.labor_days ?? []).map(mapWorkDayLaborHint),
    };
  }
}

// An absence of a staff member, as the admin routes answer it and as the
// metrics read it: the generated row, of which the metrics adapter of the
// own time tracking (`adaptAbsenceForMetrics`) fills only what it knows.
export type StaffAbsenceRow = Pick<
  sharedContract.StaffAbsenceResponse,
  | "id"
  | "staff_id"
  | "absence_type"
  | "date_start"
  | "date_end"
  | "half_day"
  | "status"
> &
  Partial<
    Pick<
      sharedContract.StaffAbsenceResponse,
      | "absence_type_id"
      | "absence_type_label"
      | "start_half_day"
      | "end_half_day"
      | "note"
      | "approved_by"
      | "approved_at"
      | "decision_note"
      | "working_days"
      | "requested_at"
      | "duration_days"
    >
  >;

// Eine Zeile des Anfragen-Moduls (#2433): der Antrag plus die Namen, die die
// Liste anzeigt. Leere Namen heißen "Unbekannt" (gelöschtes Konto).
// `updated_at` trägt bei zurückgezogenen Anträgen das Rücknahme-Datum.
export type StaffAbsenceRequestRow = StaffAbsenceRow &
  Pick<staffContract.absenceRequestResponse, "staff_name"> &
  Partial<
    Pick<staffContract.absenceRequestResponse, "decided_by_name" | "updated_at">
  >;

// Eine Abwesenheit in Kraft, deren Schichten und Betreuungsblöcke ab heute
// noch nicht als abwesend im Plan stehen (#7021): eingetragen oder genehmigt,
// bevor jede Art in die Pläne wirkte. Die Zahlen sind, was die Übernahme
// ändern würde; von Hand abgesagte Schichten zählen nicht.
export interface AbsencePlanGap {
  absenceId: string;
  staffId: string;
  absenceType: string;
  dateStart: string;
  dateEnd: string;
  openShifts: number;
  openBlocks: number;
}

function mapAbsencePlanGap(row: staffContract.AbsencePlanGap): AbsencePlanGap {
  return {
    absenceId: row.absence_id,
    staffId: row.staff_id,
    absenceType: row.absence_type,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    openShifts: row.open_shifts,
    openBlocks: row.open_blocks,
  };
}

// Stundenkonto projection for a planned Freizeitausgleich (#2873), shown in
// the create modal before the Leitung confirms the entry. All values are
// minutes; the projection may be negative — that informs, it never blocks.
export interface CompTimeBalancePreview {
  currentBalanceMinutes: number;
  deductionMinutes: number;
  realizedDeductionMinutes: number;
  futureCommitmentMinutes: number;
  // Signed sum of future-dated Stundenkonto-Buchungen (Auszahlung, Gutschrift,
  // Reset) that are booked but not yet part of the current balance.
  futureAdjustmentMinutes: number;
  projectedBalanceMinutes: number;
}

// Was eine Umbuchung bewirkt (#3258), vorher als Vorschau (dry run) oder
// nachher als Ergebnis. Minuten sind vorzeichenbehaftet: plus heißt, das
// Stundenkonto steigt.
export interface AbsenceRebooking {
  absences: StaffAbsenceRow[];
  days: number;
  balanceDeltaMinutes: number;
  allowances: {
    year: number;
    remainingDays: number;
    bookingDays: number;
  }[];
  allowanceExceeded: boolean;
  vacation: { year: number; remainingBefore: number; remainingAfter: number }[];
  vacationExceeded: boolean;
  applied: boolean;
  /** Token of the effect; the write sends the dry run's back (ADR 0311). */
  fingerprint: string;
}

class StaffAbsenceService {
  async getAbsences(
    staffId: string,
    from: string,
    to: string,
  ): Promise<StaffAbsenceRow[]> {
    const absences = await bffJson("tenant", "GET /api/staff/{id}/absences", {
      params: { id: staffId },
      query: { from, to },
    });
    return absences ?? [];
  }

  async getVacationQuota(
    staffId: string,
    year?: number,
  ): Promise<sharedContract.VacationQuotaSummary> {
    const quota = await bffJson(
      "tenant",
      "GET /api/staff/{id}/vacation/quota",
      {
        params: { id: staffId },
        query: { year: year || undefined },
      },
    );
    return quota;
  }

  async setVacationQuota(
    staffId: string,
    payload: {
      year: number;
      entitled_days: number;
      carryover_days: number;
      /** Pflicht: erscheint im Änderungsprotokoll (#3256). */
      reason: string;
      /** Version des gelesenen Anspruchs (ADR 0311). */
      expected_version: string;
    },
  ): Promise<sharedContract.VacationQuotaSummary> {
    const quota = await bffJson(
      "tenant",
      "PUT /api/staff/{id}/vacation/quota",
      {
        params: { id: staffId },
        body: payload,
        errorMessage: "Der Urlaubsanspruch konnte nicht gespeichert werden.",
      },
    );
    return quota;
  }

  // Vacation takeover (#2132): the admin enters the Resturlaub as of the
  // Stichtag; the backend derives the pre-introduction days from the quota.
  async setVacationOpening(
    staffId: string,
    payload: {
      effectiveDate: string;
      remainingDays: number;
      note: string;
    },
  ): Promise<sharedContract.StaffVacationOpening> {
    const opening = await bffJson(
      "tenant",
      "POST /api/staff/{id}/vacation/opening",
      {
        params: { id: staffId },
        body: {
          effective_date: payload.effectiveDate,
          remaining_days: payload.remainingDays,
          note: payload.note,
        },
        errorMessage: "Übernahme fehlgeschlagen",
      },
    );
    return opening;
  }

  async deleteVacationOpening(staffId: string, year: number): Promise<void> {
    await bffJson("tenant", "DELETE /api/staff/{id}/vacation/opening", {
      params: { id: staffId },
      query: { year },
      errorMessage: "Löschen fehlgeschlagen",
    });
  }

  async approve(absenceId: string, decisionNote?: string): Promise<void> {
    await bffJson("tenant", "POST /api/staff/absences/{absenceId}/approve", {
      params: { absenceId },
      body: { decision_note: decisionNote ?? "" },
      errorMessage: "Genehmigung fehlgeschlagen",
    });
  }

  // Abwesenheiten, die noch nicht im Plan stehen (#7021).
  async listPlanGaps(): Promise<AbsencePlanGap[]> {
    const gaps = await bffJson("tenant", "GET /api/staff/absences/plan-gaps");
    return gaps.map(mapAbsencePlanGap);
  }

  // Übernimmt eine Abwesenheit in Dienstplan und Betreuungsplan (#7021).
  // false: Sie gilt nicht mehr (zurückgezogen oder gelöscht).
  async syncPlan(absenceId: string): Promise<boolean> {
    const result = await bffJson(
      "tenant",
      "POST /api/staff/absences/{absenceId}/plan-sync",
      { params: { absenceId } },
    );
    return result.applied;
  }

  // Tenant-wide open requests (status requested + question) for the /staff
  // inbox (#1419). Response rows carry only staff_id — callers join names
  // against the already-fetched staff list client-side.
  async listPending(): Promise<StaffAbsenceRow[]> {
    return (await bffJson("tenant", "GET /api/staff/absences/pending")) ?? [];
  }

  // Anfragen-Modul, Reiter Mitarbeitende (#2433): offene Anträge oder die
  // Historie der entschiedenen, jeweils mit den Namen, die die Liste zeigt.
  // Suche und Art-Filter wirken serverseitig.
  async listRequests(
    view: "open" | "history",
    filters: { search?: string; types?: readonly string[] } = {},
  ): Promise<StaffAbsenceRequestRow[]> {
    return bffJson("tenant", "GET /api/staff/absences/requests", {
      query: {
        view,
        search: filters.search?.trim() || undefined,
        types: filters.types?.length ? filters.types.join(",") : undefined,
      },
    });
  }

  // Ob die Mails zu Entscheidungen und Rückfragen bei der Person ankamen
  // (#7058): je Antrag das Ergebnis der neuesten Mail. Ein Antrag ohne Mail
  // fehlt.
  async decisionMails(
    absenceIds: readonly string[],
  ): Promise<Record<string, MailOutcome>> {
    if (absenceIds.length === 0) return {};
    const mails = await bffJson("tenant", "GET /api/staff/absences/mails", {
      query: { ids: absenceIds.join(",") },
    });
    const outcomes: Record<string, MailOutcome> = {};
    for (const [id, outcome] of Object.entries(mails.absences ?? {})) {
      const known = knownMailOutcome(outcome);
      if (known) outcomes[id] = known;
    }
    return outcomes;
  }

  // Rückfrage: moves a requested absence into status "question" with a
  // mandatory note from the Leitung (#1419).
  async question(absenceId: string, decisionNote: string): Promise<void> {
    await bffJson("tenant", "POST /api/staff/absences/{absenceId}/question", {
      params: { absenceId },
      body: { decision_note: decisionNote },
      errorMessage: "Rückfrage fehlgeschlagen",
    });
  }

  async deny(absenceId: string, decisionNote: string): Promise<void> {
    await bffJson("tenant", "POST /api/staff/absences/{absenceId}/deny", {
      params: { absenceId },
      body: { decision_note: decisionNote },
      errorMessage: "Ablehnung fehlgeschlagen",
    });
  }

  // Admin-side "Abwesenheit anlegen" (POST /api/staff/{id}/absences). A
  // `sick` absence cancels planned shifts and marks Betreuungsblöcke as
  // absent server-side (#1843). Returns the created StaffAbsence row.
  async createAbsence(
    staffId: string,
    body: sharedContract.CreateAbsenceRequest,
  ): Promise<StaffAbsenceRow> {
    return bffJson("tenant", "POST /api/staff/{id}/absences", {
      params: { id: staffId },
      body,
      errorMessage: "Abwesenheit konnte nicht eingetragen werden",
    });
  }

  // Stundenkonto projection for a planned Freizeitausgleich (#2873):
  // GET /api/staff/{id}/time-tracking/comp-time-preview. A negative
  // projection asks for a confirmation in the modal; the create sends it as
  // overdraft_confirmed, and the server refuses an unconfirmed overdraft
  // under its lock (ADR 0311).
  async getCompTimePreview(
    staffId: string,
    args: { dateStart: string; dateEnd: string; halfDay: boolean },
  ): Promise<CompTimeBalancePreview> {
    const preview = await bffJson(
      "tenant",
      "GET /api/staff/{id}/time-tracking/comp-time-preview",
      {
        params: { id: staffId },
        query: {
          date_start: args.dateStart,
          date_end: args.dateEnd,
          half_day: args.halfDay,
        },
        errorMessage: "Die Saldo-Vorschau konnte nicht geladen werden.",
      },
    );
    return {
      currentBalanceMinutes: preview.current_balance_minutes,
      deductionMinutes: preview.deduction_minutes,
      realizedDeductionMinutes: preview.realized_deduction_minutes,
      futureCommitmentMinutes: preview.future_commitment_minutes,
      futureAdjustmentMinutes: preview.future_adjustment_minutes,
      projectedBalanceMinutes: preview.projected_balance_minutes,
    };
  }

  // Ändert die Art gespeicherter Abwesenheiten (#3258):
  // POST /api/staff/{id}/absences/rebook. Mit dryRun schreibt der Server
  // nichts und beschreibt nur die Folgen.
  async rebookAbsences(
    staffId: string,
    args: {
      absenceIds: readonly string[];
      absenceType: string;
      absenceTypeId: string | null;
      reason: string;
      dryRun: boolean;
      /** Fingerprint of the dry run the write was confirmed on (ADR 0311). */
      expectedFingerprint?: string;
    },
  ): Promise<AbsenceRebooking> {
    const data = await bffJson(
      "tenant",
      "POST /api/staff/{id}/absences/rebook",
      {
        params: { id: staffId },
        body: {
          absence_ids: [...args.absenceIds],
          absence_type: args.absenceType,
          absence_type_id: args.absenceTypeId,
          reason: args.reason,
          dry_run: args.dryRun,
          ...(args.expectedFingerprint !== undefined
            ? { expected_fingerprint: args.expectedFingerprint }
            : {}),
        },
        errorMessage: "Die Art konnte nicht geändert werden.",
      },
    );
    return {
      absences: (data.absences ?? []).filter(
        (absence): absence is sharedContract.StaffAbsenceResponse =>
          absence !== null,
      ),
      days: data.days,
      balanceDeltaMinutes: data.balance_delta_minutes,
      allowances: (data.allowances ?? []).map((item) => ({
        year: item.year,
        remainingDays: item.remaining_days,
        bookingDays: item.booking_days,
      })),
      allowanceExceeded: data.allowance_exceeded,
      vacation: (data.vacation ?? []).map((item) => ({
        year: item.year,
        remainingBefore: item.remaining_before,
        remainingAfter: item.remaining_after,
      })),
      vacationExceeded: data.vacation_exceeded,
      applied: data.applied,
      fingerprint: data.fingerprint,
    };
  }

  // Deletes an absence (DELETE /api/staff/{id}/absences/{absenceId}).
  // Deleting a `sick` absence reverses the plan cascade backend-side.
  async deleteAbsence(staffId: string, absenceId: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/staff/{id}/absences/{absenceId}", {
      params: { id: staffId, absenceId },
      errorMessage: "Löschen fehlgeschlagen",
    });
  }
}

// Admin counterpart to timeTrackingService.getSessionEdits (which checks
// ownership against the JWT subject). Routes via /api/staff/{id}/.../edits
// so an admin can pull the audit trail for any staff member's session in
// the tenant.
import { parseISODate, toISODate } from "./date-helpers";
import {
  MAX_TARGET_RANGE_DAYS,
  mapBalanceAdjustmentResponse,
  mapDailyProjectionResponse,
  mapMonthCloseResultResponse,
  mapMonthCloseSnapshotResponse,
  mapMonthSummaryResponse,
  mapWeeklySummaries,
  mapWorkDayLaborHint,
  mapWorkSessionEditResponse,
  type DayProjection,
  type BalanceAdjustment,
  type MonthCloseResult,
  type MonthCloseSnapshot,
  type MonthSummary,
  type WeeklySummary,
  type WorkDayLaborHint,
  type WorkSessionEdit,
} from "./time-tracking-helpers";

class StaffSessionEditsService {
  async getEdits(
    staffId: string,
    sessionId: string,
  ): Promise<WorkSessionEdit[]> {
    const edits = await bffJson(
      "tenant",
      "GET /api/staff/{id}/time-tracking/sessions/{sessionId}/edits",
      { params: { id: staffId, sessionId } },
    );
    return (edits ?? []).map(mapWorkSessionEditResponse);
  }
}

// Monatskarte (#1842), live-computed. Admin counterpart to
// timeTrackingService.getMonthSummary.
class StaffMonthSummaryService {
  async getMonthSummary(
    staffId: string,
    year: number,
    month: number,
  ): Promise<MonthSummary> {
    return mapMonthSummaryResponse(
      await bffJson(
        "tenant",
        "GET /api/staff/{id}/time-tracking/month-summary",
        {
          params: { id: staffId },
          query: { year, month },
        },
      ),
    );
  }

  // Admin counterpart to timeTrackingService.getDailyProjection (#2443): Soll,
  // Gutschrift, Ist und Saldo je Tag, gerechnet wie die Monatskarte — so kann
  // die Tageszeile der Karte darüber nicht widersprechen.
  async getDailyProjection(
    staffId: string,
    from: string,
    to: string,
  ): Promise<ReadonlyMap<string, DayProjection>> {
    return mapDailyProjectionResponse(
      await bffJson(
        "tenant",
        "GET /api/staff/{id}/time-tracking/schedule-targets",
        { params: { id: staffId }, query: { from, to } },
      ),
    );
  }

  /**
   * The same per-day projection as `getDailyProjection` (Soll, Gutschrift,
   * Ist, Saldo), for a range that may be longer than the endpoint's
   * MAX_TARGET_RANGE_DAYS window. The Übersicht charts reach back to the
   * configured account start ("Gesamt"), which can be years — one request
   * would simply 400. The windows are fetched with bounded concurrency and
   * merged; days repeat across no two windows, so the merge is a plain union.
   * The charts sum these server days instead of crediting absences themselves
   * (#6847).
   */
  async getDailyProjectionRange(
    staffId: string,
    from: string,
    to: string,
  ): Promise<ReadonlyMap<string, DayProjection>> {
    // Windows are MAX_TARGET_RANGE_DAYS calendar days INCLUSIVE — one day
    // inside the endpoint's cap, which counts the gap between the bounds
    // rather than the days. Nothing rides on the last day of headroom, and a
    // whole-window stride keeps the arithmetic obvious.
    const windows: { from: string; to: string }[] = [];
    const end = parseISODate(to);
    for (
      let cursor = parseISODate(from);
      cursor <= end;
      cursor = addDays(cursor, MAX_TARGET_RANGE_DAYS)
    ) {
      const windowEnd = addDays(cursor, MAX_TARGET_RANGE_DAYS - 1);
      windows.push({
        from: toISODate(cursor),
        to: toISODate(windowEnd > end ? end : windowEnd),
      });
    }

    // Bound the fan-out: a "Gesamt" range on a years-old account produces one
    // window per ~year, and a plain Promise.all would fire them all at once —
    // one overview render then opens dozens of simultaneous DB-backed requests
    // per staff member. A small pool keeps the endpoint (and its RLS-scoped
    // queries) from being hammered while still overlapping the round-trips.
    const chunks = await mapWithConcurrency(
      windows,
      MAX_TARGET_RANGE_CONCURRENCY,
      (w) => this.getDailyProjection(staffId, w.from, w.to),
    );
    const merged = new Map<string, DayProjection>();
    for (const chunk of chunks) {
      for (const [day, projection] of chunk) merged.set(day, projection);
    }
    return merged;
  }
}

// Upper bound on projection windows fetched at once by
// getDailyProjectionRange. Four keeps the round-trips overlapping without
// letting a long-lived account open a dozen+ concurrent DB-backed requests.
const MAX_TARGET_RANGE_CONCURRENCY = 4;

// Runs `worker` over `items` with at most `limit` in flight at any time,
// preserving input order in the result. A fixed pool of `limit` runners pulls
// from a shared cursor, so the total number of concurrent calls never exceeds
// `limit` regardless of how many items there are.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  };
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    run(),
  );
  await Promise.all(runners);
  return results;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

class StaffSessionService {
  // PUT corrects an existing session on behalf of the named staff member.
  // Backend route: /api/staff/{staffId}/time-tracking/sessions/{sessionId}
  async updateSession(
    staffId: string,
    sessionId: string,
    payload: sharedContract.SessionUpdateRequest,
  ): Promise<void> {
    await bffJson(
      "tenant",
      "PUT /api/staff/{id}/time-tracking/sessions/{sessionId}",
      { params: { id: staffId, sessionId }, body: payload },
    );
  }

  // POST admin "nachträgt" a session for a staff member who forgot to
  // stamp. Backend route: /api/staff/{staffId}/time-tracking/sessions
  async createSession(
    staffId: string,
    payload: staffContract.AdminCreateSessionRequest,
  ): Promise<void> {
    await bffJson("tenant", "POST /api/staff/{id}/time-tracking/sessions", {
      params: { id: staffId },
      body: payload,
    });
  }
}

// Stundenkonto lifecycle (#1420): payout / comp-time transactions and the
// school-year reset. Admin-only (time_tracking:manage, enforced backend-side).
class StaffBalanceAdjustmentService {
  async list(
    staffId: string,
    from: string,
    to: string,
  ): Promise<BalanceAdjustment[]> {
    const adjustments = await bffJson(
      "tenant",
      "GET /api/staff/{id}/time-tracking/adjustments",
      { params: { id: staffId }, query: { from, to } },
    );
    return (adjustments ?? []).map(mapBalanceAdjustmentResponse);
  }

  // minutesDelta is signed and negative — payout and comp-time grants only
  // ever reduce the Stundenkonto.
  async create(
    staffId: string,
    payload: {
      type: "payout" | "comp_time";
      minutesDelta: number;
      effectiveDate: string;
      note: string;
    },
  ): Promise<BalanceAdjustment> {
    const adjustment = await bffJson(
      "tenant",
      "POST /api/staff/{id}/time-tracking/adjustments",
      {
        params: { id: staffId },
        body: {
          type: payload.type,
          minutes_delta: payload.minutesDelta,
          effective_date: payload.effectiveDate,
          note: payload.note,
        },
        errorMessage: "Buchung fehlgeschlagen",
      },
    );
    return mapBalanceAdjustmentResponse(adjustment);
  }

  async delete(staffId: string, adjustmentId: string): Promise<void> {
    await bffJson(
      "tenant",
      "DELETE /api/staff/{id}/time-tracking/adjustments/{adjustmentId}",
      {
        params: { id: staffId, adjustmentId },
        errorMessage: "Löschen fehlgeschlagen",
      },
    );
  }

  // The backend computes the closing balance as of effectiveDate under a
  // per-staff lock and writes the inverting transaction; a repeated reset
  // for the same date returns 409.
  async reset(
    staffId: string,
    payload: {
      effectiveDate: string;
      carryoverMinutes: number;
      note: string;
    },
  ): Promise<BalanceAdjustment> {
    const adjustment = await bffJson(
      "tenant",
      "POST /api/staff/{id}/time-tracking/reset",
      {
        params: { id: staffId },
        body: {
          effective_date: payload.effectiveDate,
          carryover_minutes: payload.carryoverMinutes,
          note: payload.note,
        },
        errorMessage: "Reset fehlgeschlagen",
      },
    );
    return mapBalanceAdjustmentResponse(adjustment);
  }

  // Eröffnungssaldo (#2132): sets the Stundenkonto to a SIGNED target value
  // as of the Stichtag — the only booking that may take the account negative
  // (takeover from the previous system). One opening per person, ever.
  async createOpening(
    staffId: string,
    payload: {
      effectiveDate: string;
      balanceMinutes: number;
      note: string;
    },
  ): Promise<BalanceAdjustment> {
    const adjustment = await bffJson(
      "tenant",
      "POST /api/staff/{id}/time-tracking/opening",
      {
        params: { id: staffId },
        body: {
          effective_date: payload.effectiveDate,
          balance_minutes: payload.balanceMinutes,
          note: payload.note,
        },
        errorMessage: "Eröffnungssaldo fehlgeschlagen",
      },
    );
    return mapBalanceAdjustmentResponse(adjustment);
  }
}

// Monatsabschluss (#1417): school-wide freeze of a month's closing balances,
// per-staff reopen. The German copy for the stable error codes lives here so
// every caller explains the same rules the same way.
class StaffMonthCloseService {
  /** Active snapshots of one month for the whole school; [] = not closed. */
  async getStatus(year: number, month: number): Promise<MonthCloseSnapshot[]> {
    const snapshots = await bffJson(
      "tenant",
      "GET /api/staff/time-tracking/month-close",
      { query: { year, month } },
    );
    return (snapshots ?? []).map(mapMonthCloseSnapshotResponse);
  }

  /** The staff whose month the Träger closes (#4711): a contract of the
   *  Träger covers the month, so the school's close leaves them out. */
  async getTraegerStaff(year: number, month: number): Promise<string[]> {
    const result = await bffJson(
      "tenant",
      "GET /api/staff/time-tracking/month-close/traeger-staff",
      { query: { year, month } },
    );
    return result.staff_ids ?? [];
  }

  /** Freezes the month for the whole school in one transaction. */
  async closeMonth(payload: {
    year: number;
    month: number;
    reason: string;
  }): Promise<MonthCloseResult> {
    const result = await bffJson(
      "tenant",
      "POST /api/staff/time-tracking/month-close",
      {
        body: {
          year: payload.year,
          month: payload.month,
          reason: payload.reason,
        },
        errorMessage: "Monatsabschluss fehlgeschlagen",
      },
    );
    return mapMonthCloseResultResponse(result);
  }

  /** Reopens one staff member's closed month; reason is mandatory. */
  async reopenMonth(
    staffId: string,
    payload: { year: number; month: number; reason: string },
  ): Promise<void> {
    await bffJson(
      "tenant",
      "POST /api/staff/{id}/time-tracking/month-close/reopen",
      {
        params: { id: staffId },
        body: {
          year: payload.year,
          month: payload.month,
          reason: payload.reason,
        },
        errorMessage: "Wiedereröffnung fehlgeschlagen",
      },
    );
  }
}

// Personalnummer (#1417): payroll identifier maintained on the Stammdaten
// tab. time_tracking:manage backend-side — callers gate rendering on the
// permission so no request fires without it.
class StaffPayrollNumberService {
  async get(staffId: string): Promise<StaffPayrollNumber> {
    const number = await bffJson(
      "tenant",
      "GET /api/staff/{id}/payroll-number",
      {
        params: { id: staffId },
      },
    );
    return {
      personnelNumber: number.personnel_number,
      keptByTraeger: number.kept_by_traeger ?? false,
    };
  }

  async update(
    staffId: string,
    personnelNumber: string | null,
    note: string,
  ): Promise<string | null> {
    const number = await bffJson(
      "tenant",
      "PUT /api/staff/{id}/payroll-number",
      {
        params: { id: staffId },
        body: { personnel_number: personnelNumber, note },
        errorMessage: "Personalnummer konnte nicht gespeichert werden",
      },
    );
    return number.personnel_number;
  }
}

// --- Stammdaten (#1423) -----------------------------------------------------

export type StammdatenGender = "female" | "male" | "diverse";

export interface StammdatenPerson {
  firstName: string;
  lastName: string;
  /** "YYYY-MM-DD" or null */
  birthday: string | null;
  gender: StammdatenGender | null;
}

export interface StammdatenKontakt {
  addressStreet: string | null;
  addressPostalCode: string | null;
  addressCity: string | null;
  phone: string | null;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface StammdatenArbeitsvertrag {
  /** "YYYY-MM-DD" or null */
  entryDate: string | null;
  contractEndDate: string | null;
  probationEndDate: string | null;
  weeklyHours: number | null;
  employmentType: string | null;
}

export interface StammdatenQualifikation {
  id: string | null;
  /** Nachweisart (#4808); null ist „Sonstiges“ mit freiem Namen. */
  typeId: string | null;
  name: string;
  acquiredOn: string | null;
  expiresOn: string | null;
}

export interface StaffStammdaten {
  staffId: string;
  person: StammdatenPerson;
  kontakt: StammdatenKontakt;
  arbeitsvertrag: StammdatenArbeitsvertrag;
  qualifikationen: StammdatenQualifikation[];
}

/**
 * Die Personalnummer einer Beschäftigung. `keptByTraeger`: Der Träger führt
 * die Person in seiner Personalakte (#4705); die Nummer ist dann seine, und
 * die Schule ändert sie nicht.
 */
interface StaffPayrollNumber {
  personnelNumber: string | null;
  keptByTraeger?: boolean;
}

interface StaffFinancialMasked {
  ibanMasked: string | null;
  taxIdMasked: string | null;
  socialSecurityNumberMasked: string | null;
  /** Der Träger führt die Werte in seiner Personalakte (#4705). */
  keptByTraeger?: boolean;
}

export interface StaffFinancialPlain {
  iban: string | null;
  taxId: string | null;
  socialSecurityNumber: string | null;
}

const GENDERS: readonly StammdatenGender[] = ["female", "male", "diverse"];

function mapStammdatenResponse(data: StammdatenResponse): StaffStammdaten {
  return {
    staffId: data.staff_id,
    person: {
      firstName: data.person.first_name,
      lastName: data.person.last_name,
      birthday: data.person.birthday,
      gender: knownEnum(GENDERS, data.person.gender ?? undefined) ?? null,
    },
    kontakt: {
      addressStreet: data.kontakt.address_street,
      addressPostalCode: data.kontakt.address_postal_code,
      addressCity: data.kontakt.address_city,
      phone: data.kontakt.phone,
      email: data.kontakt.email,
      emergencyContactName: data.kontakt.emergency_contact_name,
      emergencyContactPhone: data.kontakt.emergency_contact_phone,
    },
    arbeitsvertrag: {
      entryDate: data.arbeitsvertrag.entry_date,
      contractEndDate: data.arbeitsvertrag.contract_end_date,
      probationEndDate: data.arbeitsvertrag.probation_end_date,
      weeklyHours: data.arbeitsvertrag.weekly_hours,
      employmentType: data.arbeitsvertrag.employment_type,
    },
    qualifikationen: (data.qualifikationen ?? []).map((q) => ({
      id: q.id ?? null,
      typeId: q.type_id,
      name: q.name,
      acquiredOn: q.acquired_on,
      expiresOn: q.expires_on,
    })),
  };
}

// Stammdaten (#1423): section-scoped master data of one staff member. The
// non-sensitive sections ride on staff:stammdaten (#2906), the bank & tax
// section is staff:financial only — callers gate rendering on the permission
// so no request fires without it.
class StaffStammdatenService {
  async get(staffId: string): Promise<StaffStammdaten> {
    return mapStammdatenResponse(
      await bffJson("tenant", "GET /api/staff/{id}/stammdaten", {
        params: { id: staffId },
      }),
    );
  }

  private async putSection(
    staffId: string,
    section:
      | "person"
      | "kontakt"
      | "arbeitsvertrag"
      | "qualifikationen"
      | "bank-steuer",
    body: Record<string, unknown>,
  ): Promise<void> {
    // One route per section; every request type of them takes `note`.
    const route = `PUT /api/staff/{id}/stammdaten/${section}` as const;
    await bffJson("tenant", route, {
      params: { id: staffId },
      body,
      errorMessage: "Stammdaten konnten nicht gespeichert werden",
    });
  }

  async updatePerson(
    staffId: string,
    person: StammdatenPerson,
    note: string,
  ): Promise<void> {
    await this.putSection(staffId, "person", {
      first_name: person.firstName,
      last_name: person.lastName,
      birthday: person.birthday,
      gender: person.gender,
      note,
    });
  }

  async updateKontakt(
    staffId: string,
    kontakt: StammdatenKontakt,
    note: string,
  ): Promise<void> {
    await this.putSection(staffId, "kontakt", {
      address_street: kontakt.addressStreet,
      address_postal_code: kontakt.addressPostalCode,
      address_city: kontakt.addressCity,
      phone: kontakt.phone,
      email: kontakt.email,
      emergency_contact_name: kontakt.emergencyContactName,
      emergency_contact_phone: kontakt.emergencyContactPhone,
      note,
    });
  }

  async updateArbeitsvertrag(
    staffId: string,
    vertrag: StammdatenArbeitsvertrag,
    note: string,
  ): Promise<void> {
    await this.putSection(staffId, "arbeitsvertrag", {
      entry_date: vertrag.entryDate,
      contract_end_date: vertrag.contractEndDate,
      probation_end_date: vertrag.probationEndDate,
      weekly_hours: vertrag.weeklyHours,
      employment_type: vertrag.employmentType,
      note,
    });
  }

  async updateQualifikationen(
    staffId: string,
    qualifikationen: readonly StammdatenQualifikation[],
    note: string,
  ): Promise<void> {
    await this.putSection(staffId, "qualifikationen", {
      qualifikationen: qualifikationen.map((q) => ({
        ...(q.id !== null ? { id: q.id } : {}),
        type_id: q.typeId,
        name: q.name,
        acquired_on: q.acquiredOn,
        expires_on: q.expiresOn,
      })),
      note,
    });
  }

  async getFinancial(staffId: string): Promise<StaffFinancialMasked> {
    const financial = await bffJson(
      "tenant",
      "GET /api/staff/{id}/stammdaten/bank-steuer",
      { params: { id: staffId } },
    );
    return {
      ibanMasked: financial.iban_masked,
      taxIdMasked: financial.tax_id_masked,
      socialSecurityNumberMasked: financial.social_security_number_masked,
      keptByTraeger: financial.kept_by_traeger ?? false,
    };
  }

  // POST: the reveal writes a GDPR access-log row server-side.
  async revealFinancial(staffId: string): Promise<StaffFinancialPlain> {
    const financial = await bffJson(
      "tenant",
      "POST /api/staff/{id}/stammdaten/bank-steuer/reveal",
      { params: { id: staffId } },
    );
    return {
      iban: financial.iban,
      taxId: financial.tax_id,
      socialSecurityNumber: financial.social_security_number,
    };
  }

  async updateFinancial(
    staffId: string,
    financial: StaffFinancialPlain,
    note: string,
  ): Promise<void> {
    await this.putSection(staffId, "bank-steuer", {
      iban: financial.iban,
      tax_id: financial.taxId,
      social_security_number: financial.socialSecurityNumber,
      note,
    });
  }
}

export const staffService = new StaffService();
export const staffStammdatenService = new StaffStammdatenService();
export const staffPayrollNumberService = new StaffPayrollNumberService();
export const staffScheduleService = new StaffScheduleService();
export const workTimeModelService = new WorkTimeModelService();
export const staffHistoryService = new StaffHistoryService();
export const staffAbsenceService = new StaffAbsenceService();
export const staffSessionEditsService = new StaffSessionEditsService();
export const staffSessionService = new StaffSessionService();
export const staffMonthSummaryService = new StaffMonthSummaryService();
export const staffBalanceAdjustmentService =
  new StaffBalanceAdjustmentService();
export const staffMonthCloseService = new StaffMonthCloseService();

/**
 * Geplanter Austritt (#4809): die Leitung trägt den letzten Arbeitstag einer
 * Person ein. Nach dem Ende dieses Tages löscht moto die Person wie über
 * „Löschen“. Bis zum letzten Arbeitstag lässt sich der Tag ändern oder der
 * Austritt zurücknehmen.
 */
export const staffPlannedExitService = {
  async plan(staffId: string, lastWorkingDay: string): Promise<string> {
    const exit = await bffJson("tenant", "PUT /api/staff/{id}/planned-exit", {
      params: { id: staffId },
      body: { last_working_day: lastWorkingDay },
      errorMessage: "Der Austritt konnte nicht gespeichert werden",
    });
    return exit.last_working_day ?? lastWorkingDay;
  },

  async withdraw(staffId: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/staff/{id}/planned-exit", {
      params: { id: staffId },
      errorMessage: "Der Austritt konnte nicht zurückgenommen werden",
    });
  },
};
