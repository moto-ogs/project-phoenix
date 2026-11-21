import { apiErrorFromBody, transportFetch } from "../api-error";
import { knownEnum } from "../contract/known-enum";
import type {
  AccountTenantAccessEntry as WireAccountTenantAccess,
  RoleOption as WireRoleOption,
  grantAccountTenantAccessRequest,
  updateAccountTenantRoleRequest,
} from "../contract/operator-accounts.generated";

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

function mapAccess(entry: WireAccountTenantAccess): AccountTenantAccess {
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

async function throwApiError(response: Response): Promise<never> {
  throw apiErrorFromBody(
    `school access request failed (${response.status})`,
    response.status,
    await response.json().catch(() => undefined),
  );
}

async function request(
  endpoint: string,
  options: RequestInit = {},
): Promise<AccountTenantAccess[]> {
  const response = await transportFetch(endpoint, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    await throwApiError(response);
  }

  const payload = (await response.json()) as {
    data: WireAccountTenantAccess[];
  };
  return payload.data.map(mapAccess);
}

async function requestRoles(
  endpoint: string,
): Promise<
  { id: string; name: string; isSystem: boolean; schoolPortal: boolean }[]
> {
  const response = await transportFetch(endpoint, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    await throwApiError(response);
  }
  const payload = (await response.json()) as { data: WireRoleOption[] };
  return payload.data.map((role) => ({
    id: role.id,
    name: role.name,
    isSystem: role.is_system,
    schoolPortal: role.school_portal,
  }));
}

function basePath(accountId: string): string {
  return `/api/operator/accounts/${encodeURIComponent(accountId)}/tenants`;
}

class AccountTenantAccessService {
  list(accountId: string) {
    return request(basePath(accountId));
  }

  listAssignableRoles(accountId: string, tenantId: string) {
    return requestRoles(
      `${basePath(accountId)}/${encodeURIComponent(tenantId)}/roles`,
    );
  }

  grant(accountId: string, body: GrantAccountTenantAccessRequest) {
    return request(basePath(accountId), {
      method: "POST",
      body: JSON.stringify({
        school_id: body.schoolId,
        role_id: body.roleId,
        first_name: body.firstName,
        last_name: body.lastName,
        position: body.position,
      } satisfies grantAccountTenantAccessRequest),
    });
  }

  updateRole(accountId: string, tenantId: string, roleId: string) {
    return request(`${basePath(accountId)}/${encodeURIComponent(tenantId)}`, {
      method: "PUT",
      body: JSON.stringify({
        role_id: roleId,
      } satisfies updateAccountTenantRoleRequest),
    });
  }

  revoke(accountId: string, tenantId: string) {
    return request(`${basePath(accountId)}/${encodeURIComponent(tenantId)}`, {
      method: "DELETE",
    });
  }
}

export const accountTenantAccessService = new AccountTenantAccessService();
