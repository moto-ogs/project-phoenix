import type { routes as organizations } from "./operator-organizations.generated";
import type { routes as schools } from "./operator-schools.generated";
import type { routes as settings } from "./settings.generated";

// Renames and moves can change the lookup key or the projection. Creation
// and restoration can turn a cached miss into a hit. Use no IDs supplied
// by the browser to decide which previously cached aliases to forget.
const writes = [
  "POST /operator/schools/",
  "POST /operator/organizations/test-traeger",
  "PUT /operator/schools/{id}",
  "DELETE /operator/schools/{id}",
  "POST /operator/schools/{id}/restore",
  "PUT /operator/organizations/{id}",
  "DELETE /operator/organizations/{id}",
  "POST /operator/organizations/{id}/restore",
] satisfies (keyof typeof schools | keyof typeof organizations)[];

export const tenantLookupWrites: ReadonlySet<string> = new Set(writes);

export const tenantHostLookupWrites: ReadonlySet<string> = new Set([
  "POST /api/settings/login-image",
  "DELETE /api/settings/login-image",
] satisfies (keyof typeof settings)[]);
