import { knownEnum } from "~/lib/contract/known-enum";
import { requiredDay } from "~/lib/contract/required-day";
import type {
  DeviceTransferStatus as WireDeviceTransferStatus,
  createDeviceRequest,
} from "~/lib/contract/operator-devices.generated";
import type {
  OrganizationSummary as WireOrganizationSummary,
  SampleChildrenResult as WireSampleChildrenResult,
  TestTraeger as WireTestTraeger,
  TraegerErasureOrder as WireTraegerErasureOrder,
  TraegerInvitation as WireTraegerInvitation,
  TraegerMember as WireTraegerMember,
  createOrganizationRequest,
  createTestTraegerRequest,
  recordTraegerErasureOrderRecordsRequest,
  recordTraegerErasureOrderRequest,
  traegerMemberRequest,
  updateOrganizationRequest,
} from "~/lib/contract/operator-organizations.generated";
import type {
  SchoolAccount as WireSchoolAccount,
  SchoolPWAUsage as WireSchoolPWAUsage,
  SchoolRequiredDetails as WireSchoolRequiredDetails,
  createSchoolAccountRequest,
  createSchoolRequest,
  inviteSchoolAdminRequest,
  operatorInvitationResponse as WireInvitation,
  updateSchoolRequest,
} from "~/lib/contract/operator-schools.generated";
import type { ProvisioningStats as WireProvisioningStats } from "~/lib/contract/operator-stats.generated";
import type { scanResponse as WireUnregisteredTagScan } from "~/lib/contract/operator-unregistered-tag-scans.generated";
import type { CatererSecurityResponse as WireOperatorCaterer } from "~/lib/contract/operator-caterers.generated";
import type {
  OperatorDevice as WireOperatorDevice,
  OperatorPerson as WireOperatorPerson,
  Organization as WireOrganization,
  OrganizationAccount as WireOrgAccount,
  School as WireSchool,
  SchoolSummary as WireSchoolSummary,
} from "~/lib/contract/shared.generated";
import { isTraegerRole, type TraegerRole } from "~/lib/traeger-roles";

export interface ProvisioningStats {
  traegerCount: number;
  schulenCount: number;
  kontenCount: number;
  geraeteCount: number;
}

export function mapProvisioningStats(
  data: WireProvisioningStats,
): ProvisioningStats {
  return {
    traegerCount: data.traeger_count,
    schulenCount: data.schulen_count,
    kontenCount: data.konten_count,
    geraeteCount: data.geraete_count,
  };
}

interface PWAPortalUsage {
  standaloneUsers: number;
  eligibleUsers: number;
}

/**
 * Per-school PWA standalone usage (#2189): how many staff/parent accounts
 * used the app in standalone mode within the window. Not an install count.
 */
export interface SchoolPWAUsage {
  windowDays: number;
  staff: PWAPortalUsage;
  parent: PWAPortalUsage;
}

function mapPWAPortalUsage(data: WireSchoolPWAUsage["staff"]): PWAPortalUsage {
  return {
    standaloneUsers: data.standalone_users,
    eligibleUsers: data.eligible_users,
  };
}

export function mapSchoolPWAUsage(data: WireSchoolPWAUsage): SchoolPWAUsage {
  return {
    windowDays: data.window_days,
    staff: mapPWAPortalUsage(data.staff),
    parent: mapPWAPortalUsage(data.parent),
  };
}

export interface OrganizationSummary extends Organization {
  schulenCount: number;
  kontenCount: number;
  geraeteCount: number;
  personenCount: number;
}

export function mapOrganizationSummary(
  data: WireOrganizationSummary,
): OrganizationSummary {
  return {
    ...mapOrganization(data),
    schulenCount: data.schulen_count,
    kontenCount: data.konten_count,
    geraeteCount: data.geraete_count,
    personenCount: data.personen_count,
  };
}

export interface SchoolSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  subdomain: string;
  active: boolean;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  address: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
  kontenCount: number;
  geraeteCount: number;
  personenCount: number;
  childQuotaBundles: number | null;
  childQuotaBundleSize: number;
  childQuotaCount: number;
  /** Geräteplätze der Schule (#2312); null, solange moto keine Grenze gesetzt hat. */
  deviceSlots: number | null;
}

