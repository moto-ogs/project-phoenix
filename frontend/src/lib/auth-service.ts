import { bffJson } from "~/lib/bff-fetch";
import {
  mapRoleResponse,
  mapPermissionResponse,
  type Role,
  type Permission,
} from "./auth-helpers";

/** A role's permission selection and the version of that selection. */
export interface RolePermissions {
  permissions: Permission[];
  version: string;
}

/** An account's roles at this school and the version of those roles. */
export interface AccountRoles {
  roles: Role[];
  version: string;
}

/**
 * Roles and permissions of the staff portal, through its catalog proxy
 * (#2352): the answers arrive decoded, the lists as plain arrays.
 */
export const authService = {
  getRoles: async (filters?: { name?: string }): Promise<Role[]> => {
    const roles = await bffJson("tenant", "GET /auth/roles/", {
      query: { name: filters?.name || undefined },
      errorMessage: "Get roles failed",
    });
    return roles.map(mapRoleResponse);
  },

  /**
   * The role's permissions with the version of that selection, which
   * `replaceRolePermissions` sends back (ADR 0311).
   */
  getRolePermissions: async (roleId: string): Promise<RolePermissions> => {
    const selection = await bffJson(
      "tenant",
      "GET /auth/roles/{roleId}/permission-selection/",
      { params: { roleId }, errorMessage: "Get role permissions failed" },
    );
    return {
      permissions: (selection.permissions ?? []).map(mapPermissionResponse),
      version: selection.version,
    };
  },

  /**
   * Replaces the role's selection. `expectedVersion` is the version of the
   * selection it was made from; a selection changed since is refused with
   * `general.changed_since_read`.
   */
  replaceRolePermissions: async (
    roleId: string,
    permissionIds: readonly string[],
    expectedVersion: string,
  ): Promise<string> => {
    // The answer is the stored selection's version: the next save sends it
    // without reading again, also when the reload after this save fails.
    const stored = await bffJson(
      "tenant",
      "PUT /auth/roles/{roleId}/permission-selection/",
      {
        params: { roleId },
        body: {
          permission_ids: [...permissionIds],
          expected_version: expectedVersion,
        },
        errorMessage: "Replace role permissions failed",
      },
    );
    return stored.version;
  },

  getPermissions: async (filters?: {
    resource?: string;
    action?: string;
  }): Promise<Permission[]> => {
    const permissions = await bffJson("tenant", "GET /auth/permissions/", {
      query: {
        resource: filters?.resource || undefined,
        action: filters?.action || undefined,
      },
      errorMessage: "Get permissions failed",
    });
    return permissions.map(mapPermissionResponse);
  },

  /**
   * Macht `roleId` zur einzigen Systemrolle des Kontos an dieser Schule.
   * Andere Systemrollen entfernt das Backend; Elternzugang (guardian) bleibt.
   * `expectedVersion` ist die Version der gelesenen Rollen; haben sie sich
   * inzwischen geändert, lehnt das Backend mit `general.changed_since_read`
   * ab (ADR 0311).
   */
  replaceAccountRole: async (
    accountId: string,
    roleId: string,
    expectedVersion: string,
  ): Promise<void> => {
    await bffJson("tenant", "PUT /auth/accounts/{accountId}/roles/", {
      params: { accountId },
      body: { role_id: roleId, expected_version: expectedVersion },
      errorMessage: "Replace account role failed",
    });
  },

  /** Die Rollen des Kontos an dieser Schule samt ihrer Version. */
  getAccountRoles: async (accountId: string): Promise<AccountRoles> => {
    const selection = await bffJson(
      "tenant",
      "GET /auth/accounts/{accountId}/role-selection/",
      {
        params: { accountId },
        errorMessage: "Get account roles failed",
      },
    );
    return {
      roles: (selection.roles ?? []).flatMap((role) =>
        role ? [mapRoleResponse(role)] : [],
      ),
      version: selection.version,
    };
  },
};
