import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { plainResponse } from "~/test/mocks/plain-session-fetch";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));
import {
  fetchStudentGuardians,
  saveStudentGuardian,
  deleteGuardian,
  createStudentGuardians,
  fetchGuardianDeletePreview,
  linkGuardianToStudent,
  removeGuardianFromStudent,
  searchGuardians,
} from "./guardian-api";
import type { StudentGuardianLinkRequest } from "./guardian-helpers";
import type { GuardianResponse } from "./contract/guardians.generated";
import type * as guardiansContract from "./contract/guardians.generated";

// Mock data helpers
const mockBackendGuardian: GuardianResponse = {
  id: "1",
  first_name: "John",
  last_name: "Doe",
  email: "john@example.com",
  phone_numbers: [
    {
      id: "1",
      phone_number: "123-456-7890",
      phone_type: "home",
      is_primary: true,
      priority: 1,
    },
    {
      id: "2",
      phone_number: "098-765-4321",
      phone_type: "mobile",
      is_primary: false,
      priority: 2,
    },
  ],
  address_street: "123 Main St",
  address_city: "Anytown",
  address_postal_code: "12345",
  preferred_contact_method: "email",
  language_preference: "de",
  notes: "Some notes",
  has_account: false,
  account_id: undefined,
};

const mockBackendGuardianWithRelationship: guardiansContract.GuardianWithRelationship =
  {
    guardian: mockBackendGuardian,
    relationship_id: "10",
    relationship_type: "parent",
    is_primary: true,
    is_emergency_contact: true,
    can_pickup: true,
    pickup_notes: "Can pickup anytime",
    emergency_priority: 1,
    guardian_role: "",
    is_payer: false,
    account_status: "",
    version: "v1",
  };

const mockLinkRequest: StudentGuardianLinkRequest = {
  guardianProfileId: "1",
  relationshipType: "parent",
  guardianRole: "primary_guardian",
  isPrimary: true,
  isEmergencyContact: true,
  canPickup: true,
  pickupNotes: "Can pickup anytime",
  emergencyPriority: 1,
};

