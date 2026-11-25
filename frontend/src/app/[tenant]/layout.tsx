import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Session } from "next-auth";
import { TenantGuard } from "~/components/tenant/tenant-guard";
import { PathModeRedirect } from "~/components/tenant/path-mode-redirect";
import { normalizeHostname } from "~/lib/tenant-host";
import { TenantProviders } from "./providers";
import { loadShellBootstrap } from "~/lib/shell-bootstrap.server";
import type { ShellBootstrap } from "~/lib/shell-seed";
import {
  readPortalSessionSnapshot,
  readRenderedSessionMark,
  type PortalSessionSnapshot,
} from "~/lib/portal-session-snapshot.server";
import { projectTenantResolve, type TenantInfo } from "~/lib/tenant-api";
import { RESERVED_SLUGS } from "~/lib/reserved-slugs";
import { isValidTenantSlug } from "~/lib/tenant-slug";
import { env } from "~/env";
import { TenantBusyPage } from "~/components/tenant/tenant-busy-page";
import { incomingClientForwardHeaders } from "~/lib/client-headers.server";
import {
  resolveTenantCached,
  TenantResolveStatusError,
} from "~/lib/tenant-resolve.server";

/**
 * The backend rate limit rejected the lookup (HTTP 429). Scanner bursts cause
 * it, not a defect, and the backend counts every rejection in its rate-limit
 * metric. The layout shows a waiting page instead of throwing (#5090): an
 * error boundary would show a generic crash, report it to Sentry and retry
 * only on the client, without running this layout again.
 */
const TENANT_RATE_LIMITED = "rate-limited";

/**
 * Resolve tenant metadata on the server side.
 * Uses the backend API to validate the tenant slug.
 */
async function fetchTenantInfo(
  slug: string,
): Promise<TenantInfo | typeof TENANT_RATE_LIMITED | null> {
  try {
    const data = await resolveTenantCached(
      slug,
      await incomingClientForwardHeaders(),
    );
    return projectTenantResolve(data, data.settings);
  } catch (error) {
    if (!(error instanceof TenantResolveStatusError)) throw error;
    if (error.status === 404) return null;
    if (error.status === 429) return TENANT_RATE_LIMITED;
    throw error;
  }
}

export function bareTenantHost(currentHost: string): string {
  const [hostname = "", port] = currentHost.split(":");
  const portSuffix = port ? `:${port}` : "";

  if (hostname === env.TENANT_DOMAIN) {
    return currentHost;
  }

  if (hostname.endsWith(`.${env.TENANT_DOMAIN}`)) {
    return `${env.TENANT_DOMAIN}${portSuffix}`;
  }

  return env.TENANT_DOMAIN;
}

function isTenantSubdomainHost(currentHost: string | null, subdomain: string) {
  if (!currentHost) return false;
  const hostname = currentHost.split(":")[0] ?? "";
  return hostname === `${subdomain}.${env.TENANT_DOMAIN}`;
}

function isBareTenantHost(currentHost: string | null): currentHost is string {
  return (
    !!currentHost &&
    normalizeHostname(currentHost) === normalizeHostname(env.TENANT_DOMAIN)
  );
}

/**
 * Path mode on the bare domain (<domain>/<school>/...) shares the session
 * cookie with every school, but its host names no school, so the BFF cannot
 * bind its requests to the tab's school (#5130). The same page lives on the
 * school's subdomain; path and query come from the proxy, the fragment from
 * the browser (PathModeRedirect), so printed enrollment and display links
 * keep working.
 */
