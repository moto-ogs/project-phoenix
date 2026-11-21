import { operatorFetch } from "./api-helpers";
import type {
  deviceHistoryResponse,
  DeviceTransferStatus as WireDeviceTransferStatus,
  setDeviceAPIKeyRequest,
  transferDeviceRequest,
} from "~/lib/contract/operator-devices.generated";
import type {
  OrganizationSummary as WireOrganizationSummary,
  SampleChildrenResult as WireSampleChildrenResult,
  TestTraeger as WireTestTraeger,
  TraegerErasureOrder as WireTraegerErasureOrder,
  TraegerInvitation as WireTraegerInvitation,
  TraegerMember as WireTraegerMember,
} from "~/lib/contract/operator-organizations.generated";
import type {
  CreatedAccount,
  SchoolAccount as WireSchoolAccount,
  SchoolPWAUsage as WireSchoolPWAUsage,
  SchoolRequiredDetails as WireSchoolRequiredDetails,
  deviceSlotsRequest,
  operatorInvitationResponse as WireInvitation,
} from "~/lib/contract/operator-schools.generated";
import type { SystemRole } from "~/lib/contract/operator-roles.generated";
import type { ProvisioningStats as WireProvisioningStats } from "~/lib/contract/operator-stats.generated";
import type {
  resolveUnregisteredTagScanRequest,
  scanResponse as WireUnregisteredTagScan,
} from "~/lib/contract/operator-unregistered-tag-scans.generated";
import type { CatererSecurityResponse as WireOperatorCaterer } from "~/lib/contract/operator-caterers.generated";
import type {
  OperatorDevice as WireOperatorDevice,
  OperatorPerson as WireOperatorPerson,
  Organization as WireOrganization,
  OrganizationAccount as WireOrgAccount,
  School as WireSchool,
  SchoolSummary as WireSchoolSummary,
} from "~/lib/contract/shared.generated";
import {
  mapDeviceHistoryEntry,
  type DeviceHistoryEntry,
} from "~/lib/device-history";
import type {
  SchoolRequiredDetails,
  Organization,
  OrganizationSummary,
  ProvisioningStats,
  School,
  SchoolSummary,
  Invitation,
  SchoolAccount,
  OrgAccount,
  OperatorDevice,
  OperatorPerson,
  UnregisteredTagScan,
  CreateOrganizationRequest,
  CreateTestTraegerRequest,
  TestTraeger,
  SampleChildrenResult,
  CreateSchoolRequest,
  CreateDeviceRequest,
  InviteAdminRequest,
  CreateAccountRequest,
  UpdateOrganizationRequest,
  UpdateSchoolRequest,
  DeviceTransferStatus,
  SchoolPWAUsage,
  AssignTraegerMemberRequest,
  InviteTraegerMemberRequest,
  TraegerInvitation,
  OperatorCaterer,
  TraegerMember,
  RecordTraegerErasureOrderRequest,
  RecordTraegerErasureOrderRecordsRequest,
  TraegerErasureOrder,
} from "./provisioning-helpers";
import {
  mapOrganization,
  mapOrganizationSummary,
  mapProvisioningStats,
  mapSchool,
  mapSchoolSummary,
  mapSchoolRequiredDetails,
  mapInvitation,
  mapSchoolAccount,
  mapOrgAccount,
  mapOperatorDevice,
  mapOperatorPerson,
  mapUnregisteredTagScan,
  mapDeviceTransferStatus,
  mapSchoolPWAUsage,
  mapTraegerMember,
  mapTraegerInvitation,
  mapOperatorCaterer,
  mapTraegerErasureOrder,
  mapTestTraeger,
  mapSampleChildrenResult,
} from "./provisioning-helpers";

class OperatorProvisioningService {
  async getStats(): Promise<ProvisioningStats> {
    const data = await operatorFetch<WireProvisioningStats>(
      "/api/operator/stats",
    );
    return mapProvisioningStats(data);
  }

  async listOrganizationSummaries(): Promise<OrganizationSummary[]> {
    const data = await operatorFetch<WireOrganizationSummary[]>(
      "/api/operator/organizations/summaries",
    );
    return data.map(mapOrganizationSummary);
  }

  async listSchoolSummaries(): Promise<SchoolSummary[]> {
    const data = await operatorFetch<WireSchoolSummary[]>(
      "/api/operator/schools/summaries",
    );
    return data.map(mapSchoolSummary);
  }

  async listSchoolRequiredDetails(): Promise<SchoolRequiredDetails[]> {
    const data = await operatorFetch<WireSchoolRequiredDetails[]>(
      "/api/operator/schools/required-details",
    );
    return data.map(mapSchoolRequiredDetails);
  }