describe("guardian-api functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchStudentGuardians", () => {
    it("returns mapped guardians on success", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "success",
              data: [mockBackendGuardianWithRelationship],
            }),
        }),
      );

      const result = await fetchStudentGuardians("123");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "1",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phoneNumbers: [
          {
            id: "1",
            phoneNumber: "123-456-7890",
            phoneType: "home",
            isPrimary: true,
            priority: 1,
            label: undefined,
          },
          {
            id: "2",
            phoneNumber: "098-765-4321",
            phoneType: "mobile",
            isPrimary: false,
            priority: 2,
            label: undefined,
          },
        ],
        addressStreet: "123 Main St",
        addressCity: "Anytown",
        addressPostalCode: "12345",
        preferredContactMethod: "email",
        languagePreference: "de",
        notes: "Some notes",
        hasAccount: false,
        accountId: undefined,
        relationshipId: "10",
        relationshipType: "parent",
        guardianRole: "custom",
        isPrimary: true,
        isEmergencyContact: true,
        canPickup: true,
        // A payload without the payment mark (#2608) maps to false.
        isPayer: false,
        pickupNotes: "Can pickup anytime",
        emergencyPriority: 1,
        accountStatus: "none",
        version: "v1",
      });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/students/123/guardians",
        { method: "GET" },
      );
    });

    it("throws error on non-ok response with JSON error", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Not Found",
          json: () => Promise.resolve({ detail: "Student not found" }),
        }),
      );

      await expect(fetchStudentGuardians("999")).rejects.toThrow(
        "Failed to fetch guardians",
      );
    });

    it("throws error on non-ok response when JSON parse fails", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Internal Server Error",
          json: () => Promise.reject(new Error("Parse error")),
        }),
      );

      await expect(fetchStudentGuardians("123")).rejects.toThrow(
        "Failed to fetch guardians",
      );
    });
  });

  describe("saveStudentGuardian", () => {
    const answer = () =>
      plainResponse({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "success",
            data: {
              ...mockBackendGuardianWithRelationship,
              guardian: { ...mockBackendGuardian, first_name: "Johnny" },
              version: "v2",
            },
          }),
      });
    const sentBody = () => {
      const callArgs = vi.mocked(global.fetch).mock.calls[0] as [
        string,
        RequestInit,
      ];
      return JSON.parse(callArgs[1].body as string) as Record<string, unknown>;
    };

    it("saves profile, link and phones in one request with the read version", async () => {
      global.fetch = vi.fn().mockImplementation(answer);

      const result = await saveStudentGuardian(
        "7",
        "1",
        {
          guardian: { firstName: "Johnny" },
          relationship: {
            relationshipType: "guardian",
            guardianRole: "co_guardian",
            isPrimary: false,
            isEmergencyContact: true,
            canPickup: false,
            pickupNotes: "New notes",
            emergencyPriority: 2,
          },
          phoneNumbers: [
            {
              id: "1",
              phoneNumber: "123-456-7890",
              phoneType: "home",
              isPrimary: true,
            },
            {
              phoneNumber: "0151 1",
              phoneType: "mobile",
              label: "Neu",
              isPrimary: false,
            },
          ],
        },
        "v1",
      );

      expect(result?.firstName).toBe("Johnny");
      expect(result?.version).toBe("v2");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/students/7/guardians/1",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: expect.any(String),
        },
      );
      expect(sentBody()).toEqual({
        guardian: { first_name: "Johnny" },
        relationship: {
          relationship_type: "guardian",
          guardian_role: "co_guardian",
          is_primary: false,
          is_emergency_contact: true,
          can_pickup: false,
          pickup_notes: "New notes",
          emergency_priority: 2,
        },
        phone_numbers: [
          {
            id: "1",
            phone_number: "123-456-7890",
            phone_type: "home",
            is_primary: true,
          },
          {
            phone_number: "0151 1",
            phone_type: "mobile",
            label: "Neu",
            is_primary: false,
          },
        ],
        expected_version: "v1",
      });
    });

    it("only sends defined fields", async () => {
      global.fetch = vi.fn().mockImplementation(answer);

      // Without phoneNumbers the stored phone list stays.
      await saveStudentGuardian(
        "7",
        "1",
        {
          guardian: { firstName: "Johnny", email: undefined },
          relationship: { isPrimary: true },
        },
        "v1",
      );

      expect(sentBody()).toEqual({
        guardian: { first_name: "Johnny" },
        relationship: { is_primary: true },
        expected_version: "v1",
      });
    });

    it("sends an emptied e-mail so the backend removes the address", async () => {
      global.fetch = vi.fn().mockImplementation(answer);

      await saveStudentGuardian(
        "7",
        "1",
        { guardian: { firstName: "Johnny", email: "" }, relationship: {} },
        "v1",
      );

      expect(sentBody()).toMatchObject({
        guardian: { first_name: "Johnny", email: "" },
      });
    });

    it("throws the status class code on non-ok response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.resolve({ detail: "guardian not found" }),
        }),
      );

      await expect(
        saveStudentGuardian(
          "7",
          "999",
          { guardian: { firstName: "Johnny" }, relationship: {} },
          "v1",
        ),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 404,
        code: "general.input",
        message: "Failed to save guardian",
        detail: "guardian not found",
      });
    });

    it("rejects a success answer without data", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          json: () => Promise.resolve({ status: "success" }),
        }),
      );

      await expect(
        saveStudentGuardian(
          "7",
          "1",
          { guardian: { firstName: "Johnny" }, relationship: {} },
          "v1",
        ),
      ).rejects.toMatchObject({
        status: 502,
        code: "general.write_answer_unreadable",
      });
    });
  });

  describe("deleteGuardian", () => {
    it("succeeds with 204 No Content response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          status: 204,
        }),
      );

      await expect(deleteGuardian("1")).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith("/api/guardians/1", {
        method: "DELETE",
      });
    });

    it("succeeds with JSON success response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "success", data: null }),
        }),
      );

      await expect(deleteGuardian("1")).resolves.toBeUndefined();
    });

    it("throws error on non-ok response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Not Found",
          json: () => Promise.resolve({ detail: "Guardian not found" }),
        }),
      );

      await expect(deleteGuardian("999")).rejects.toThrow(
        "Failed to delete guardian",
      );
    });

    it("appends force=true and expected link IDs to the URL for a full delete", async () => {
      global.fetch = vi
        .fn()
        .mockImplementation(() => plainResponse({ ok: true, status: 204 }));

      await expect(
        deleteGuardian("1", {
          force: true,
          expectedAffectedLinkIds: ["10", "20"],
        }),
      ).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/1?force=true&expected_link_ids=10%2C20",
        {
          method: "DELETE",
        },
      );
    });

    it("throws a GuardianApiError carrying the HTTP status on conflict", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          status: 409,
          statusText: "Conflict",
          json: () => Promise.resolve({ detail: "Noch mit Kindern verknüpft" }),
        }),
      );

      await expect(deleteGuardian("1")).rejects.toMatchObject({
        name: "ApiError",
        status: 409,
        message: "Failed to delete guardian",
        detail: "Noch mit Kindern verknüpft",
      });
    });
  });

  describe("fetchGuardianDeletePreview", () => {
    it("maps the snake_case preview payload to camelCase", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "success",
              data: {
                linked_count: 2,
                affected_names: ["Anna Müller", "Ben Müller"],
                affected_link_ids: ["10", "20"],
                warning: "Die Person ist mit 2 Kindern verknüpft …",
              },
            }),
        }),
      );

      await expect(fetchGuardianDeletePreview("1")).resolves.toEqual({
        linkedCount: 2,
        affectedNames: ["Anna Müller", "Ben Müller"],
        affectedLinkIds: ["10", "20"],
        warning: "Die Person ist mit 2 Kindern verknüpft …",
      });
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/1/delete-preview",
        { method: "GET" },
      );
    });

    it("throws a GuardianApiError carrying the status when the backend forbids it", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          json: () => Promise.resolve({ detail: "nur Administratoren" }),
        }),
      );

      await expect(fetchGuardianDeletePreview("1")).rejects.toMatchObject({
        name: "ApiError",
        status: 403,
        message: "Failed to load delete preview",
        detail: "nur Administratoren",
      });
    });
  });

  describe("createStudentGuardians", () => {
    it("posts the batch as snake_case to the /batch endpoint", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ status: "success", data: null }),
        }),
      );

      await expect(
        createStudentGuardians("123", [
          {
            firstName: "Atomic",
            lastName: "Guardian",
            email: "a@b.de",
            relationshipType: "parent",
            guardianRole: "legal_guardian",
            isPrimary: true,
            isEmergencyContact: false,
            canPickup: true,
            emergencyPriority: 1,
            phoneNumbers: [
              {
                phoneNumber: "+49 1",
                phoneType: "mobile",
                isPrimary: true,
              },
            ],
          },
        ]),
      ).resolves.toBeUndefined();

      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      expect(url).toBe("/api/guardians/students/123/guardians/batch");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        guardians: [
          expect.objectContaining({
            first_name: "Atomic",
            last_name: "Guardian",
            email: "a@b.de",
            relationship_type: "parent",
            guardian_role: "legal_guardian",
            is_primary: true,
            can_pickup: true,
            emergency_priority: 1,
            phone_numbers: [
              expect.objectContaining({
                phone_number: "+49 1",
                phone_type: "mobile",
                is_primary: true,
              }),
            ],
          }),
        ],
      });
    });

    it("keeps the wire code of a duplicate-email 400", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: () =>
            Promise.resolve({
              detail:
                'Erziehungsberechtigte/r 1: E-Mail-Adresse "a@b.de" ist bereits vergeben',
              code: "general.input",
            }),
        }),
      );

      await expect(
        createStudentGuardians("123", [
          {
            firstName: "A",
            lastName: "B",
            relationshipType: "parent",
            isPrimary: false,
            isEmergencyContact: false,
            canPickup: false,
            guardianRole: "pickup_only",
            emergencyPriority: 1,
          },
        ]),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 400,
        code: "general.input",
      });
    });
  });

  describe("linkGuardianToStudent", () => {
    it("links guardian to student successfully", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          json: () => Promise.resolve({ status: "success", data: null }),
        }),
      );

      await expect(
        linkGuardianToStudent("123", mockLinkRequest),
      ).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/students/123/guardians",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.any(String),
        },
      );

      const callArgs = vi.mocked(global.fetch).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const body = JSON.parse(callArgs[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body.guardian_profile_id).toBe("1");
      expect(body.relationship_type).toBe("parent");
      expect(body.guardian_role).toBe(mockLinkRequest.guardianRole);
      expect(body.is_primary).toBe(true);
    });

    it("throws error on non-ok response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Bad Request",
          json: () =>
            Promise.resolve({ detail: "Relationship already exists" }),
        }),
      );

      await expect(
        linkGuardianToStudent("123", mockLinkRequest),
      ).rejects.toThrow("Failed to link guardian");
    });
  });

  describe("removeGuardianFromStudent", () => {
    it("succeeds with 204 No Content response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          status: 204,
        }),
      );

      await expect(
        removeGuardianFromStudent("123", "1"),
      ).resolves.toBeUndefined();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/students/123/guardians/1",
        {
          method: "DELETE",
        },
      );
    });

    it("succeeds with JSON success response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: "success", data: null }),
        }),
      );

      await expect(
        removeGuardianFromStudent("123", "1"),
      ).resolves.toBeUndefined();
    });

    it("throws error on non-ok response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Not Found",
          json: () => Promise.resolve({ detail: "Relationship not found" }),
        }),
      );

      await expect(removeGuardianFromStudent("123", "999")).rejects.toThrow(
        "Failed to remove guardian",
      );
    });
  });

  describe("searchGuardians", () => {
    it("returns mapped guardians on success", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "success",
              data: [mockBackendGuardian],
              pagination: {
                current_page: 1,
                page_size: 10,
                total_pages: 1,
                total_records: 1,
              },
            }),
        }),
      );

      const result = await searchGuardians("john");

      expect(result).toHaveLength(1);
      expect(result[0]!.firstName).toBe("John");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/search?q=john&page_size=50",
        { method: "GET" },
      );
    });

    it("encodes search query properly", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: true,
          json: () =>
            Promise.resolve({
              status: "success",
              data: [],
              pagination: {
                current_page: 1,
                page_size: 50,
                total_pages: 1,
                total_records: 1,
              },
            }),
        }),
      );

      await searchGuardians("john doe & sons");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/guardians/search?q=john+doe+%26+sons&page_size=50",
        { method: "GET" },
      );
    });

    it("throws error on non-ok response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Unauthorized",
          json: () => Promise.resolve({ detail: "Not authenticated" }),
        }),
      );

      await expect(searchGuardians("john")).rejects.toThrow(
        "Failed to search guardians",
      );
    });

    it("handles fallback error when JSON parse fails", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        plainResponse({
          ok: false,
          statusText: "Service Unavailable",
          json: () => Promise.reject(new Error("Parse error")),
        }),
      );

      // The catch block returns a generic error message without statusText
      await expect(searchGuardians("john")).rejects.toThrow(
        "Failed to search guardians",
      );
    });
  });
});