export function mapSchoolSummary(data: WireSchoolSummary): SchoolSummary {
  return {
    id: data.id,
    organizationId: data.organization_id,
    organizationName: data.organization_name,
    name: data.name,
    slug: data.slug,
    subdomain: data.subdomain,
    active: data.active,
    hidden: data.hidden,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    deletedAt: data.deleted_at ?? null,
    address: data.address ?? "",
    city: data.city ?? "",
    zip: data.zip ?? "",
    phone: data.phone ?? "",
    email: data.email ?? "",
    kontenCount: data.konten_count,
    geraeteCount: data.geraete_count,
    personenCount: data.personen_count,
    childQuotaBundles: data.child_quota_bundles,
    childQuotaBundleSize: data.child_quota_bundle_size,
    childQuotaCount: data.child_quota_count,
    deviceSlots: data.device_slots,
  };
}

// Adapters: drop the summary-only count fields so existing modal/form
// components that accept the base Organization/School types can be reused on
// drill-in pages without leaking aggregate counts into their props.
export function summaryToOrganization(
  summary: OrganizationSummary,
): Organization {
  return {
    id: summary.id,
    name: summary.name,
    slug: summary.slug,
    active: summary.active,
    deletedAt: summary.deletedAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    testSystem: summary.testSystem,
  };
}

