// Type mapping for the info-point display domain (issue #1325).
// The contract's display (InfoDisplayResponse) becomes the view's display;
// snake_case becomes camelCase. Identifiers arrive as decimal strings through
// the catalog proxy and are kept as strings.

import type { InfoDisplayResponse } from "~/lib/contract/display.generated";

export interface InfoDisplay {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export function mapDisplayResponse(data: InfoDisplayResponse): InfoDisplay {
  return {
    id: String(data.id),
    name: data.name,
    isActive: data.is_active,
    createdAt: data.created_at,
  };
}

/**
 * Builds the public dashboard URL for a raw display token. The token lives in
 * the URL fragment (#<token>), which browsers never send to any server — so
 * it cannot leak into backend, proxy, or access logs. Handles both subdomain
 * mode ({slug}.domain/display#...) and path mode (domain/{slug}/display#...)
 * — same detection as the enrollment link panel.
 */
export function buildDisplayUrl(rawToken: string, tenantSlug: string): string {
  const encoded = encodeURIComponent(rawToken);
  const inSubdomainMode = window.location.hostname.startsWith(`${tenantSlug}.`);
  if (inSubdomainMode) {
    return `${window.location.origin}/display#${encoded}`;
  }
  return `${window.location.origin}/${tenantSlug}/display#${encoded}`;
}
