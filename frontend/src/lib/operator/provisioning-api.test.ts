import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as operatorSchoolsContract from "~/lib/contract/operator-schools.generated";
import type * as operatorUnregisteredTagScansContract from "~/lib/contract/operator-unregistered-tag-scans.generated";
import type * as sharedContract from "~/lib/contract/shared.generated";

const { mockBffJson } = vi.hoisted(() => ({
  mockBffJson: vi.fn(),
}));

vi.mock("~/lib/bff-fetch", () => ({ bffJson: mockBffJson }));

import { operatorProvisioningService } from "./provisioning-api";

const NOW = "2026-03-15T10:00:00Z";

const mockBackendOrg: sharedContract.Organization = {
  version: "v-1",
  test_system: false,
  id: "5",
  name: "Stadt Köln",
  slug: "stadt-koeln",
  active: true,
  deleted_at: undefined,
  settings: undefined,
  created_at: NOW,
  updated_at: NOW,
};

const mockBackendSchool: sharedContract.School = {
  version: "v-1",
  child_quota_bundles: null,
  child_quota_bundle_size: 0,
  device_slots: null,
  id: "10",
  organization_id: "5",
  name: "GGS Europaschule",
  slug: "ggs-europa",
  subdomain: "ggs-europa",
  address: "Hauptstr. 1",
  city: "Köln",
  zip: "50667",
  phone: "0221123456",
  email: "info@ggs-europa.de",
  active: true,
  hidden: false,
  deleted_at: undefined,
  settings: undefined,
  created_at: NOW,
  updated_at: NOW,
};

const mockBackendSchoolAccount: operatorSchoolsContract.SchoolAccount = {
  has_admin_role: false,
  has_user_role: false,
  has_caregiver_profile: false,
  is_active_caregiver: false,
  account_id: "1",
  email: "teacher@school.de",
  active: true,
  first_name: "Maria",
  last_name: "Schmidt",
  role_name: "teacher",
  pedagogic_role: "Erzieher",
  status: "active",
};

const mockBackendOrgAccount: sharedContract.OrganizationAccount = {
  ...mockBackendSchoolAccount,
  school_id: "10",
  school_name: "GGS Europaschule",
};

const mockBackendDevice: sharedContract.OperatorDevice = {
  id: "1",
  device_id: "dev-001",
  device_type: "terminal",
  name: "Eingang Hauptgebäude",
  status: "active",
  api_key: undefined,
  masked_api_key: "dk_...abc",
  last_seen: NOW,
  is_online: true,
  school_id: "10",
  school_name: "GGS Europaschule",
  organization_id: "5",
  organization_name: "Stadt Köln",
  created_at: NOW,
  updated_at: NOW,
};

const mockBackendInvitation: operatorSchoolsContract.operatorInvitationResponse =
  {
    caregiver_enabled: false,
    id: "1",
    email: "admin@example.com",
    role_id: "4",
    role_name: "admin",
    expires_at: NOW,
    first_name: "Ada",
    last_name: "Lovelace",
    created_by: "0",
    delivery_status: "pending",
    email_retry_count: 0,
  };

const mockBackendUnregisteredTagScan: operatorUnregisteredTagScansContract.scanResponse =
  {
    id: "300",
    tenant_id: "10",
    tag_uid: "04AABBCCDD",
    device_id: "1",
    scanned_at: NOW,
    resolved_at: undefined,
    resolved_by_operator_id: undefined,
    resolution_note: undefined,
    created_at: NOW,
    updated_at: NOW,
    school_id: "10",
    school_name: "GGS Europaschule",
    organization_id: "5",
    organization_name: "Stadt Köln",
    device_identifier: "dev-001",
    device_name: "Eingang Hauptgebäude",
  };

