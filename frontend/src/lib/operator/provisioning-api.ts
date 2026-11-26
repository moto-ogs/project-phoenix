import {
  accountPage,
  type AccountPage,
  type AccountPageQuery,
  type AccountScope,
} from "./account-pages";
import { bffJson } from "~/lib/bff-fetch";
import type * as operatorDevicesContract from "~/lib/contract/operator-devices.generated";
import type * as operatorSchoolsContract from "~/lib/contract/operator-schools.generated";
import type * as operatorUnregisteredTagScansContract from "~/lib/contract/operator-unregistered-tag-scans.generated";
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
    const data = await bffJson("platform", "GET /operator/stats");
    return mapProvisioningStats(data);
  }

  async listOrganizationSummaries(): Promise<OrganizationSummary[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/summaries",
    );
    return data.map(mapOrganizationSummary);
  }

  async listSchoolSummaries(): Promise<SchoolSummary[]> {
    const data = await bffJson("platform", "GET /operator/schools/summaries");
    return data.map(mapSchoolSummary);
  }

  async listSchoolRequiredDetails(): Promise<SchoolRequiredDetails[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/schools/required-details",
    );
    return data.map(mapSchoolRequiredDetails);
  }

  async listOrganizationSchools(
    organizationId: string,
  ): Promise<SchoolSummary[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/schools",
      { params: { id: organizationId } },
    );
    return data.map(mapSchoolSummary);
  }

  async listOrganizations(): Promise<Organization[]> {
    const data = await bffJson("platform", "GET /operator/organizations/");
    return data.map(mapOrganization);
  }

  async createOrganization(
    data: CreateOrganizationRequest,
  ): Promise<Organization> {
    const result = await bffJson("platform", "POST /operator/organizations/", {
      body: data,
    });
    return mapOrganization(result);
  }

  async listSchools(): Promise<School[]> {
    const data = await bffJson("platform", "GET /operator/schools/");
    return data.map(mapSchool);
  }

  async createSchool(data: CreateSchoolRequest): Promise<School> {
    const result = await bffJson("platform", "POST /operator/schools/", {
      body: data,
    });
    return mapSchool(result);
  }

  async updateOrganization(
    id: string,
    data: UpdateOrganizationRequest,
  ): Promise<Organization> {
    const result = await bffJson(
      "platform",
      "PUT /operator/organizations/{id}",
      { params: { id }, body: data },
    );
    return mapOrganization(result);
  }

  async updateSchool(id: string, data: UpdateSchoolRequest): Promise<School> {
    const result = await bffJson("platform", "PUT /operator/schools/{id}", {
      params: { id },
      body: data,
    });
    return mapSchool(result);
  }

  async listAccountPage(
    scope: AccountScope,
    query: AccountPageQuery,
  ): Promise<AccountPage> {
    if (scope.kind === "school") {
      const { data, pagination } = await bffJson(
        "platform",
        "GET /operator/schools/{id}/accounts",
        { params: { id: scope.id }, query },
      );
      return accountPage(data.map(mapSchoolAccount), pagination);
    }
    if (scope.kind === "organization") {
      const { data, pagination } = await bffJson(
        "platform",
        "GET /operator/organizations/{id}/accounts",
        { params: { id: scope.id }, query },
      );
      return accountPage(data.map(mapOrgAccount), pagination);
    }
    const { data, pagination } = await bffJson(
      "platform",
      "GET /operator/accounts",
      { query },
    );
    return accountPage(data.map(mapOrgAccount), pagination);
  }

  /** The caterers with the state of their two-factor sign-in (#4497). */
  async listCaterers(): Promise<OperatorCaterer[]> {
    const data = await bffJson("platform", "GET /operator/caterers");
    return data.map(mapOperatorCaterer);
  }

  async listTraegerMembers(orgId: string): Promise<TraegerMember[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/traeger-members",
      { params: { id: orgId } },
    );
    return data.map(mapTraegerMember);
  }

  async assignTraegerMember(
    orgId: string,
    data: AssignTraegerMemberRequest,
  ): Promise<TraegerMember> {
    const result = await bffJson(
      "platform",
      "POST /operator/organizations/{id}/traeger-members",
      { params: { id: orgId }, body: data },
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
    await bffJson(
      "platform",
      "POST /operator/organizations/{id}/traeger-members/invitations",
      { params: { id: orgId }, body: data },
    );
  }

  /** Open and expired invitations into the Träger-Büro (#5749). */
  async listTraegerInvitations(orgId: string): Promise<TraegerInvitation[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/traeger-members/invitations",
      { params: { id: orgId } },
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
    const result = await bffJson(
      "platform",
      "POST /operator/organizations/{id}/traeger-members/invitations/{invitationId}/resend",
      { params: { id: orgId, invitationId } },
    );
    return mapTraegerInvitation(result);
  }

  /** Takes an invitation back; its link stops working (#5749). */
  async revokeTraegerInvitation(
    orgId: string,
    invitationId: string,
  ): Promise<void> {
    await bffJson(
      "platform",
      "DELETE /operator/organizations/{id}/traeger-members/invitations/{invitationId}",
      { params: { id: orgId, invitationId } },
    );
  }

  async getTraegerErasureOrder(
    orgId: string,
  ): Promise<TraegerErasureOrder | null> {
    // The backend answers without an order when none is open.
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/erasure-order",
      { params: { id: orgId } },
    );
    return data ? mapTraegerErasureOrder(data) : null;
  }

  async recordTraegerErasureOrder(
    orgId: string,
    data: RecordTraegerErasureOrderRequest,
  ): Promise<TraegerErasureOrder> {
    const result = await bffJson(
      "platform",
      "POST /operator/organizations/{id}/erasure-order",
      { params: { id: orgId }, body: data },
    );
    return mapTraegerErasureOrder(result);
  }

  async recordTraegerErasureOrderRecords(
    orgId: string,
    data: RecordTraegerErasureOrderRecordsRequest,
  ): Promise<TraegerErasureOrder> {
    const result = await bffJson(
      "platform",
      "PUT /operator/organizations/{id}/erasure-order/records",
      { params: { id: orgId }, body: data },
    );
    return mapTraegerErasureOrder(result);
  }

  async withdrawTraegerErasureOrder(orgId: string): Promise<void> {
    await bffJson(
      "platform",
      "DELETE /operator/organizations/{id}/erasure-order",
      { params: { id: orgId } },
    );
  }

  async createTestTraeger(
    data: CreateTestTraegerRequest,
  ): Promise<TestTraeger> {
    const result = await bffJson(
      "platform",
      "POST /operator/organizations/test-traeger",
      { body: data },
    );
    return mapTestTraeger(result);
  }

  async createSampleChildren(orgId: string): Promise<SampleChildrenResult> {
    const result = await bffJson(
      "platform",
      "POST /operator/organizations/{id}/sample-children",
      { params: { id: orgId } },
    );
    return mapSampleChildrenResult(result);
  }

  async listAllDevices(): Promise<OperatorDevice[]> {
    const data = await bffJson("platform", "GET /operator/devices/");
    return data.map((device) => mapOperatorDevice(device));
  }

  async listSchoolDevices(schoolId: string): Promise<OperatorDevice[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/schools/{id}/devices",
      { params: { id: schoolId } },
    );
    return data.map((device) => mapOperatorDevice(device));
  }

  async listOrganizationDevices(orgId: string): Promise<OperatorDevice[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/devices",
      { params: { id: orgId } },
    );
    return data.map((device) => mapOperatorDevice(device));
  }

  async createDevice(data: CreateDeviceRequest): Promise<OperatorDevice> {
    const result = await bffJson("platform", "POST /operator/devices/", {
      body: data,
    });
    return mapOperatorDevice(result, true);
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await bffJson("platform", "DELETE /operator/devices/{id}", {
      params: { id: deviceId },
    });
  }

  async setDeviceAPIKey(
    deviceId: string,
    apiKey?: string,
  ): Promise<OperatorDevice> {
    const result = await bffJson(
      "platform",
      "POST /operator/devices/{id}/set-api-key",
      {
        params: { id: deviceId },
        body: (apiKey
          ? { api_key: apiKey }
          : {}) satisfies operatorDevicesContract.setDeviceAPIKeyRequest,
      },
    );
    return mapOperatorDevice(result, true);
  }

  async getDeviceTransferStatus(
    deviceId: string,
  ): Promise<DeviceTransferStatus> {
    const result = await bffJson(
      "platform",
      "GET /operator/devices/{id}/transfer-status",
      { params: { id: deviceId } },
    );
    return mapDeviceTransferStatus(result);
  }

  /**
   * The history of one device across the schools it went through, newest
   * first (#2321). Each entry names its school; staff stay unnamed.
   */
  async listDeviceHistory(deviceId: string): Promise<DeviceHistoryEntry[]> {
    const result = await bffJson(
      "platform",
      "GET /operator/devices/{id}/history",
      { params: { id: deviceId } },
    );
    return result.map(mapDeviceHistoryEntry);
  }

  /**
   * Blocks or unblocks a device (Gerätesperre, #2317). The route answers
   * without data; the caller reloads the device list.
   */
  async setDeviceBlocked(deviceId: string, blocked: boolean): Promise<void> {
    await bffJson(
      "platform",
      blocked
        ? "POST /operator/devices/{id}/block"
        : "POST /operator/devices/{id}/unblock",
      { params: { id: deviceId } },
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
    await bffJson("platform", "PUT /operator/schools/{id}/device-slots", {
      params: { id: schoolId },
      body: {
        device_slots: deviceSlots,
      } satisfies operatorSchoolsContract.deviceSlotsRequest,
    });
  }

  async transferDevice(
    deviceId: string,
    targetSchoolId: string,
  ): Promise<OperatorDevice> {
    const result = await bffJson(
      "platform",
      "POST /operator/devices/{id}/transfer",
      {
        params: { id: deviceId },
        body: {
          target_school_id: targetSchoolId,
        } satisfies operatorDevicesContract.transferDeviceRequest,
      },
    );
    return mapOperatorDevice(result);
  }

  async inviteSchoolAdmin(
    schoolId: string,
    data: InviteAdminRequest,
  ): Promise<Invitation> {
    const result = await bffJson(
      "platform",
      "POST /operator/schools/{id}/invite-admin",
      { params: { id: schoolId }, body: data },
    );
    return mapInvitation(result);
  }

  async createSchoolAccount(
    schoolId: string,
    data: CreateAccountRequest,
  ): Promise<{ id: string; email: string }> {
    const result = await bffJson(
      "platform",
      "POST /operator/schools/{id}/create-account",
      { params: { id: schoolId }, body: data },
    );
    return { id: result.id, email: result.email };
  }

  async getSchoolPWAUsage(schoolId: string): Promise<SchoolPWAUsage> {
    const data = await bffJson(
      "platform",
      "GET /operator/schools/{id}/pwa-usage",
      { params: { id: schoolId } },
    );
    return mapSchoolPWAUsage(data);
  }

  async listSchoolPersons(schoolId: string): Promise<OperatorPerson[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/schools/{id}/persons",
      { params: { id: schoolId } },
    );
    return data.map(mapOperatorPerson);
  }

  async listOrganizationPersons(
    organizationId: string,
  ): Promise<OperatorPerson[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/persons",
      { params: { id: organizationId } },
    );
    return data.map(mapOperatorPerson);
  }

  async softDeletePerson(personId: string): Promise<void> {
    await bffJson("platform", "DELETE /operator/persons/{id}", {
      params: { id: personId },
    });
  }

  async listUnregisteredTagScans(options: {
    organizationId?: string;
    schoolId?: string;
    resolved?: "unresolved" | "all";
  }): Promise<UnregisteredTagScan[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/unregistered-tag-scans/",
      {
        query: {
          organization_id: options.organizationId || undefined,
          school_id: options.schoolId || undefined,
          resolved: options.resolved === "all" ? "all" : undefined,
        },
      },
    );
    return data.map(mapUnregisteredTagScan);
  }

  async resolveUnregisteredTagScan(id: string, note?: string): Promise<void> {
    const body: operatorUnregisteredTagScansContract.resolveUnregisteredTagScanRequest =
      note ? { note } : {};
    await bffJson(
      "platform",
      "POST /operator/unregistered-tag-scans/{id}/resolve",
      { params: { id }, body },
    );
  }

  async softDeleteOrganization(id: string): Promise<void> {
    await bffJson("platform", "DELETE /operator/organizations/{id}", {
      params: { id },
    });
  }

  async restoreOrganization(id: string): Promise<void> {
    await bffJson("platform", "POST /operator/organizations/{id}/restore", {
      params: { id },
    });
  }

  async softDeleteSchool(id: string): Promise<void> {
    await bffJson("platform", "DELETE /operator/schools/{id}", {
      params: { id },
    });
  }

  async restoreSchool(id: string): Promise<void> {
    await bffJson("platform", "POST /operator/schools/{id}/restore", {
      params: { id },
    });
  }

  async listSystemRoles(): Promise<
    { id: string; name: string; isSystem: boolean }[]
  > {
    const result = await bffJson("platform", "GET /operator/roles");
    return result.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.is_system,
    }));
  }
}

export const operatorProvisioningService = new OperatorProvisioningService();
