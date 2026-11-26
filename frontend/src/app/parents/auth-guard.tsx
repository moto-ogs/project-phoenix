"use client";

import { parentKeys } from "~/lib/swr/parent-keys";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { useSWRAuth } from "~/lib/swr";
import { PortalAuthGuard } from "~/components/auth/portal-auth-guard";
import { Alert } from "~/components/ui/alert";
import { normalizeLocale } from "~/i18n/locales";
import { isModuleNotBooked } from "~/lib/module-not-booked";
import { portalNotBookedExplanation } from "~/lib/portal-not-booked";
import { fetchParentProfile } from "~/lib/parent-api";
import { ParentShellProvider } from "~/lib/shell-auth-context";
import { BreadcrumbProvider } from "~/lib/breadcrumb-context";
import { ParentShell } from "~/components/parent/shell/parent-shell";
import { ParentPageSkeleton } from "~/components/parent/parent-page";
import { ParentRealtimeBridge } from "~/components/parent/parent-realtime-bridge";
import { ParentNotificationOnboarding } from "~/components/parent/parent-notification-onboarding";
import { PARENT_PUBLIC_PAGES } from "~/lib/portal-public-pages";

/**
 * Client-side auth guard for parent routes. Unlike the other portals it
 * renders the shell while the session loads, with a skeleton for the page.
 */
export function ParentAuthGuard({
  children,
  notBooked = false,
}: {
  readonly children: React.ReactNode;
  /** The page load's session check found the portal's module not booked. */
  readonly notBooked?: boolean;
}) {
  return (
    <PortalAuthGuard
      portal="parent"
      publicPages={PARENT_PUBLIC_PAGES}
      wrongScope="root"
      loading="shell"
      renderShell={(page) => (
        <ParentPortal notBooked={notBooked}>{page}</ParentPortal>
      )}
    >
      {children}
    </PortalAuthGuard>
  );
}

function ParentPortal({
  children,
  notBooked,
}: {
  readonly children: React.ReactNode;
  readonly notBooked: boolean;
}) {
  const { data: session, status } = useSession();
  // Der Name der Kopfzeile kommt aus dem Elternprofil (#3891).
  const locale = normalizeLocale(useLocale());
  const { data: profile, error: profileError } = useSWRAuth(
    status === "authenticated" && session?.user?.id
      ? parentKeys.profile()
      : null,
    fetchParentProfile,
    { keepPreviousData: false },
  );

  const sessionLoading = status === "loading" || !session;

  // Locale handling lives in the single ParentLocaleProvider mounted by
  // ParentProviders; it picks up the now-authenticated session on its own.
  return (
    <ParentShellProvider
      accountName={
        profile
          ? { firstName: profile.first_name, lastName: profile.last_name }
          : undefined
      }
    >
      <BreadcrumbProvider>
        {!sessionLoading ? <ParentRealtimeBridge /> : null}
        <ParentShell>
          {sessionLoading ? (
            <ParentPageSkeleton rows={2} />
          ) : notBooked ||
            session.notBooked ||
            isModuleNotBooked(profileError) ? (
            // Keine Schule des Kontos nutzt das Elternportal mehr (#4895):
            // ein Hinweis statt einer Fehlerkarte je Bereich der Seite.
            <Alert
              type="info"
              message={portalNotBookedExplanation("parent", locale)}
            />
          ) : (
            children
          )}
          {!sessionLoading ? (
            <ParentNotificationOnboarding accountId={session.user.id} />
          ) : null}
        </ParentShell>
      </BreadcrumbProvider>
    </ParentShellProvider>
  );
}
