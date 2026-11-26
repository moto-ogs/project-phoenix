"use client";

import type { Session } from "next-auth";
import { PortalAuthGuard } from "~/components/auth/portal-auth-guard";
import { ShellIntlProvider } from "~/components/dashboard/shell-intl-provider";
import { TraegerModuleGate } from "~/components/traeger/traeger-module-not-booked";
import { TraegerShell } from "~/components/traeger/traeger-shell";
import {
  useTraegerOwnName,
  type TraegerMembershipKey,
} from "~/components/traeger/traeger-own-name";
import {
  useTraegerBookedModules,
  useTraegerOrganization,
} from "~/components/traeger/use-traeger-organization";
import { BreadcrumbProvider } from "~/lib/breadcrumb-context";
import { hasSessionAccess } from "~/lib/session-access";
import { TraegerShellProvider } from "~/lib/shell-auth-context";
import { traegerPath } from "~/lib/traeger-url";

import { TRAEGER_PUBLIC_PAGES } from "./public-pages";

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
  const booked = useTraegerBookedModules();
  const ownName = useTraegerOwnName(membership);
  return (
    <TraegerShellProvider
      organizationName={organization?.name}
      memberName={ownName.name}
      bookedModules={booked.modules}
    >
      <BreadcrumbProvider>
        <ShellIntlProvider>
          {/* Pages of a moto module no school of the Träger booked explain
              themselves; the navigation shows them with a lock (#6052). */}
          <TraegerModuleGate booked={booked}>
            <TraegerShell
              testSystem={organization?.testSystem === true}
              federalStates={organization?.federalStates}
              bookedModules={booked.modules}
            >
              {children}
            </TraegerShell>
          </TraegerModuleGate>
        </ShellIntlProvider>
      </BreadcrumbProvider>
    </TraegerShellProvider>
  );
}
