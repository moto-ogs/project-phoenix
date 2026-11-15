// auth-service.test.ts
// Tests for the auth service methods that still have callers

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BackendRole, BackendPermission } from "./auth-helpers";

// Mock dependencies
vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
}));

vi.mock("./api-transport", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Import after mocks
import { getSession } from "next-auth/react";
import api from "./api-transport";
import { authService } from "./auth-service";

const mockedGetSession = vi.mocked(getSession);
const mockedApiGet = vi.mocked(api.get);
const mockedApiPut = vi.mocked(api.put);

// Sample test data
const sampleBackendRole: BackendRole = {
  ID: 1,
  Name: "admin",
  Description: "Administrator role",
  IsSystem: false,
  CreatedAt: "2024-01-01T00:00:00Z",
  UpdatedAt: "2024-01-01T00:00:00Z",
};

const sampleBackendPermission: BackendPermission = {
  id: 1,
  name: "users.read",
  description: "Read users",
  resource: "users",
  action: "read",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("authService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Role management", () => {
    describe("getRoles", () => {
      it("fetches roles in server context", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: [sampleBackendRole] },
        });

        const result = await authService.getRoles();

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe("admin");
      });

      it("fetches roles with name filter", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: [sampleBackendRole] },
        });

        await authService.getRoles({ name: "admin" });

        expect(mockedApiGet).toHaveBeenCalledWith(
          expect.stringContaining("name=admin"),
          undefined,
        );
      });
    });

    describe("getRolePermissions", () => {
      it("fetches role permissions in server context", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: [sampleBackendPermission] },
        });

        const result = await authService.getRolePermissions("1");

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe("users.read");
      });

      it("handles double-nested response structure", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: { data: [sampleBackendPermission] } },
        });

        const result = await authService.getRolePermissions("1");

        expect(result).toHaveLength(1);
      });
    });

    describe("replaceRolePermissions", () => {
      it("replaces the permission set of a role with one PUT", async () => {
        mockedApiPut.mockResolvedValueOnce({ data: {} });

        await authService.replaceRolePermissions("1", ["2", "3"]);

        expect(mockedApiPut).toHaveBeenCalledWith(
          expect.stringContaining("/auth/roles/1/permissions"),
          { permission_ids: ["2", "3"] },
          undefined,
        );
      });
    });
  });

  describe("Permission management", () => {
    describe("getPermissions", () => {
      it("fetches permissions in server context", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: [sampleBackendPermission] },
        });

        const result = await authService.getPermissions();

        expect(result).toHaveLength(1);
      });

      it("fetches permissions with filters", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: [] },
        });

        await authService.getPermissions({ resource: "users", action: "read" });

        expect(mockedApiGet).toHaveBeenCalledWith(
          expect.stringContaining("resource=users"),
          undefined,
        );
      });
    });
  });

  describe("Account management", () => {
    describe("Role assignment", () => {
      it("replaces the system role of an account with one PUT", async () => {
        mockedApiPut.mockResolvedValueOnce({ data: {} });

        await authService.replaceAccountRole("1", "2");

        expect(mockedApiPut).toHaveBeenCalledWith(
          expect.stringContaining("/auth/accounts/1/roles"),
          { role_id: "2" },
          undefined,
        );
      });

      it("gets account roles", async () => {
        mockedApiGet.mockResolvedValueOnce({
          data: { data: [sampleBackendRole] },
        });

        const result = await authService.getAccountRoles("1");

        expect(result).toHaveLength(1);
      });

      // The route reads the session cookie; the browser holds no token (#5005).
      it("gets account roles in browser context without a bearer token", async () => {
        vi.stubGlobal("window", {});
        mockedGetSession.mockResolvedValueOnce({
          user: { id: "1" },
          expires: "2099-01-01",
        });
        const fetchMock = vi.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [sampleBackendRole] }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await authService.getAccountRoles("1");

        expect(result[0]?.name).toBe("admin");
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/auth/accounts/1/roles",
          expect.objectContaining({
            method: "GET",
            headers: { "Content-Type": "application/json" },
          }),
        );
      });
    });
  });
});
