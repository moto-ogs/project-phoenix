"use client";

import type { Session } from "next-auth";
import { PortalAuthGuard } from "~/components/auth/portal-auth-guard";
import { ShellIntlProvider } from "~/components/dashboard/shell-intl-provider";
import { TraegerShell } from "~/components/traeger/traeger-shell";
import {
  useTraegerOwnName,
  type TraegerMembershipKey,
} from "~/components/traeger/traeger-own-name";
import { useTraegerOrganization } from "~/components/traeger/use-traeger-organization";
import { BreadcrumbProvider } from "~/lib/breadcrumb-context";
import { hasSessionAccess } from "~/lib/session-access";
import { TraegerShellProvider } from "~/lib/shell-auth-context";
import { traegerPath } from "~/lib/traeger-url";

const TRAEGER_PUBLIC_PAGES = [
  "/login",
  "/reset-password",
  "/invite",
  // Entry of the public demo (#6193): it signs the visitor in itself.
  "/demo",
];

/**
 * A session whose refresh ended for good (expired or revoked refresh token,
 * membership gone) goes back to the login page, which clears the failed
 * session. The layout's server snapshot carries no token and stays (#4991).
 */
function endedSessionRedirect(session: Session): string | null {
  return session.error === "RefreshTokenExpired" || !hasSessionAccess(session)
    ? traegerPath("/traeger/login")
    : null;
}

/** Client-side auth guard for Träger routes ("moto träger", #4649). */
export function TraegerAuthGuard({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <PortalAuthGuard
      portal="traeger"
      publicPages={TRAEGER_PUBLIC_PAGES}
      wrongScope="login"
      endedSessionRedirect={endedSessionRedirect}
      loadingMessage="moto träger wird geöffnet …"
      renderShell={(page, session) => {
        const user = session?.user;
        return (
          <TraegerPortal
            membership={user?.id ? `${user.id}:${user.orgId ?? ""}` : null}
          >
            {page}
          </TraegerPortal>
        );
      }}
    >
      {children}
    </PortalAuthGuard>
  );
}

/**
 * The signed-in portal: the shared shell providers nested like the caterer
 * portal's (#5145). The Träger is read once here, for its name next to the
 * logo and the test-system strip, and the own profile for the person's name
 * in the header (#6870).
 */
function TraegerPortal({
  children,
  membership,
}: {
  readonly children: React.ReactNode;
  readonly membership: TraegerMembershipKey | null;
}) {
  const organization = useTraegerOrganization();
  const ownName = useTraegerOwnName(membership);
  return (
    <TraegerShellProvider
      organizationName={organization?.name}
      memberName={ownName.name}
    >
      <BreadcrumbProvider>
        <ShellIntlProvider>
          <TraegerShell
            testSystem={organization?.testSystem === true}
            federalStates={organization?.federalStates}
          >
            {children}
          </TraegerShell>
        </ShellIntlProvider>
      </BreadcrumbProvider>
    </TraegerShellProvider>
  );
}
