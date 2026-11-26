"use client";

import type { Session } from "next-auth";
import { ParentPortalAnalyticsSession } from "~/components/analytics/parent-portal-analytics-session";
import { PortalProviders } from "~/components/auth/portal-providers";
import { PushSubscriptionSync } from "~/components/notifications/push-subscription-sync";
import { ModulePortalProvider } from "~/lib/module-portal-context";
import { ParentLocaleProvider } from "~/lib/parent-locale-context";
import { KitLocaleFromIntl } from "~/components/ui/kit-locale-intl";
import { useTranslations } from "next-intl";

/**
 * Parent-scoped providers. No ProfileProvider or SupervisionProvider —
 * those are tenant-only.
 *
 * ParentLocaleProvider is mounted once here, inside SessionProvider. It derives
 * its authenticated state from the session itself, so the same instance handles
 * anonymous pages (login: cookie-only locale) and authenticated ones (syncs +
 * persists portal_locale) without the auth guard mounting a second, shadowing
 * provider.
 */
export function ParentProviders({
  children,
  session,
  sessionMark,
}: Readonly<{
  children: React.ReactNode;
  session?: Session | null;
  /** The session mark the page was rendered with (#8082). */
  sessionMark: string;
}>) {
  const t = useTranslations("sessionTree");
  return (
    <PortalProviders
      portal="parent"
      session={session}
      sessionMark={sessionMark}
      sessionTreeLabels={{
        checking: t("checking"),
        leaving: t("leaving"),
        changed: t("changed"),
        unconfirmed: t("unconfirmed"),
        reload: t("reload"),
        reloadHint: t("reloadHint"),
      }}
    >
      <PushSubscriptionSync portal="parent" />
      <ParentPortalAnalyticsSession />
      <ParentLocaleProvider>
        {/* Kit-Standardtexte sind deutsch; andere Sprachen lassen sie weg. */}
        <KitLocaleFromIntl>
          <ModulePortalProvider portal="parent">
            {children}
          </ModulePortalProvider>
        </KitLocaleFromIntl>
      </ParentLocaleProvider>
    </PortalProviders>
  );
}