  async listOrganizationSchools(
    organizationId: string,
  ): Promise<SchoolSummary[]> {
    const data = await operatorFetch<WireSchoolSummary[]>(
      `/api/operator/organizations/${encodeURIComponent(organizationId)}/schools`,
    );
    return data.map(mapSchoolSummary);
  }

  async listOrganizations(): Promise<Organization[]> {
    const data = await operatorFetch<WireOrganization[]>(
      "/api/operator/organizations",
    );
    return data.map(mapOrganization);
  }

  async createOrganization(
    data: CreateOrganizationRequest,
  ): Promise<Organization> {
    const result = await operatorFetch<WireOrganization>(
      "/api/operator/organizations",
      { method: "POST", body: data },
    );
    return mapOrganization(result);
  }

  async listSchools(): Promise<School[]> {
    const data = await operatorFetch<WireSchool[]>("/api/operator/schools");
    return data.map(mapSchool);
  }

  async createSchool(data: CreateSchoolRequest): Promise<School> {
    const result = await operatorFetch<WireSchool>("/api/operator/schools", {
      method: "POST",
      body: data,
    });
    return mapSchool(result);
  }

  async updateOrganization(
    id: string,
    data: UpdateOrganizationRequest,
  ): Promise<Organization> {
    const result = await operatorFetch<WireOrganization>(
      `/api/operator/organizations/${encodeURIComponent(id)}`,
      { method: "PUT", body: data },
    );
    return mapOrganization(result);
  }

  async updateSchool(id: string, data: UpdateSchoolRequest): Promise<School> {
    const result = await operatorFetch<WireSchool>(
      `/api/operator/schools/${encodeURIComponent(id)}`,
      { method: "PUT", body: data },
    );
    return mapSchool(result);
  }

