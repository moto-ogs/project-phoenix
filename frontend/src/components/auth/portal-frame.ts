import type { Session } from "next-auth";
import { catererPath } from "~/lib/caterer-url";
import { operatorPath } from "~/lib/operator-url";
import { parentPath } from "~/lib/parent-url";
import type { HostedPortalKey } from "~/lib/portal-paths";
import { schoolPath } from "~/lib/school-url";
import { traegerHomeHref } from "~/lib/traeger-home";
import { traegerPath } from "~/lib/traeger-url";

interface PortalFrame {
  /** The JWT `scope` claim of a session of this portal. */
  readonly scope: string;
  /** A portal path as the browser reaches it on this host. */
  readonly path: (path: string) => string;
  /**
   * Where a page lands that still showed another account (#5000). The
   * session decides it in the Träger portal (#7646); null when this tab
   * does not know the other account's session.
   */
  readonly homeHref: (session: Session | null) => string;
}

// The url helpers are called, not stored: a test may mock one module
// without the others' exports.
export const PORTAL_FRAME: Record<HostedPortalKey, PortalFrame> = {
  operator: {
    scope: "platform",
    path: (path) => operatorPath(path),
    homeHref: () => operatorPath("/operator/organizations"),
  },
  parent: {
    scope: "parent",
    path: (path) => parentPath(path),
    homeHref: () => parentPath("/parents"),
  },
  school: {
    scope: "school",
    path: (path) => schoolPath(path),
    homeHref: () => schoolPath("/school"),
  },
  caterer: {
    scope: "caterer",
    path: (path) => catererPath(path),
    homeHref: () => catererPath("/caterer"),
  },
  traeger: {
    scope: "org",
    path: (path) => traegerPath(path),
    homeHref: (session) => traegerHomeHref(session),
  },
};
