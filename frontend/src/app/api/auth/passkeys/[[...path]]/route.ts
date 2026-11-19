import { portalRoutes } from "~/lib/contract/portals.generated";
import { catalogProxyUnder } from "~/lib/route-wrapper.server";

/*
 * The staff portal's passkey management at the backend's `/auth/passkeys` (#2352), a path of the
 * staff proxy's fixed list beside `/api`
 * (`lib/contract/catalog-outside-mounts.ts`). Next would hand
 * `/api/auth/passkeys` and `/api/auth/passkeys/…` to Auth.js's `auth/[...nextauth]`,
 * so this optional catch-all hands both to the staff portal's catalog proxy,
 * which serves only the routes the contract registers for the staff portal;
 * the list sits on the bare path. The sign-in (`passkeys/login/…`) mints a
 * session, is never registered and keeps its own files.
 */
const head = ["auth", "passkeys"];
const routes = portalRoutes.tenant;

export const GET = catalogProxyUnder(head, routes, "GET");
export const POST = catalogProxyUnder(head, routes, "POST");
export const DELETE = catalogProxyUnder(head, routes, "DELETE");