export function summaryToSchool(summary: SchoolSummary): School {
  return {
    id: summary.id,
    organizationId: summary.organizationId,
    name: summary.name,
    slug: summary.slug,
    subdomain: summary.subdomain,
    address: summary.address,
    city: summary.city,
    zip: summary.zip,
    phone: summary.phone,
    email: summary.email,
    active: summary.active,
    hidden: summary.hidden,
    deletedAt: summary.deletedAt,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

// Frontend types (camelCase, string ids)

export interface Organization {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  testSystem: boolean;
}

export interface School {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  subdomain: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
  active: boolean;
  hidden: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  organization?: Organization;
}

export interface Invitation {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  expiresAt: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  caregiverEnabled: boolean;
  createdBy: string;
  creator: string;
  deliveryStatus: string;
  emailSentAt: string | null;
  emailError: string | null;
  emailRetryCount: number;
}

// Account types for operator school accounts listing

export interface SchoolAccount {
  accountId: string;
  email: string;
  active: boolean;
  firstName: string;
  lastName: string;
  roleName: string;
  pedagogicRole: string;
  status: string;
  hasAdminRole: boolean;
  hasUserRole: boolean;
  hasCaregiverProfile: boolean;
  isActiveCaregiver: boolean;
}

export function mapSchoolAccount(data: WireSchoolAccount): SchoolAccount {
  return {
    accountId: data.account_id,
    email: data.email,
    active: data.active,
    firstName: data.first_name,
    lastName: data.last_name,
    roleName: data.role_name,
    pedagogicRole: data.pedagogic_role,
    status: data.status,
    hasAdminRole: data.has_admin_role,
    hasUserRole: data.has_user_role,
    hasCaregiverProfile: data.has_caregiver_profile,
    isActiveCaregiver: data.is_active_caregiver,
  };
}

// Org-level account types (includes school context)

export interface OrgAccount extends SchoolAccount {
  schoolId: string;
  schoolName: string;
}

export function mapOrgAccount(data: WireOrgAccount): OrgAccount {
  return {
    ...mapSchoolAccount(data),
    schoolId: data.school_id,
    schoolName: data.school_name,
  };
}

// Request types (snake_case for backend)

export type CreateOrganizationRequest = Required<createOrganizationRequest>;

/** Auftrag für ein Testsystem (#4658): Test-Träger mit Test-Schulen. */
/** `federal_state`: Bundesland of every test school (#7174). */
export type CreateTestTraegerRequest = Required<createTestTraegerRequest>;

export interface TestTraeger {
  organization: Organization;
  schools: School[];
}

export function mapTestTraeger(data: WireTestTraeger): TestTraeger {
  return {
    organization: mapOrganization(data.organization),
    schools: (data.schools ?? []).map(mapSchool),
  };
}

/** Erfundene Beispielkinder in den Test-Schulen eines Test-Trägers. */
export interface SampleChildrenResult {
  createdCount: number;
  skippedCount: number;
}

export function mapSampleChildrenResult(
  data: WireSampleChildrenResult,
): SampleChildrenResult {
  return {
    createdCount: data.created_count,
    skippedCount: (data.schools ?? []).reduce(
      (sum, school) => sum + school.skipped_count,
      0,
    ),
  };
}

/**
 * `organization_id` stays a number: the request type of the contract says so.
 * `federal_state` is the ISO 3166-2 code of the Bundesland; required, there is
 * no default (#7174).
 */
export type CreateSchoolRequest = createSchoolRequest &
  Required<
    Pick<
      createSchoolRequest,
      "organization_id" | "name" | "slug" | "subdomain" | "federal_state"
    >
  >;

/**
 * The federal states a school can be in, as the options of the setting
 * `operations.federal_state`. Holidays and school vacations follow it.
 */
export const FEDERAL_STATES: readonly { value: string; label: string }[] = [
  { value: "DE-BW", label: "Baden-Württemberg" },
  { value: "DE-BY", label: "Bayern" },
  { value: "DE-BE", label: "Berlin" },
  { value: "DE-BB", label: "Brandenburg" },
  { value: "DE-HB", label: "Bremen" },
  { value: "DE-HH", label: "Hamburg" },
  { value: "DE-HE", label: "Hessen" },
  { value: "DE-MV", label: "Mecklenburg-Vorpommern" },
  { value: "DE-NI", label: "Niedersachsen" },
  { value: "DE-NW", label: "Nordrhein-Westfalen" },
  { value: "DE-RP", label: "Rheinland-Pfalz" },
  { value: "DE-SL", label: "Saarland" },
  { value: "DE-SN", label: "Sachsen" },
  { value: "DE-ST", label: "Sachsen-Anhalt" },
  { value: "DE-SH", label: "Schleswig-Holstein" },
  { value: "DE-TH", label: "Thüringen" },
];

export type InviteAdminRequest = inviteSchoolAdminRequest &
  Required<Pick<inviteSchoolAdminRequest, "email">>;

export type CreateAccountRequest = createSchoolAccountRequest &
  Required<
    Pick<
      createSchoolAccountRequest,
      "email" | "first_name" | "last_name" | "password" | "confirm_password"
    >
  >;

// Mapping functions

export function mapOrganization(data: WireOrganization): Organization {
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    active: data.active,
    deletedAt: data.deleted_at ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    testSystem: data.test_system,
  };
}

export function mapSchool(data: WireSchool): School {
  return {
    id: data.id,
    organizationId: data.organization_id,
    name: data.name,
    slug: data.slug,
    subdomain: data.subdomain,
    address: data.address ?? "",
    city: data.city ?? "",
    zip: data.zip ?? "",
    phone: data.phone ?? "",
    email: data.email ?? "",
    active: data.active,
    hidden: data.hidden,
    deletedAt: data.deleted_at ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    organization: data.organization
      ? mapOrganization(data.organization)
      : undefined,
  };
}

export function mapInvitation(data: WireInvitation): Invitation {
  return {
    id: data.id,
    email: data.email,
    roleId: data.role_id,
    roleName: data.role_name ?? "",
    expiresAt: data.expires_at,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    position: data.position ?? null,
    caregiverEnabled: data.caregiver_enabled,
    createdBy: data.created_by,
    creator: data.creator ?? "",
    deliveryStatus: data.delivery_status,
    emailSentAt: data.email_sent_at ?? null,
    emailError: data.email_error ?? null,
    emailRetryCount: data.email_retry_count,
  };
}

export type UpdateOrganizationRequest = Required<updateOrganizationRequest>;

/**
 * Kinderkontingent (#3567): `child_quota` absent keeps it, null removes it,
 * an object sets it.
 */
export type UpdateSchoolRequest = Required<
  Omit<updateSchoolRequest, "child_quota">
> &
  Pick<updateSchoolRequest, "child_quota">;

/** What a school still lacks of its required details (#7174). */
export interface SchoolRequiredDetails {
  schoolId: string;
  /** Neither the reply setting nor the contact address answers parents. */
  replyAddressMissing: boolean;
}

export function mapSchoolRequiredDetails(
  data: WireSchoolRequiredDetails,
): SchoolRequiredDetails {
  return {
    schoolId: data.school_id,
    replyAddressMissing: data.reply_address_missing,
  };
}

// Device creation / API key management

export type CreateDeviceRequest = createDeviceRequest &
  Required<
    Pick<createDeviceRequest, "school_id" | "device_id" | "device_type">
  >;

// Device types for operator device listing

export interface OperatorDevice {
  id: string;
  deviceId: string;
  deviceType: string;
  name: string;
  status: string;
  apiKey: string;
  maskedApiKey: string;
  lastSeen: string | null;
  isOnline: boolean;
  schoolId: string;
  schoolName: string;
  organizationId: string;
  organizationName: string;
  createdAt: string;
  updatedAt: string;
}

export function mapOperatorDevice(
  data: WireOperatorDevice,
  includeCredential = false,
): OperatorDevice {
  return {
    id: data.id,
    deviceId: data.device_id,
    deviceType: data.device_type,
    name: data.name ?? "",
    status: data.status,
    apiKey: includeCredential ? (data.api_key ?? "") : "",
    maskedApiKey: data.masked_api_key,
    lastSeen: data.last_seen ?? null,
    isOnline: data.is_online,
    schoolId: data.school_id,
    schoolName: data.school_name,
    organizationId: data.organization_id,
    organizationName: data.organization_name,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export interface DeviceTransferStatus {
  canTransfer: boolean;
  isOnline: boolean;
  isProtected: boolean;
  lastSeen: string | null;
  activeSession: {
    id: string;
    startedAt: string;
    activityName: string;
    roomName: string;
  } | null;
}

export function mapDeviceTransferStatus(
  data: WireDeviceTransferStatus,
): DeviceTransferStatus {
  return {
    canTransfer: data.can_transfer,
    isOnline: data.is_online,
    isProtected: data.is_protected,
    lastSeen: data.last_seen ?? null,
    activeSession: data.active_session
      ? {
          id: data.active_session.id,
          startedAt: data.active_session.started_at,
          activityName: data.active_session.activity_name ?? "",
          roomName: data.active_session.room_name ?? "",
        }
      : null,
  };
}

// Slug helpers

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

// Person types for operator person listing + soft delete

export interface OperatorPerson {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  hasAccount: boolean;
  accountEmail: string | null;
  hasRfidCard: boolean;
  isStaff: boolean;
  isStudent: boolean;
  schoolId: string;
  schoolName: string;
  organizationId: string;
  organizationName: string;
  createdAt: string;
}

export function mapOperatorPerson(data: WireOperatorPerson): OperatorPerson {
  return {
    id: data.id,
    firstName: data.first_name,
    lastName: data.last_name,
    fullName: `${data.first_name} ${data.last_name}`,
    hasAccount: data.has_account,
    accountEmail: data.account_email ?? null,
    hasRfidCard: data.has_rfid_card,
    isStaff: data.is_staff,
    isStudent: data.is_student,
    schoolId: data.school_id,
    schoolName: data.school_name,
    organizationId: data.organization_id,
    organizationName: data.organization_name,
    createdAt: data.created_at,
  };
}

export interface UnregisteredTagScan {
  id: string;
  tenantId: string;
  tagUid: string;
  deviceId: string | null;
  scannedAt: string;
  resolvedAt: string | null;
  resolvedByOperatorId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  schoolId: string;
  schoolName: string;
  organizationId: string;
  organizationName: string;
  deviceIdentifier: string | null;
  deviceName: string | null;
}

export function mapUnregisteredTagScan(
  data: WireUnregisteredTagScan,
): UnregisteredTagScan {
  return {
    id: data.id,
    tenantId: data.tenant_id,
    tagUid: data.tag_uid,
    deviceId: data.device_id ?? null,
    scannedAt: data.scanned_at,
    resolvedAt: data.resolved_at ?? null,
    resolvedByOperatorId: data.resolved_by_operator_id ?? null,
    resolutionNote: data.resolution_note ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // Go fills school and Träger on every listed scan; omitempty only types
    // them optional.
    schoolId: data.school_id ?? "",
    schoolName: data.school_name ?? "",
    organizationId: data.organization_id ?? "",
    organizationName: data.organization_name ?? "",
    deviceIdentifier: data.device_identifier ?? null,
    deviceName: data.device_name ?? null,
  };
}

/** Shown when the browser refuses to copy an API key (#2519). */
export const API_KEY_COPY_FAILED_MESSAGE =
  "Der API-Key konnte nicht kopiert werden. Bitte markiere und kopiere ihn selbst.";

// --- Träger-Büro (#4649) ---

export { TRAEGER_ROLE_LABELS, type TraegerRole } from "~/lib/traeger-roles";

// Go does not register these sets; the contract types them as string.
const TRAEGER_MEMBER_STATUS_VALUES = ["active", "pending", "inactive"] as const;
const TRAEGER_RECORDS_CHOICE_VALUES = [
  "handed_over",
  "erasure_chosen",
] as const;

export type TraegerMemberStatus = (typeof TRAEGER_MEMBER_STATUS_VALUES)[number];

export const TRAEGER_MEMBER_STATUS_LABELS: Readonly<
  Record<TraegerMemberStatus, string>
> = {
  active: "Aktiv",
  pending: "Eingeladen",
  inactive: "Inaktiv",
};

export interface TraegerMember {
  accountId: string;
  email: string;
  /** undefined: a status this build does not know. */
  status: TraegerMemberStatus | undefined;
  roles: TraegerRole[];
  activatedAt: string | null;
}

export function mapTraegerMember(data: WireTraegerMember): TraegerMember {
  return {
    accountId: data.account_id,
    email: data.email,
    status: knownEnum(TRAEGER_MEMBER_STATUS_VALUES, data.status),
    // A role this client does not know yet stays out instead of showing a
    // raw key.
    roles: (data.roles ?? []).filter(isTraegerRole),
    activatedAt: data.activated_at,
  };
}

export type AssignTraegerMemberRequest = traegerMemberRequest & {
  email: string;
  roles: TraegerRole[];
};

/** The operator's invitation into a Träger-Büro (#5144). */
export type InviteTraegerMemberRequest = AssignTraegerMemberRequest;

/**
 * An invitation into the Träger-Büro that is neither accepted nor taken back
 * (#5749). `expired` marks a link the person can no longer use; the backend
 * deletes it later.
 */
export interface TraegerInvitation {
  id: string;
  email: string;
  roles: TraegerRole[];
  expiresAt: string;
  expired: boolean;
}

export function mapTraegerInvitation(
  data: WireTraegerInvitation,
): TraegerInvitation {
  return {
    id: data.id,
    email: data.email,
    roles: (data.roles ?? []).filter(isTraegerRole),
    expiresAt: data.expires_at,
    expired: data.expired,
  };
}

/**
 * Choice of the customer after the hint on records subject to retention
 * (#4720, AVV Ziff. 8.4): Rückgabe handed over, or lawful erasure chosen.
 */
export type TraegerRecordsChoice =
  (typeof TRAEGER_RECORDS_CHOICE_VALUES)[number];

/**
 * Löschauftrag eines deaktivierten Trägers (#4657). Kalenderdaten bleiben
 * "YYYY-MM-DD"-Strings.
 */
export interface TraegerErasureOrder {
  id: string;
  organizationId: string;
  orderReference: string;
  confirmedOn: string;
  eraseNotBefore: string;
  recordedAt: string;
  /** Set once the internal erasure began; then the order stays. */
  startedAt: string | null;
  /**
   * Null on orders recorded before #4720; undefined: a choice is recorded,
   * but this build does not know it.
   */
  recordsChoice: TraegerRecordsChoice | null | undefined;
  recordsHandedOverOn: string | null;
  recordsExportSha256: string | null;
}

export function mapTraegerErasureOrder(
  data: WireTraegerErasureOrder,
): TraegerErasureOrder {
  return {
    id: data.id,
    organizationId: data.organization_id,
    orderReference: data.order_reference,
    confirmedOn: requiredDay(
      data.confirmed_on,
      "TraegerErasureOrder.confirmed_on",
    ),
    eraseNotBefore: requiredDay(
      data.erase_not_before,
      "TraegerErasureOrder.erase_not_before",
    ),
    recordedAt: data.recorded_at,
    startedAt: data.started_at ?? null,
    recordsChoice: data.records_choice
      ? knownEnum(TRAEGER_RECORDS_CHOICE_VALUES, data.records_choice)
      : null,
    recordsHandedOverOn: data.records_handed_over_on ?? null,
    recordsExportSha256: data.records_export_sha256 || null,
  };
}

export type RecordTraegerErasureOrderRequest =
  recordTraegerErasureOrderRequest & {
    order_reference: string;
    confirmed_on: string;
    erase_not_before: string;
    records_notice_acknowledged: boolean;
    records_choice: TraegerRecordsChoice;
  };

/**
 * The hint and the customer's choice recorded afterwards on an open order
 * that was recorded without them (#4720), also once the erasure started.
 */
export type RecordTraegerErasureOrderRecordsRequest =
  recordTraegerErasureOrderRecordsRequest & {
    records_notice_acknowledged: boolean;
    records_choice: TraegerRecordsChoice;
  };

export interface OperatorCaterer {
  id: string;
  accountId: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
}

export function mapOperatorCaterer(data: WireOperatorCaterer): OperatorCaterer {
  return {
    id: data.id,
    accountId: data.account_id,
    name: data.name,
    email: data.email,
    mfaEnabled: data.mfa_enabled,
  };
}
