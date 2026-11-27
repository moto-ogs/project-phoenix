import type { TenantInfo } from "~/lib/tenant-api";
import type { TraegerSchool } from "~/lib/traeger-api";

/** The school of the session as the one school of the extra day form. */
export function ownSchoolOf(
  tenant: TenantInfo | null,
): readonly TraegerSchool[] | null {
  if (!tenant) return null;
  return [
    {
      id: tenant.tenantId,
      name: tenant.name,
      slug: tenant.slug,
      subdomain: tenant.subdomain,
      city: "",
    },
  ];
}
