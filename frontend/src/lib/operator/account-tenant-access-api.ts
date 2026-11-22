import { bffJson } from "../bff-fetch";
import { knownEnum } from "../contract/known-enum";
import type * as operatorAccountsContract from "../contract/operator-accounts.generated";

// Go does not register the set; the contract types it as string.
const ACCESS_STATUS_VALUES = ["active", "pending", "inactive"] as const;

/** One role an account holds at one school. */
interface AccountTenantRole {
  id: string;
  name: string;
  isSystem: boolean;
  baseRole: string | null;
  /** Made from the template „Wie Lehrkraft“ (#4574). */
  schoolPortal: boolean;
}

/** One school an account has (or had) access to. */
export interface AccountTenantAccess {
  tenantId: string;
  schoolName: string;
  schoolSlug: string;
  schoolActive: boolean;
  organizationId: string;
  organizationName: string;
  /** undefined: a status this build does not know. */
  status: (typeof ACCESS_STATUS_VALUES)[number] | undefined;
  activatedAt: string | null;
  deactivatedAt: string | null;
  hasPerson: boolean;
  hasStaff: boolean;
  roles: AccountTenantRole[];
}

interface GrantAccountTenantAccessRequest {
  schoolId: string;
  roleId: string;
  firstName?: string;
  lastName?: string;
  position?: string;
}

function mapAccess(
  entry: operatorAccountsContract.AccountTenantAccessEntry,
): AccountTenantAccess {
  return {
    tenantId: entry.tenant_id,
    schoolName: entry.school_name,
    schoolSlug: entry.school_slug,
    schoolActive: entry.school_active,
    organizationId: entry.organization_id,
    organizationName: entry.organization_name,
    status: knownEnum(ACCESS_STATUS_VALUES, entry.status),
    activatedAt: entry.activated_at ?? null,
    deactivatedAt: entry.deactivated_at ?? null,
    hasPerson: entry.has_person,
    hasStaff: entry.has_staff,
    roles: (entry.roles ?? []).map((role) => ({
      id: role.id,
      name: role.name,
      isSystem: role.is_system,
      baseRole: role.base_role ?? null,
      schoolPortal: role.school_portal,
    })),
  };
}

// The message a client and its tests name; the user reads the code's text.
const errorMessage = "school access request failed";

class AccountTenantAccessService {
  async list(accountId: string): Promise<AccountTenantAccess[]> {
    const data = await bffJson(
      "platform",
      "GET /operator/accounts/{accountId}/tenants",
      { params: { accountId }, errorMessage },
    );
    return data.map(mapAccess);
  }

  async listAssignableRoles(
    accountId: string,
    tenantId: string,
  ): Promise<
    { id: string; name: string; isSystem: boolean; schoolPortal: boolean }[]
  > {
    const data = await bffJson(
      "platform",
      "GET /operator/accounts/{accountId}/tenants/{tenantId}/roles",
      { params: { accountId, tenantId }, errorMessage },
    );
    return data.map((role) => ({
      id: role.id,
      name: role.name,
      isSystem: role.is_system,
      schoolPortal: role.school_portal,
    }));
  }

  async grant(
    accountId: string,
    body: GrantAccountTenantAccessRequest,
  ): Promise<AccountTenantAccess[]> {
    const data = await bffJson(
      "platform",
      "POST /operator/accounts/{accountId}/tenants",
      {
        params: { accountId },
        body: {
          school_id: body.schoolId,
          role_id: body.roleId,
          first_name: body.firstName,
          last_name: body.lastName,
          position: body.position,
        },
        errorMessage,
      },
    );
    return data.map(mapAccess);
  }

  async updateRole(
    accountId: string,
    tenantId: string,
    roleId: string,
  ): Promise<AccountTenantAccess[]> {
    const data = await bffJson(
      "platform",
      "PUT /operator/accounts/{accountId}/tenants/{tenantId}",
      {
        params: { accountId, tenantId },
        body: { role_id: roleId },
        errorMessage,
      },
    );
    return data.map(mapAccess);
  }

  async revoke(
    accountId: string,
    tenantId: string,
  ): Promise<AccountTenantAccess[]> {
    const data = await bffJson(
      "platform",
      "DELETE /operator/accounts/{accountId}/tenants/{tenantId}",
      { params: { accountId, tenantId }, errorMessage },
    );
    return data.map(mapAccess);
  }
}

export const accountTenantAccessService = new AccountTenantAccessService();