  async listSchoolAccounts(schoolId: string): Promise<SchoolAccount[]> {
    const data = await operatorFetch<WireSchoolAccount[]>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/accounts`,
    );
    return data.map(mapSchoolAccount);
  }

  async listOrganizationAccounts(orgId: string): Promise<OrgAccount[]> {
    const data = await operatorFetch<WireOrgAccount[]>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/accounts`,
    );
    return data.map(mapOrgAccount);
  }

  /** The caterers with the state of their two-factor sign-in (#4497). */
  async listCaterers(): Promise<OperatorCaterer[]> {
    const data = await operatorFetch<WireOperatorCaterer[]>(
      "/api/operator/caterers",
    );
    return data.map(mapOperatorCaterer);
  }

  async listTraegerMembers(orgId: string): Promise<TraegerMember[]> {
    const data = await operatorFetch<WireTraegerMember[]>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/traeger-members`,
    );
    return data.map(mapTraegerMember);
  }

  async assignTraegerMember(
    orgId: string,
    data: AssignTraegerMemberRequest,
  ): Promise<TraegerMember> {
    const result = await operatorFetch<WireTraegerMember>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/traeger-members`,
      { method: "POST", body: data },
    );
    return mapTraegerMember(result);
  }

  /**
   * Sends the Träger-Büro's invitation mail (#5144). It appears in
   * `listTraegerInvitations` at once.
   */
  async inviteTraegerMember(
    orgId: string,
    data: InviteTraegerMemberRequest,
  ): Promise<void> {
    await operatorFetch<unknown>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/traeger-members/invitations`,
      { method: "POST", body: data },
    );
  }

  /** Open and expired invitations into the Träger-Büro (#5749). */
  async listTraegerInvitations(orgId: string): Promise<TraegerInvitation[]> {
    const data = await operatorFetch<WireTraegerInvitation[]>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/traeger-members/invitations`,
    );
    return data.map(mapTraegerInvitation);
  }

  /**
   * Sends the invitation again with a new link and a new validity; the old
   * link stops working (#5749).
   */
  async resendTraegerInvitation(
    orgId: string,
    invitationId: string,
  ): Promise<TraegerInvitation> {
    const result = await operatorFetch<WireTraegerInvitation>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/traeger-members/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: "POST" },
    );
    return mapTraegerInvitation(result);
  }

  /** Takes an invitation back; its link stops working (#5749). */
  async revokeTraegerInvitation(
    orgId: string,
    invitationId: string,
  ): Promise<void> {
    await operatorFetch<unknown>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/traeger-members/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE" },
    );
  }

  async getTraegerErasureOrder(
    orgId: string,
  ): Promise<TraegerErasureOrder | null> {
    // The backend answers without an order when none is open.
    const data = await operatorFetch<WireTraegerErasureOrder | null>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/erasure-order`,
    );
    return data ? mapTraegerErasureOrder(data) : null;
  }

  async recordTraegerErasureOrder(
    orgId: string,
    data: RecordTraegerErasureOrderRequest,
  ): Promise<TraegerErasureOrder> {
    const result = await operatorFetch<WireTraegerErasureOrder>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/erasure-order`,
      { method: "POST", body: data },
    );
    return mapTraegerErasureOrder(result);
  }

  async recordTraegerErasureOrderRecords(
    orgId: string,
    data: RecordTraegerErasureOrderRecordsRequest,
  ): Promise<TraegerErasureOrder> {
    const result = await operatorFetch<WireTraegerErasureOrder>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/erasure-order/records`,
      { method: "PUT", body: data },
    );
    return mapTraegerErasureOrder(result);
  }

  async withdrawTraegerErasureOrder(orgId: string): Promise<void> {
    await operatorFetch<unknown>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/erasure-order`,
      { method: "DELETE" },
    );
  }

  async createTestTraeger(
    data: CreateTestTraegerRequest,
  ): Promise<TestTraeger> {
    const result = await operatorFetch<WireTestTraeger>(
      "/api/operator/organizations/test-traeger",
      { method: "POST", body: data },
    );
    return mapTestTraeger(result);
  }

  async createSampleChildren(orgId: string): Promise<SampleChildrenResult> {
    const result = await operatorFetch<WireSampleChildrenResult>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/sample-children`,
      { method: "POST", body: {} },
    );
    return mapSampleChildrenResult(result);
  }

  async listAllAccounts(): Promise<OrgAccount[]> {
    const data = await operatorFetch<WireOrgAccount[]>(
      "/api/operator/accounts",
    );
    return data.map(mapOrgAccount);
  }

  async listAllDevices(): Promise<OperatorDevice[]> {
    const data = await operatorFetch<WireOperatorDevice[]>(
      "/api/operator/devices",
    );
    return data.map((device) => mapOperatorDevice(device));
  }

  async listSchoolDevices(schoolId: string): Promise<OperatorDevice[]> {
    const data = await operatorFetch<WireOperatorDevice[]>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/devices`,
    );
    return data.map((device) => mapOperatorDevice(device));
  }

  async listOrganizationDevices(orgId: string): Promise<OperatorDevice[]> {
    const data = await operatorFetch<WireOperatorDevice[]>(
      `/api/operator/organizations/${encodeURIComponent(orgId)}/devices`,
    );
    return data.map((device) => mapOperatorDevice(device));
  }

  async createDevice(data: CreateDeviceRequest): Promise<OperatorDevice> {
    const result = await operatorFetch<WireOperatorDevice>(
      "/api/operator/devices",
      { method: "POST", body: data },
    );
    return mapOperatorDevice(result, true);
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await operatorFetch<null>(
      `/api/operator/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    );
  }

  async setDeviceAPIKey(
    deviceId: string,
    apiKey?: string,
  ): Promise<OperatorDevice> {
    const result = await operatorFetch<WireOperatorDevice>(
      `/api/operator/devices/${encodeURIComponent(deviceId)}/set-api-key`,
      {
        method: "POST",
        body: (apiKey
          ? { api_key: apiKey }
          : {}) satisfies setDeviceAPIKeyRequest,
      },
    );
    return mapOperatorDevice(result, true);
  }

  async getDeviceTransferStatus(
    deviceId: string,
  ): Promise<DeviceTransferStatus> {
    const result = await operatorFetch<WireDeviceTransferStatus>(
      `/api/operator/devices/${encodeURIComponent(deviceId)}/transfer-status`,
    );
    return mapDeviceTransferStatus(result);
  }

  /**
   * The history of one device across the schools it went through, newest
   * first (#2321). Each entry names its school; staff stay unnamed.
   */
  async listDeviceHistory(deviceId: string): Promise<DeviceHistoryEntry[]> {
    const result = await operatorFetch<deviceHistoryResponse[]>(
      `/api/operator/devices/${encodeURIComponent(deviceId)}/history`,
    );
    return result.map(mapDeviceHistoryEntry);
  }

  /**
   * Blocks or unblocks a device (Gerätesperre, #2317). The route answers
   * without data; the caller reloads the device list.
   */
  async setDeviceBlocked(deviceId: string, blocked: boolean): Promise<void> {
    await operatorFetch<null>(
      `/api/operator/devices/${encodeURIComponent(deviceId)}/${blocked ? "block" : "unblock"}`,
      { method: "POST" },
    );
  }

  /**
   * Setzt die Geräteplätze einer Schule (#2312); null entfernt die Grenze.
   * Eine Zahl unter den registrierten Geräten lehnt das Backend ab
   * (provisioning.device_slots_below_occupied).
   */
  async setSchoolDeviceSlots(
    schoolId: string,
    deviceSlots: number | null,
  ): Promise<void> {
    await operatorFetch<null>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/device-slots`,
      {
        method: "PUT",
        body: { device_slots: deviceSlots } satisfies deviceSlotsRequest,
      },
    );
  }

  async transferDevice(
    deviceId: string,
    targetSchoolId: string,
  ): Promise<OperatorDevice> {
    const result = await operatorFetch<WireOperatorDevice>(
      `/api/operator/devices/${encodeURIComponent(deviceId)}/transfer`,
      {
        method: "POST",
        body: {
          target_school_id: targetSchoolId,
        } satisfies transferDeviceRequest,
      },
    );
    return mapOperatorDevice(result);
  }

  async inviteSchoolAdmin(
    schoolId: string,
    data: InviteAdminRequest,
  ): Promise<Invitation> {
    const result = await operatorFetch<WireInvitation>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/invite-admin`,
      { method: "POST", body: data },
    );
    return mapInvitation(result);
  }

  async createSchoolAccount(
    schoolId: string,
    data: CreateAccountRequest,
  ): Promise<{ id: string; email: string }> {
    const result = await operatorFetch<CreatedAccount>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/create-account`,
      { method: "POST", body: data },
    );
    return { id: result.id, email: result.email };
  }

  async getSchoolPWAUsage(schoolId: string): Promise<SchoolPWAUsage> {
    const data = await operatorFetch<WireSchoolPWAUsage>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/pwa-usage`,
    );
    return mapSchoolPWAUsage(data);
  }

  async listSchoolPersons(schoolId: string): Promise<OperatorPerson[]> {
    const data = await operatorFetch<WireOperatorPerson[]>(
      `/api/operator/schools/${encodeURIComponent(schoolId)}/persons`,
    );
    return data.map(mapOperatorPerson);
  }

  async listOrganizationPersons(
    organizationId: string,
  ): Promise<OperatorPerson[]> {
    const data = await operatorFetch<WireOperatorPerson[]>(
      `/api/operator/organizations/${encodeURIComponent(organizationId)}/persons`,
    );
    return data.map(mapOperatorPerson);
  }

  async softDeletePerson(personId: string): Promise<void> {
    await operatorFetch<null>(
      `/api/operator/persons/${encodeURIComponent(personId)}`,
      { method: "DELETE" },
    );
  }

  async listUnregisteredTagScans(options: {
    organizationId?: string;
    schoolId?: string;
    resolved?: "unresolved" | "all";
  }): Promise<UnregisteredTagScan[]> {
    const params = new URLSearchParams();
    if (options.organizationId) {
      params.set("organization_id", options.organizationId);
    }
    if (options.schoolId) {
      params.set("school_id", options.schoolId);
    }
    if (options.resolved === "all") {
      params.set("resolved", "all");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await operatorFetch<WireUnregisteredTagScan[]>(
      `/api/operator/unregistered-tag-scans${suffix}`,
    );
    return data.map(mapUnregisteredTagScan);
  }

  async resolveUnregisteredTagScan(id: string, note?: string): Promise<void> {
    const body: resolveUnregisteredTagScanRequest = note ? { note } : {};
    await operatorFetch<WireUnregisteredTagScan>(
      `/api/operator/unregistered-tag-scans/${encodeURIComponent(id)}/resolve`,
      { method: "POST", body },
    );
  }

  async softDeleteOrganization(id: string): Promise<void> {
    await operatorFetch(
      `/api/operator/organizations/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  async restoreOrganization(id: string): Promise<void> {
    await operatorFetch(
      `/api/operator/organizations/${encodeURIComponent(id)}/restore`,
      { method: "POST" },
    );
  }

  async softDeleteSchool(id: string): Promise<void> {
    await operatorFetch(`/api/operator/schools/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async restoreSchool(id: string): Promise<void> {
    await operatorFetch(
      `/api/operator/schools/${encodeURIComponent(id)}/restore`,
      { method: "POST" },
    );
  }

  async listSystemRoles(): Promise<
    { id: string; name: string; isSystem: boolean }[]
  > {
    const result = await operatorFetch<SystemRole[]>(`/api/operator/roles`);
    return result.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.is_system,
    }));
  }
}

export const operatorProvisioningService = new OperatorProvisioningService();

/**
 * Purges the Next.js ISR cache for the given tenant subdomain slugs so stale
 * tenant-resolution does not linger (~5 min) after a slug change, delete,
 * restore, or active-flag toggle. Fire-and-forget: on failure the cache
 * self-heals within its TTL, so callers must never block success flow.
 */
export async function revalidateTenantCache(slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  try {
    await fetch("/api/operator/provisioning/revalidate-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs }),
    });
  } catch {
    // Cache self-heals in ≤5 min; don't block the success flow.
  }
}
