import { PORTAL_ROUTES, type HostedPortalKey } from "~/lib/portal-paths";

/**
 * Whether `pathname` is one of a portal's pages without a session: the page
 * itself or below it, on the portal host (`/login`) or under the portal's
 * app prefix (`/parents/login`). One rule for the client auth guard and the
 * server seeds (#8077): a public page gets neither a guard nor personal data.
 */
export function isPortalPublicPath(
  portal: HostedPortalKey,
  publicPages: readonly string[],
  pathname: string,
): boolean {
  const prefix = PORTAL_ROUTES[portal].appPrefix;
  return publicPages.some((page) =>
    [page, `${prefix}${page}`].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ),
  );
}

/** The parents portal's pages without a session. */
export const PARENT_PUBLIC_PAGES = [
  "/invite",
  "/login",
  "/reset-password",
  "/accept-guardian-invite",
  // Status page is gated by the random token — same trust model as
  // the tenant version. Email links should land here directly even
  // when the parent isn't logged in.
  "/anmeldung/status",
  // The public holiday registration of a Träger, gated by its link (#4661).
  "/ferienanmeldung",
  // Setting up the parent account from the holiday registration's mail,
  // gated by its link (#6673).
  "/ferienkonto",
  // The one-time link of a care contract mail, gated by its link (#4679).
  "/vertrag-unterschreiben",
  // The public demo's entry page signs the visitor in itself (#3468).
  "/demo",
] as const;
