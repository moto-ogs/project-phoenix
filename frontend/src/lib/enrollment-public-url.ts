"use client";

import { useEffect, useState } from "react";

interface EnrollmentPublicUrlParams {
  readonly tenantSlug: string | null | undefined;
  readonly phaseId?: string | null;
}

interface BrowserLocationSnapshot {
  readonly origin: string;
  readonly hostname: string;
}

/**
 * Builds an absolute public enrollment URL for the current tenant.
 *
 * In subdomain mode the public route is /anmeldung[/phaseId]. In path mode the
 * tenant slug must stay in the URL: /{tenantSlug}/anmeldung[/phaseId].
 */
export function useEnrollmentPublicUrl({
  tenantSlug,
  phaseId,
}: EnrollmentPublicUrlParams) {
  const [location, setLocation] = useState<BrowserLocationSnapshot | null>(
    null,
  );

  useEffect(() => {
    setLocation({
      origin: window.location.origin,
      hostname: window.location.hostname,
    });
  }, []);

  if (!location || !tenantSlug) return "";

  const path = phaseId
    ? `/anmeldung/${encodeURIComponent(phaseId)}`
    : "/anmeldung";
  if (location.hostname.startsWith(`${tenantSlug}.`)) {
    return `${location.origin}${path}`;
  }
  return `${location.origin}/${encodeURIComponent(tenantSlug)}${path}`;
}