function tenantSubdomainUrl(
  requestHeaders: Headers,
  currentHost: string,
  pathSlug: string,
  subdomain: string,
): string {
  const original = requestHeaders.get("x-moto-original-path") ?? "/";
  const prefix = `/${pathSlug}`;
  const rest = original.startsWith(prefix) ? original.slice(prefix.length) : "";
  // Only "/..." and "?..." continue the school's path; anything else (a
  // missing or foreign header) lands on the school's start page.
  const path = rest.startsWith("/")
    ? rest
    : rest.startsWith("?")
      ? `/${rest}`
      : "/";
  const port = currentHost.split(":")[1];
  const protocol =
    requestHeaders.get("x-moto-original-proto") ??
    requestHeaders.get("x-forwarded-proto") ??
    (env.NODE_ENV === "production" ? "https" : "http");
  return `${protocol}://${subdomain}.${env.TENANT_DOMAIN}${port ? `:${port}` : ""}${path}`;
}

/**
 * Preload the app shell for a session that belongs to this tenant (#2973).
 * A mismatched tenant is TenantGuard's job (auto-switch), an errored session
 * ends in a sign-out; both fetch nothing here and keep the client path.
 */
async function loadShell(
  snapshot: PortalSessionSnapshot | null,
  tenant: TenantInfo,
): Promise<ShellBootstrap | null> {
  // Only a tenant-staff scope ("" or "org") may read these endpoints; every
  // other scope is rejected by TenantMiddleware, so asking would produce a
  // burst of guaranteed 401s.
  const session: Session | undefined = snapshot?.session;
  const scope = session?.user?.scope ?? "";
  if (
    !snapshot?.accessToken ||
    !session ||
    session.error ||
    (scope !== "" && scope !== "org") ||
    session.user.tenantId !== tenant.tenantId
  ) {
    return null;
  }
  return loadShellBootstrap(session, tenant, snapshot.accessToken);
}

async function redirectToTenantSelection(): Promise<never> {
  const requestHeaders = await headers();
  const currentHost =
    requestHeaders.get("x-moto-original-host") ??
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host");

  if (!currentHost) {
    throw new Error("Cannot redirect invalid tenant without a Host header");
  }

  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (env.NODE_ENV === "production" ? "https" : "http");

  redirect(`${protocol}://${bareTenantHost(currentHost)}/`);
}

/**
 * Layout for all tenant-scoped routes.
 * Validates the tenant slug via the backend and provides tenant context.
 * Returns 404 if the tenant slug is invalid.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;

  // The dynamic segment also catches scanner probes such as
  // /wp-trackback.php. Reject values that cannot be tenant subdomains before
  // they consume the shared tenant-resolution cache or backend rate limit.
  if (!isValidTenantSlug(tenantSlug) || RESERVED_SLUGS.has(tenantSlug)) {
    notFound();
  }

  const tenant = await fetchTenantInfo(tenantSlug);

  if (tenant === TENANT_RATE_LIMITED) {
    return <TenantBusyPage />;
  }
  if (!tenant) {
    await redirectToTenantSelection();
    throw new Error("Tenant redirect did not complete");
  }
  const requestHeaders = await headers();
  const currentHost =
    requestHeaders.get("x-moto-original-host") ??
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host");
  const routingMode = isTenantSubdomainHost(currentHost, tenant.subdomain)
    ? "subdomain"
    : "path";
  if (routingMode === "path" && isBareTenantHost(currentHost)) {
    return (
      <PathModeRedirect
        href={tenantSubdomainUrl(
          requestHeaders,
          currentHost,
          tenantSlug,
          tenant.subdomain,
        )}
      />
    );
  }

  // Read-only JWT decode: auth() may rotate a refresh token, but a Server
  // Component cannot persist the replacement cookie (#1938). The snapshot
  // safely hydrates SessionProvider without any token (#5005); later polls
  // and refreshes use its response-aware route handler.
  const snapshot = await readPortalSessionSnapshot("tenant");
  const session = snapshot?.session ?? null;
  const shell = await loadShell(snapshot, tenant);

  return (
    <TenantProviders
      tenantSlug={tenantSlug}
      tenant={tenant}
      routingMode={routingMode}
      session={session}
      sessionMark={await readRenderedSessionMark("tenant")}
      shell={shell}
    >
      <TenantGuard>{children}</TenantGuard>
    </TenantProviders>
  );
}
