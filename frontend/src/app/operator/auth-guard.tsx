"use client";

import { Fragment } from "react";
import type { Session } from "next-auth";
import { useSWRCacheKey } from "~/lib/swr";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";
import { sessionIdentityKey } from "~/lib/session-access";
import { operatorPath } from "~/lib/operator-url";
import { OperatorShellProvider } from "~/lib/shell-auth-context";
import { BreadcrumbProvider } from "~/lib/breadcrumb-context";
import { AppShell } from "~/components/dashboard/app-shell";
import { ShellIntlProvider } from "~/components/dashboard/shell-intl-provider";
import {
  FullPageLoading,
  PortalAuthGuard,
} from "~/components/auth/portal-auth-guard";

const OPERATOR_PUBLIC_PAGES = ["/login", "/email-confirm", "/invite"];

// The login page clears failed sessions and explains how to sign in again.
function endedSessionRedirect(session: Session): string | null {
  return session.error === undefined
    ? null
    : operatorPath("/operator/login?error=SessionExpired");
}

export function OperatorAuthGuard({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <PortalAuthGuard
      portal="operator"
      publicPages={OPERATOR_PUBLIC_PAGES}
      wrongScope="root"
      endedSessionRedirect={endedSessionRedirect}
      renderShell={(page, session) => (
        <OperatorPortal session={session}>{page}</OperatorPortal>
      )}
    >
      {children}
    </PortalAuthGuard>
  );
}

function OperatorPortal({
  children,
  session,
}: {
  readonly children: React.ReactNode;
  readonly session: Session | null;
}) {
  const contentScope = useSWRCacheKey()(
    operatorProvisioningKeys.organizations(),
  );
  if (!contentScope) return <FullPageLoading />;

  return (
    <OperatorShellProvider>
      <BreadcrumbProvider>
        <ShellIntlProvider>
          <AppShell>
            {/* Also discard local form/modal state, not only cached responses. */}
            <Fragment key={`${contentScope}:${sessionIdentityKey(session)}`}>
              {children}
            </Fragment>
          </AppShell>
        </ShellIntlProvider>
      </BreadcrumbProvider>
    </OperatorShellProvider>
  );
}
