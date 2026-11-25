import { headers } from "next/headers";
import { incomingClientForwardHeaders } from "~/lib/client-headers.server";
import { isScopeBooked, type ModuleScope } from "~/lib/module-register";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { projectTenantResolve } from "~/lib/tenant-api";
import { tenantSlugFromHost } from "~/lib/tenant-host";
import { resolveTenantCached } from "~/lib/tenant-resolve.server";

/** The same host and school binding as a tenant BFF read. */
export async function readTenantPageContext(
  slug: string,
  module?: ModuleScope,
) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-moto-original-host") ??
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host");
  if (tenantSlugFromHost(host) !== slug) return null;

  const [snapshot, resolved] = await Promise.all([
    readPortalSessionSnapshot("tenant"),
    incomingClientForwardHeaders()
      .then((forwardHeaders) => resolveTenantCached(slug, forwardHeaders))
      .catch(() => null),
  ]);
  if (!snapshot?.accessToken || snapshot.notBooked || !resolved) return null;
  const { session } = snapshot;
  const scope = session.user.scope ?? "";
  const tenant = projectTenantResolve(resolved, resolved.settings);
  if (
    session.error ||
    (scope !== "" && scope !== "org") ||
    session.user.tenantId !== tenant.tenantId ||
    tenant.subdomain !== slug ||
    (module !== undefined && !isScopeBooked(module, tenant.bookedModules))
  ) {
    return null;
  }
  return { snapshot, session, tenant, token: snapshot.accessToken };
}
