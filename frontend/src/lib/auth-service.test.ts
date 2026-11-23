// auth-service.test.ts
// Tests for the auth service methods that still have callers

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as sharedContract from "./contract/shared.generated";
import { authService } from "./auth-service";
import { plainFetch } from "~/test/mocks/plain-session-fetch";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

// Sample test data
// The shape the catalog proxy decodes (snake_case, string IDs).
const sampleBackendRole: sharedContract.RoleResponse = {
  id: "1",
  name: "admin",
  description: "Administrator role",
  is_system: false,
  school_portal: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const sampleBackendPermission: sharedContract.PermissionResponse = {
  id: "1",
  name: "users.read",
  description: "Read users",
  resource: "users",
  action: "read",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const fetchMock = vi.fn();

function respondWith(body: unknown, status = 200): void {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  });
}

function sentUrl(): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

function sentInit(): RequestInit {
  return fetchMock.mock.calls[0]?.[1] as RequestInit;
}

describe("authService", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", vi.fn(plainFetch(fetchMock)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Role management", () => {
    describe("getRoles", () => {
      it("fetches roles", async () => {
        respondWith({ data: [sampleBackendRole] });

        const result = await authService.getRoles();

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe("admin");
        expect(sentUrl()).toBe("/api/auth/roles");
      });

      it("fetches roles with name filter", async () => {
        respondWith({ data: [sampleBackendRole] });

        await authService.getRoles({ name: "admin" });

        expect(sentUrl()).toBe("/api/auth/roles?name=admin");
      });
    });

    describe("getRolePermissions", () => {
      it("fetches role permissions", async () => {
        respondWith({ data: [sampleBackendPermission] });

        const result = await authService.getRolePermissions("1");

        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe("users.read");
        expect(sentUrl()).toBe("/api/auth/roles/1/permissions");
      });
    });

    describe("replaceRolePermissions", () => {
      it("replaces the permission set of a role with one PUT", async () => {
        respondWith(undefined, 204);

        await authService.replaceRolePermissions("1", ["2", "3"]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sentUrl()).toBe("/api/auth/roles/1/permissions");
        expect(sentInit().method).toBe("PUT");
        expect(JSON.parse(String(sentInit().body))).toEqual({
          permission_ids: ["2", "3"],
        });
      });
    });
  });

  describe("Permission management", () => {
    describe("getPermissions", () => {
      it("fetches permissions", async () => {
        respondWith({ data: [sampleBackendPermission] });

        const result = await authService.getPermissions();

        expect(result).toHaveLength(1);
        expect(sentUrl()).toBe("/api/auth/permissions");
      });

      it("fetches permissions with filters", async () => {
        respondWith({ data: [] });

        await authService.getPermissions({ resource: "users", action: "read" });

        expect(sentUrl()).toBe(
          "/api/auth/permissions?resource=users&action=read",
        );
      });
    });
  });

  describe("Account management", () => {
    describe("Role assignment", () => {
      it("replaces the system role of an account with one PUT", async () => {
        respondWith(undefined, 204);

        await authService.replaceAccountRole("1", "2");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sentUrl()).toBe("/api/auth/accounts/1/roles");
        expect(sentInit().method).toBe("PUT");
        expect(JSON.parse(String(sentInit().body))).toEqual({ role_id: "2" });
      });

      // The route reads the session cookie; the browser holds no token (#5005).
      it("gets account roles without a bearer token", async () => {
        respondWith({ data: [sampleBackendRole] });

        const result = await authService.getAccountRoles("1");

        expect(result[0]?.name).toBe("admin");
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/auth/accounts/1/roles",
          expect.objectContaining({ method: "GET" }),
        );
        expect(sentInit().headers).toBeUndefined();
      });
    });
  });
});
