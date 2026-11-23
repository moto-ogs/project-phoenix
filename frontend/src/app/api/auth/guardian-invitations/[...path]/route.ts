import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * Accepting a guardian invitation at the backend's
 * `/auth/guardian-invitations/{token}/accept` (#2352): a public route, the
 * link is the permission. Next would hand `/api/auth/…` to Auth.js's
 * `auth/[...nextauth]`, so this file hands the path to the staff portal's
 * catalog proxy, which serves it without a session and only as the contract
 * registers it (`lib/contract/catalog-outside-mounts.ts`).
 */
const head = ["auth", "guardian-invitations"];

export const POST = catalogProxyUnder(
  head,
  portalRoutes.tenant,
  "POST",
  portalRoutes.public,
);
