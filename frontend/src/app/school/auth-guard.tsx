"use client";

import { PortalAuthGuard } from "~/components/auth/portal-auth-guard";
import { Alert } from "~/components/ui/alert";
import { portalNotBookedExplanation } from "~/lib/portal-not-booked";
import { SchoolShellProvider } from "~/lib/shell-auth-context";
import { BreadcrumbProvider } from "~/lib/breadcrumb-context";
import { SchoolShell } from "~/components/school/shell/school-shell";
import { SchoolRealtimeBridge } from "~/components/school/school-realtime-bridge";
import { ShellIntlProvider } from "~/components/dashboard/shell-intl-provider";
import { PwaInstallHint } from "~/components/tenant/pwa-install-hint";
import { PortalNotificationSetup } from "~/components/notifications/portal-notification-setup";

const SCHOOL_PUBLIC_PAGES = [
  "/login",
  // Accept flow for Lehrkraft invitations — gated by the invitation token.
  "/invite",
  "/reset-password",
];

/**
 * Client-side auth guard for school routes ("moto schule", #2207). The
 * portal brings its own chrome (SchoolShell: sidebar, shared header with
 * profile menu, mobile nav), fed by SchoolShellProvider.
 */
export function SchoolAuthGuard({
  children,
  notBooked = false,
}: {
  readonly children: React.ReactNode;
  /** The page load's session check found the portal's module not booked. */
  readonly notBooked?: boolean;
}) {
  // ShellIntlProvider: die geteilte Kopfzeile ruft
  // useTranslations("parentNav") für die Eltern-Titel auf; das deutschsprachige
  // Schul-Portal bekommt denselben minimalen Katalog wie Personal und Operator.
  return (
    <PortalAuthGuard
      portal="school"
      publicPages={SCHOOL_PUBLIC_PAGES}
      wrongScope="root"
      loadingMessage="moto schule wird geöffnet …"
      renderShell={(page, session) => (
        <SchoolShellProvider>
          <BreadcrumbProvider>
            <ShellIntlProvider>
              <SchoolRealtimeBridge />
              <SchoolShell>
                {notBooked || session?.notBooked ? (
                  <Alert
                    type="info"
                    message={portalNotBookedExplanation("school", "de")}
                  />
                ) : (
                  page
                )}
              </SchoolShell>
              <PwaInstallHint samsungOnly />
              <PortalNotificationSetup portal="school" />
            </ShellIntlProvider>
          </BreadcrumbProvider>
        </SchoolShellProvider>
      )}
    >
      {children}
    </PortalAuthGuard>
  );
}