describe("OperatorProvisioningService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateOrganization", () => {
    it("calls correct endpoint with PUT method", async () => {
      mockBffJson.mockResolvedValue(mockBackendOrg);

      const updateData = {
        name: "Updated",
        slug: "updated",
        active: true,
        expected_version: "v-1",
      };
      await operatorProvisioningService.updateOrganization("5", updateData);

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "PUT /operator/organizations/{id}",
        { params: { id: "5" }, body: updateData },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue(mockBackendOrg);

      const result = await operatorProvisioningService.updateOrganization("5", {
        name: "Stadt Köln",
        slug: "stadt-koeln",
        active: true,
        expected_version: "v-1",
      });

      expect(result).toEqual({
        id: "5",
        name: "Stadt Köln",
        slug: "stadt-koeln",
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        testSystem: false,
        version: "v-1",
      });
    });
  });

  describe("createTestTraeger", () => {
    it("posts the order and maps the test Träger with its schools", async () => {
      mockBffJson.mockResolvedValue({
        organization: { ...mockBackendOrg, test_system: true },
        schools: [mockBackendSchool],
      });
      const order = {
        name: "Test-Träger",
        slug: "test-traeger",
        school_count: 1,
        contact_email: "buero@traeger.example",
        federal_state: "DE-NI",
      };

      const result = await operatorProvisioningService.createTestTraeger(order);

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/organizations/test-traeger",
        { body: order },
      );
      expect(result.organization.testSystem).toBe(true);
      expect(result.schools.map((school) => school.id)).toEqual(["10"]);
    });
  });

  describe("createSampleChildren", () => {
    it("posts to the Träger and sums the skipped children of every school", async () => {
      mockBffJson.mockResolvedValue({
        created_count: 30,
        schools: [
          { school_id: "1", created_count: 24, skipped_count: 0 },
          { school_id: "2", created_count: 6, skipped_count: 18 },
        ],
      });

      const result =
        await operatorProvisioningService.createSampleChildren("5");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/organizations/{id}/sample-children",
        { params: { id: "5" } },
      );
      expect(result).toEqual({ createdCount: 30, skippedCount: 18 });
    });
  });

  describe("updateSchool", () => {
    it("calls correct endpoint with PUT method", async () => {
      mockBffJson.mockResolvedValue(mockBackendSchool);

      const updateData = {
        organization_id: "5",
        name: "Updated School",
        slug: "updated-school",
        subdomain: "updated-school",
        address: "Street 1",
        city: "Berlin",
        zip: "10115",
        phone: "030123456",
        email: "school@example.com",
        active: true,
        hidden: false,
        expected_version: "v-1",
      };
      await operatorProvisioningService.updateSchool("10", updateData);

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "PUT /operator/schools/{id}",
        { params: { id: "10" }, body: updateData },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue(mockBackendSchool);

      const result = await operatorProvisioningService.updateSchool("10", {
        organization_id: "5",
        name: "GGS Europaschule",
        slug: "ggs-europa",
        subdomain: "ggs-europa",
        address: "Hauptstr. 1",
        city: "Köln",
        zip: "50667",
        phone: "0221123456",
        email: "info@ggs-europa.de",
        active: true,
        hidden: false,
        expected_version: "v-1",
      });

      expect(result).toEqual({
        id: "10",
        organizationId: "5",
        name: "GGS Europaschule",
        slug: "ggs-europa",
        subdomain: "ggs-europa",
        address: "Hauptstr. 1",
        city: "Köln",
        zip: "50667",
        phone: "0221123456",
        email: "info@ggs-europa.de",
        active: true,
        hidden: false,
        deletedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        organization: undefined,
        version: "v-1",
      });
    });
  });

  describe("listOrganizations", () => {
    it("calls correct endpoint", async () => {
      mockBffJson.mockResolvedValue([mockBackendOrg]);

      const result = await operatorProvisioningService.listOrganizations();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/",
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("5");
    });
  });

  describe("listSchools", () => {
    it("calls correct endpoint", async () => {
      mockBffJson.mockResolvedValue([mockBackendSchool]);

      const result = await operatorProvisioningService.listSchools();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/",
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("10");
    });
  });

  describe("createOrganization", () => {
    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue(mockBackendOrg);

      await operatorProvisioningService.createOrganization({
        name: "Stadt Köln",
        slug: "stadt-koeln",
      });

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/organizations/",
        { body: { name: "Stadt Köln", slug: "stadt-koeln" } },
      );
    });
  });

  describe("createSchool", () => {
    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue(mockBackendSchool);

      await operatorProvisioningService.createSchool({
        organization_id: "5",
        name: "GGS Europaschule",
        slug: "ggs-europa",
        subdomain: "ggs-europa",
        email: "info@ggs-europa.example",
        federal_state: "DE-NW",
      });

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/schools/",
        {
          body: {
            organization_id: "5",
            name: "GGS Europaschule",
            slug: "ggs-europa",
            subdomain: "ggs-europa",
            email: "info@ggs-europa.example",
            federal_state: "DE-NW",
          },
        },
      );
    });
  });

  const query = {
    sort: "email",
    direction: "desc",
    cursor: "previous",
  } as const;
  const pagination = { total_records: 51, next_cursor: "next" };

  describe("school account page", () => {
    it("calls correct endpoint with school id", async () => {
      mockBffJson.mockResolvedValue({
        data: [mockBackendSchoolAccount],
        pagination,
      });

      await operatorProvisioningService.listAccountPage(
        { kind: "school", id: "10" },
        query,
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/accounts",
        { params: { id: "10" }, query },
      );
    });

    it("hands the raw school id to bffJson, which encodes it", async () => {
      mockBffJson.mockResolvedValue({ data: [], pagination });

      await operatorProvisioningService.listAccountPage(
        { kind: "school", id: "10/evil" },
        query,
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/accounts",
        { params: { id: "10/evil" }, query },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue({
        data: [mockBackendSchoolAccount],
        pagination,
      });

      const result = await operatorProvisioningService.listAccountPage(
        { kind: "school", id: "10" },
        query,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        accountId: "1",
        email: "teacher@school.de",
        active: true,
        firstName: "Maria",
        lastName: "Schmidt",
        roleName: "teacher",
        pedagogicRole: "Erzieher",
        status: "active",
        hasAdminRole: false,
        hasUserRole: false,
        hasCaregiverProfile: false,
        isActiveCaregiver: false,
      });
    });
  });

  describe("organization account page", () => {
    it("calls correct endpoint with org id", async () => {
      mockBffJson.mockResolvedValue({
        data: [mockBackendOrgAccount],
        pagination,
      });

      await operatorProvisioningService.listAccountPage(
        { kind: "organization", id: "5" },
        query,
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/{id}/accounts",
        { params: { id: "5" }, query },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue({
        data: [mockBackendOrgAccount],
        pagination,
      });

      const result = await operatorProvisioningService.listAccountPage(
        { kind: "organization", id: "5" },
        query,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        accountId: "1",
        email: "teacher@school.de",
        active: true,
        firstName: "Maria",
        lastName: "Schmidt",
        roleName: "teacher",
        pedagogicRole: "Erzieher",
        status: "active",
        schoolId: "10",
        schoolName: "GGS Europaschule",
        hasAdminRole: false,
        hasUserRole: false,
        hasCaregiverProfile: false,
        isActiveCaregiver: false,
      });
    });
  });

  describe("platform account page", () => {
    it("calls correct endpoint", async () => {
      mockBffJson.mockResolvedValue({
        data: [mockBackendOrgAccount],
        pagination,
      });

      await operatorProvisioningService.listAccountPage({ kind: "all" }, query);

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/accounts",
        { query },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue({
        data: [mockBackendOrgAccount],
        pagination,
      });

      const result = await operatorProvisioningService.listAccountPage(
        { kind: "all" },
        query,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        schoolId: "10",
        schoolName: "GGS Europaschule",
      });
      expect(result).toMatchObject({ total: 51, cursor: "next" });
    });
  });

  describe("listAllDevices", () => {
    it("calls correct endpoint", async () => {
      mockBffJson.mockResolvedValue([mockBackendDevice]);

      await operatorProvisioningService.listAllDevices();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/devices/",
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue([mockBackendDevice]);

      const result = await operatorProvisioningService.listAllDevices();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "1",
        deviceId: "dev-001",
        deviceType: "terminal",
        name: "Eingang Hauptgebäude",
        status: "active",
        apiKey: "",
        maskedApiKey: "dk_...abc",
        lastSeen: NOW,
        isOnline: true,
        schoolId: "10",
        schoolName: "GGS Europaschule",
        organizationId: "5",
        organizationName: "Stadt Köln",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });

  describe("listSchoolDevices", () => {
    it("calls correct endpoint with school id", async () => {
      mockBffJson.mockResolvedValue([mockBackendDevice]);

      await operatorProvisioningService.listSchoolDevices("10");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/devices",
        { params: { id: "10" } },
      );
    });

    it("hands the raw school id to bffJson, which encodes it", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listSchoolDevices("10/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/devices",
        { params: { id: "10/evil" } },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue([mockBackendDevice]);

      const result = await operatorProvisioningService.listSchoolDevices("10");

      expect(result).toHaveLength(1);
      expect(result[0]!.deviceId).toBe("dev-001");
    });
  });

  describe("listOrganizationDevices", () => {
    it("calls correct endpoint with org id", async () => {
      mockBffJson.mockResolvedValue([mockBackendDevice]);

      await operatorProvisioningService.listOrganizationDevices("5");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/{id}/devices",
        { params: { id: "5" } },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue([mockBackendDevice]);

      const result =
        await operatorProvisioningService.listOrganizationDevices("5");

      expect(result).toHaveLength(1);
      expect(result[0]!.organizationId).toBe("5");
    });
  });

  describe("inviteSchoolAdmin", () => {
    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue(mockBackendInvitation);

      await operatorProvisioningService.inviteSchoolAdmin("10", {
        email: "admin@example.com",
        first_name: "Ada",
        last_name: "Lovelace",
        caregiver_enabled: true,
      });

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/schools/{id}/invite-admin",
        {
          params: { id: "10" },
          body: {
            email: "admin@example.com",
            first_name: "Ada",
            last_name: "Lovelace",
            caregiver_enabled: true,
          },
        },
      );
    });

    it("maps invitation response correctly", async () => {
      mockBffJson.mockResolvedValue(mockBackendInvitation);

      const result = await operatorProvisioningService.inviteSchoolAdmin("10", {
        email: "admin@example.com",
        first_name: "Ada",
        last_name: "Lovelace",
      });

      expect(result).toEqual({
        id: "1",
        email: "admin@example.com",
        roleId: "4",
        roleName: "admin",
        expiresAt: NOW,
        firstName: "Ada",
        lastName: "Lovelace",
        position: null,
        caregiverEnabled: false,
        createdBy: "0",
        creator: "",
        deliveryStatus: "pending",
        emailSentAt: null,
        emailError: null,
        emailRetryCount: 0,
      });
    });
  });

  describe("createDevice", () => {
    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue(mockBackendDevice);

      const createData = {
        school_id: "10",
        device_id: "DEV-001",
        device_type: "terminal",
        name: "Eingang Hauptgebäude",
        api_key: "manual-key",
      };
      await operatorProvisioningService.createDevice(createData);

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/devices/",
        { body: createData },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue({
        ...mockBackendDevice,
        api_key: "manual-key",
      });

      const result = await operatorProvisioningService.createDevice({
        school_id: "10",
        device_id: "DEV-001",
        device_type: "terminal",
      });

      expect(result).toEqual({
        id: "1",
        deviceId: "dev-001",
        deviceType: "terminal",
        name: "Eingang Hauptgebäude",
        status: "active",
        apiKey: "manual-key",
        maskedApiKey: "dk_...abc",
        lastSeen: NOW,
        isOnline: true,
        schoolId: "10",
        schoolName: "GGS Europaschule",
        organizationId: "5",
        organizationName: "Stadt Köln",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });

  describe("setDeviceAPIKey", () => {
    it("sends an empty body when auto-generating a key", async () => {
      mockBffJson.mockResolvedValue({
        ...mockBackendDevice,
        api_key: "generated-key",
      });

      const result =
        await operatorProvisioningService.setDeviceAPIKey("1/unsafe");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/devices/{id}/set-api-key",
        { params: { id: "1/unsafe" }, body: {} },
      );
      expect(result.apiKey).toBe("generated-key");
    });
  });

  describe("setDeviceBlocked", () => {
    it("blocks and unblocks through the encoded device routes", async () => {
      mockBffJson.mockResolvedValue(null);

      await operatorProvisioningService.setDeviceBlocked("1/unsafe", true);
      await operatorProvisioningService.setDeviceBlocked("1", false);

      expect(mockBffJson).toHaveBeenNthCalledWith(
        1,
        "platform",
        "POST /operator/devices/{id}/block",
        { params: { id: "1/unsafe" } },
      );
      expect(mockBffJson).toHaveBeenNthCalledWith(
        2,
        "platform",
        "POST /operator/devices/{id}/unblock",
        { params: { id: "1" } },
      );
    });
  });

  describe("device transfer", () => {
    it("loads and maps transfer blockers", async () => {
      mockBffJson.mockResolvedValue({
        can_transfer: false,
        is_online: true,
        is_protected: false,
        last_seen: NOW,
        active_session: {
          id: "77",
          started_at: NOW,
          activity_name: "Mensa",
          room_name: "Speisesaal",
        },
      });

      const result =
        await operatorProvisioningService.getDeviceTransferStatus("1/unsafe");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/devices/{id}/transfer-status",
        { params: { id: "1/unsafe" } },
      );
      expect(result).toEqual({
        canTransfer: false,
        isOnline: true,
        isProtected: false,
        lastSeen: NOW,
        activeSession: {
          id: "77",
          startedAt: NOW,
          activityName: "Mensa",
          roomName: "Speisesaal",
        },
      });
    });

    it("posts the target school as a string and maps the transferred device", async () => {
      mockBffJson.mockResolvedValue({
        ...mockBackendDevice,
        school_id: "20",
        school_name: "Walbach",
      });

      const result = await operatorProvisioningService.transferDevice(
        "1/unsafe",
        "20",
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/devices/{id}/transfer",
        { params: { id: "1/unsafe" }, body: { target_school_id: "20" } },
      );
      expect(result.schoolId).toBe("20");
      expect(result.schoolName).toBe("Walbach");
    });
  });

  describe("createSchoolAccount", () => {
    const mockAccountData = {
      email: "new@school.de",
      first_name: "Max",
      last_name: "Mustermann",
      password: "SecurePass123!",
      confirm_password: "SecurePass123!",
    };

    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue({ id: "99", email: "new@school.de" });

      await operatorProvisioningService.createSchoolAccount(
        "10",
        mockAccountData,
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/schools/{id}/create-account",
        { params: { id: "10" }, body: mockAccountData },
      );
    });

    it("hands the raw school id to bffJson, which encodes it", async () => {
      mockBffJson.mockResolvedValue({ id: "99", email: "new@school.de" });

      await operatorProvisioningService.createSchoolAccount(
        "10/evil",
        mockAccountData,
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/schools/{id}/create-account",
        expect.objectContaining({ params: { id: "10/evil" } }),
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue({ id: "99", email: "new@school.de" });

      const result = await operatorProvisioningService.createSchoolAccount(
        "10",
        mockAccountData,
      );

      expect(result).toEqual({
        id: "99",
        email: "new@school.de",
      });
    });
  });

  describe("listSchoolPersons", () => {
    const mockBackendPerson: sharedContract.OperatorPerson = {
      id: "42",
      first_name: "Max",
      last_name: "Mustermann",
      has_account: true,
      account_email: "max@test.de",
      has_rfid_card: true,
      is_staff: true,
      is_student: false,
      school_id: "10",
      school_name: "GGS Europaschule",
      organization_id: "5",
      organization_name: "Stadt Köln",
      created_at: NOW,
    };

    it("calls correct endpoint with school id", async () => {
      mockBffJson.mockResolvedValue([mockBackendPerson]);

      await operatorProvisioningService.listSchoolPersons("10");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/persons",
        { params: { id: "10" } },
      );
    });

    it("hands the raw school id to bffJson, which encodes it", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listSchoolPersons("10/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/{id}/persons",
        { params: { id: "10/evil" } },
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue([mockBackendPerson]);

      const result = await operatorProvisioningService.listSchoolPersons("10");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "42",
        firstName: "Max",
        lastName: "Mustermann",
        fullName: "Max Mustermann",
        hasAccount: true,
        accountEmail: "max@test.de",
        hasRfidCard: true,
        isStaff: true,
        isStudent: false,
        schoolId: "10",
        schoolName: "GGS Europaschule",
        organizationId: "5",
        organizationName: "Stadt Köln",
        createdAt: NOW,
      });
    });

    it("returns empty array when no persons", async () => {
      mockBffJson.mockResolvedValue([]);

      const result = await operatorProvisioningService.listSchoolPersons("10");

      expect(result).toEqual([]);
    });
  });

  describe("softDeletePerson", () => {
    it("calls correct endpoint with DELETE method", async () => {
      mockBffJson.mockResolvedValue(null);

      await operatorProvisioningService.softDeletePerson("42");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/persons/{id}",
        { params: { id: "42" } },
      );
    });

    it("encodes person id in URL", async () => {
      mockBffJson.mockResolvedValue(null);

      await operatorProvisioningService.softDeletePerson("42/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/persons/{id}",
        { params: { id: "42/evil" } },
      );
    });

    it("returns void on success", async () => {
      mockBffJson.mockResolvedValue(null);

      const result = await operatorProvisioningService.softDeletePerson("42");

      expect(result).toBeUndefined();
    });
  });

  describe("listSystemRoles", () => {
    it("calls correct endpoint", async () => {
      mockBffJson.mockResolvedValue([
        { id: "1", name: "admin", is_system: true },
      ]);

      await operatorProvisioningService.listSystemRoles();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/roles",
      );
    });

    it("maps response data correctly", async () => {
      mockBffJson.mockResolvedValue([
        { id: "1", name: "admin", is_system: true },
        { id: "2", name: "teacher", is_system: true },
        { id: "3", name: "custom_role", is_system: false },
      ]);

      const result = await operatorProvisioningService.listSystemRoles();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: "1",
        name: "admin",
        isSystem: true,
      });
      expect(result[1]).toEqual({
        id: "2",
        name: "teacher",
        isSystem: true,
      });
      expect(result[2]).toEqual({
        id: "3",
        name: "custom_role",
        isSystem: false,
      });
    });
  });

  describe("softDeleteSchool", () => {
    it("calls correct endpoint with DELETE method", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.softDeleteSchool("10");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/schools/{id}",
        { params: { id: "10" } },
      );
    });

    it("hands the raw school id to bffJson, which encodes it", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.softDeleteSchool("10/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/schools/{id}",
        { params: { id: "10/evil" } },
      );
    });

    it("resolves without returning data", async () => {
      mockBffJson.mockResolvedValue(undefined);

      const result = await operatorProvisioningService.softDeleteSchool("10");

      expect(result).toBeUndefined();
    });
  });

  describe("restoreSchool", () => {
    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.restoreSchool("10");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/schools/{id}/restore",
        { params: { id: "10" } },
      );
    });

    it("hands the raw school id to bffJson, which encodes it", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.restoreSchool("10/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/schools/{id}/restore",
        { params: { id: "10/evil" } },
      );
    });

    it("resolves without returning data", async () => {
      mockBffJson.mockResolvedValue(undefined);

      const result = await operatorProvisioningService.restoreSchool("10");

      expect(result).toBeUndefined();
    });
  });

  describe("softDeleteOrganization", () => {
    it("calls correct endpoint with DELETE method", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.softDeleteOrganization("77");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/organizations/{id}",
        { params: { id: "77" } },
      );
    });

    it("encodes organization id in URL", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.softDeleteOrganization("77/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "DELETE /operator/organizations/{id}",
        { params: { id: "77/evil" } },
      );
    });
  });

  describe("restoreOrganization", () => {
    it("calls correct endpoint with POST method", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.restoreOrganization("77");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/organizations/{id}/restore",
        { params: { id: "77" } },
      );
    });

    it("encodes organization id in URL", async () => {
      mockBffJson.mockResolvedValue(undefined);

      await operatorProvisioningService.restoreOrganization("77/evil");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/organizations/{id}/restore",
        { params: { id: "77/evil" } },
      );
    });
  });

  describe("getStats", () => {
    it("hits the stats endpoint and maps snake_case to camelCase", async () => {
      mockBffJson.mockResolvedValue({
        traeger_count: 3,
        schulen_count: 12,
        konten_count: 250,
        geraete_count: 64,
      });

      const stats = await operatorProvisioningService.getStats();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/stats",
      );
      expect(stats).toEqual({
        traegerCount: 3,
        schulenCount: 12,
        kontenCount: 250,
        geraeteCount: 64,
      });
    });

    it("propagates errors from bffJson", async () => {
      mockBffJson.mockRejectedValue(new Error("network down"));

      await expect(operatorProvisioningService.getStats()).rejects.toThrow(
        "network down",
      );
    });
  });

  describe("listOrganizationSummaries", () => {
    it("calls correct endpoint and maps each row", async () => {
      mockBffJson.mockResolvedValue([
        {
          ...mockBackendOrg,
          schulen_count: 3,
          konten_count: 24,
          geraete_count: 7,
          personen_count: 100,
        },
      ]);

      const summaries =
        await operatorProvisioningService.listOrganizationSummaries();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/summaries",
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: mockBackendOrg.id.toString(),
        slug: mockBackendOrg.slug,
        name: mockBackendOrg.name,
        schulenCount: 3,
        kontenCount: 24,
        geraeteCount: 7,
        personenCount: 100,
      });
    });
  });

  describe("listSchoolSummaries", () => {
    it("calls correct endpoint and maps each row", async () => {
      mockBffJson.mockResolvedValue([
        {
          ...mockBackendSchool,
          konten_count: 12,
          geraete_count: 4,
          personen_count: 80,
        },
      ]);

      const summaries = await operatorProvisioningService.listSchoolSummaries();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/summaries",
      );
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        id: mockBackendSchool.id.toString(),
        organizationId: mockBackendSchool.organization_id.toString(),
        name: mockBackendSchool.name,
        kontenCount: 12,
        geraeteCount: 4,
        personenCount: 80,
      });
    });
  });

  describe("listSchoolRequiredDetails", () => {
    it("maps the missing details of every school (#7174)", async () => {
      mockBffJson.mockResolvedValue([
        { school_id: "7", reply_address_missing: true },
        { school_id: "8", reply_address_missing: false },
      ]);

      const details =
        await operatorProvisioningService.listSchoolRequiredDetails();

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/schools/required-details",
      );
      expect(details).toEqual([
        { schoolId: "7", replyAddressMissing: true },
        { schoolId: "8", replyAddressMissing: false },
      ]);
    });
  });

  describe("listOrganizationSchools", () => {
    it("calls the org-scoped schools endpoint with the encoded id", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listOrganizationSchools("42");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/{id}/schools",
        { params: { id: "42" } },
      );
    });

    it("URL-encodes the org id", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listOrganizationSchools("a/b c");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/{id}/schools",
        { params: { id: "a/b c" } },
      );
    });

    it("maps each returned school summary", async () => {
      mockBffJson.mockResolvedValue([
        {
          ...mockBackendSchool,
          konten_count: 5,
          geraete_count: 2,
          personen_count: 40,
        },
      ]);

      const result =
        await operatorProvisioningService.listOrganizationSchools("42");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: mockBackendSchool.id.toString(),
        kontenCount: 5,
        geraeteCount: 2,
        personenCount: 40,
      });
    });
  });

  describe("listOrganizationPersons", () => {
    it("calls the org-scoped persons endpoint with the encoded id", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listOrganizationPersons("42");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/{id}/persons",
        { params: { id: "42" } },
      );
    });

    it("URL-encodes the org id", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listOrganizationPersons("a/b c");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/organizations/{id}/persons",
        { params: { id: "a/b c" } },
      );
    });

    it("maps each returned person", async () => {
      const backendPerson: sharedContract.OperatorPerson = {
        id: "5",
        first_name: "Anna",
        last_name: "Beispiel",
        has_account: true,
        account_email: "anna@example.com",
        has_rfid_card: false,
        is_staff: true,
        is_student: false,
        school_id: "10",
        school_name: "Schule A",
        organization_id: "42",
        organization_name: "Träger A",
        created_at: NOW,
      };
      mockBffJson.mockResolvedValue([backendPerson]);

      const result =
        await operatorProvisioningService.listOrganizationPersons("42");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "5",
        firstName: "Anna",
        lastName: "Beispiel",
        fullName: "Anna Beispiel",
        isStaff: true,
        isStudent: false,
        hasAccount: true,
        accountEmail: "anna@example.com",
        schoolId: "10",
        organizationId: "42",
      });
    });
  });

  describe("listUnregisteredTagScans", () => {
    it("calls the base endpoint without filters and maps rows", async () => {
      mockBffJson.mockResolvedValue([mockBackendUnregisteredTagScan]);

      const result = await operatorProvisioningService.listUnregisteredTagScans(
        {},
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/unregistered-tag-scans/",
        {
          query: {
            organization_id: undefined,
            school_id: undefined,
            resolved: undefined,
          },
        },
      );
      expect(result).toEqual([
        {
          id: "300",
          tenantId: "10",
          tagUid: "04AABBCCDD",
          deviceId: "1",
          scannedAt: NOW,
          resolvedAt: null,
          resolvedByOperatorId: null,
          resolutionNote: null,
          createdAt: NOW,
          updatedAt: NOW,
          schoolId: "10",
          schoolName: "GGS Europaschule",
          organizationId: "5",
          organizationName: "Stadt Köln",
          deviceIdentifier: "dev-001",
          deviceName: "Eingang Hauptgebäude",
        },
      ]);
    });

    it("adds organization, school, and all-resolved filters", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listUnregisteredTagScans({
        organizationId: "5",
        schoolId: "10",
        resolved: "all",
      });

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/unregistered-tag-scans/",
        { query: { organization_id: "5", school_id: "10", resolved: "all" } },
      );
    });

    it("omits resolved query param for unresolved-only mode", async () => {
      mockBffJson.mockResolvedValue([]);

      await operatorProvisioningService.listUnregisteredTagScans({
        organizationId: "5",
        resolved: "unresolved",
      });

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "GET /operator/unregistered-tag-scans/",
        {
          query: {
            organization_id: "5",
            school_id: undefined,
            resolved: undefined,
          },
        },
      );
    });
  });

  describe("resolveUnregisteredTagScan", () => {
    it("posts an empty body when no note is supplied", async () => {
      mockBffJson.mockResolvedValue(mockBackendUnregisteredTagScan);

      await operatorProvisioningService.resolveUnregisteredTagScan("300");

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/unregistered-tag-scans/{id}/resolve",
        { params: { id: "300" }, body: {} },
      );
    });

    it("posts the note and URL-encodes the scan id", async () => {
      mockBffJson.mockResolvedValue({
        ...mockBackendUnregisteredTagScan,
        resolved_at: NOW,
      });

      await operatorProvisioningService.resolveUnregisteredTagScan(
        "300/unsafe",
        "Assigned to new card",
      );

      expect(mockBffJson).toHaveBeenCalledWith(
        "platform",
        "POST /operator/unregistered-tag-scans/{id}/resolve",
        {
          params: { id: "300/unsafe" },
          body: { note: "Assigned to new card" },
        },
      );
    });
  });
});
