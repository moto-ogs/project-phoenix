"use client";

import { PortalAuthGuard } from "~/components/auth/portal-auth-guard";
import { CatererShell } from "~/components/caterer/caterer-shell";
import { ShellIntlProvider } from "~/components/dashboard/shell-intl-provider";
import { BreadcrumbProvider } from "~/lib/breadcrumb-context";
import { CatererShellProvider } from "~/lib/shell-auth-context";

const CATERER_PUBLIC_PAGES = [
  "/login",
  "/reset-password",
  // The mailed invitation: the link itself is the proof.
  "/einladung",
];

/** Client-side guard of the caterer portal (ADR 0077). */
export function CatererAuthGuard({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <PortalAuthGuard
      portal="caterer"
      publicPages={CATERER_PUBLIC_PAGES}
      wrongScope="login"
      loadingMessage="Caterer-Portal wird geöffnet …"
      renderShell={(page) => (
        <CatererShellProvider>
          <BreadcrumbProvider>
            <ShellIntlProvider>
              <CatererShell>{page}</CatererShell>
            </ShellIntlProvider>
          </BreadcrumbProvider>
        </CatererShellProvider>
      )}
    >
      {children}
    </PortalAuthGuard>
  );
}
