import type { AccountTenantResponse } from "./contract/auth-account.generated";

/**
 * Pure mapper shared by the browser client (tenant-api) and the server-side
 * shell bootstrap; lives apart from tenant-api so the server layout does not
 * pull the session cache into its module graph.
 */
export function mapAccountTenant(t: AccountTenantResponse) {
  return {
    tenantId: t.tenant_id,
    slug: t.slug,
    name: t.name,
    subdomain: t.subdomain,
    organizationId: t.organization_id,
    organizationName: t.organization_name,
  };
}
