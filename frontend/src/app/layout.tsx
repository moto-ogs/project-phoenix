import "~/styles/globals.css";

import { Providers } from "./providers";
import { BackgroundWrapper } from "~/components/background-wrapper";
import localFont from "next/font/local";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLocale, getMessages } from "next-intl/server";
import { RouteTitle } from "~/components/page-title/route-title";
import {
  pageTitleSurfaceOf,
  type LocalizedPageTitleMessages,
} from "~/lib/page-titles";
import { configuredPortalOfHost } from "~/lib/portal-paths";
import {
  faviconMetadata,
  isParentsHost,
  resolveFaviconVariant,
} from "~/lib/favicon-variants";
import { getParentAppMetadata } from "~/i18n/parent-app-metadata";
import type { AppLocale } from "~/i18n/locales";

const inter = localFont({
  src: "../fonts/inter-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: true,
  variable: "--font-inter",
  fallback: ["Arial", "sans-serif"],
});

const motoFont = localFont({
  src: "../fonts/kalam-latin-700.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  preload: true,
  variable: "--font-moto",
  fallback: ["Arial", "sans-serif"],
});

// No title here: every page gets its own through RouteTitle (#7109). A
// shared default would hide a page without one from page-titles.test.ts.
const baseMetadata = {
  description:
    "Das innovative An- und Abmeldesystem mit NFC-Armbändern für die offene Ganztagsschule. DSGVO-konform, entwickelt an der Universität Münster.",
} satisfies Metadata;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function hostConfig() {
  return {
    operatorHostname: requiredEnv("NEXT_PUBLIC_OPERATOR_HOSTNAME"),
    parentsHostname: requiredEnv("NEXT_PUBLIC_PARENTS_HOSTNAME"),
    schoolHostname: requiredEnv("NEXT_PUBLIC_SCHOOL_HOSTNAME"),
    tenantDomain: requiredEnv("TENANT_DOMAIN"),
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const host = requestHost(await headers());
  const config = hostConfig();
  const variant = resolveFaviconVariant(host, config);
  const parentCopy = isParentsHost(host, config)
    ? getParentAppMetadata((await getLocale()) as AppLocale)
    : null;

  return {
    ...(parentCopy ? { description: parentCopy.description } : baseMetadata),
    ...faviconMetadata(variant),
  };
}

/**
 * Kein maximumScale und kein userScalable: die App muss auf jedem Gerät
 * vergrößert werden können (#2267). Ein gesperrter Zoom sperrt genau die
 * Menschen aus, die ihn brauchen.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
};

function requestHost(requestHeaders: Headers): string {
  const raw =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  return (raw.split(",")[0] ?? "").trim();
}

/** Host name without port; an unparsable Host header names no portal. */
function hostnameOf(host: string): string {
  if (host === "" || !URL.canParse(`http://${host}`)) return "";
  return new URL(`http://${host}`).hostname;
}

async function pageTitleProps() {
  const host = requestHost(await headers());
  const config = hostConfig();
  const hostname = hostnameOf(host);
  // isParentsHost also knows the legacy parents host.
  const portal = isParentsHost(host, config)
    ? "parent"
    : hostname === ""
      ? "tenant"
      : configuredPortalOfHost(host);
  const hostSurface = pageTitleSurfaceOf(portal, hostname, config.tenantDomain);
  const messages = (await getMessages()) as {
    pageTitles?: LocalizedPageTitleMessages;
  };
  return {
    hostSurface,
    messages: messages.pageTitles ?? { pages: {} },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the locale for <html lang> only. request.ts returns the default
  // locale ("de") on every surface except the parent-facing ones (the proxy
  // sets the localize header there), so staff/operator stay German. The
  // NextIntlClientProvider — and the message catalog it serializes to the
  // client — is mounted only on the localized surfaces (parents layout +
  // public enrollment layout), not app-wide, so the German-only portals don't
  // ship the parent catalog.
  const locale = await getLocale();
  const titleProps = await pageTitleProps();
  return (
    <html lang={locale}>
      <body
        className={`${inter.className} ${inter.variable} ${motoFont.variable}`}
      >
        <Providers>
          <RouteTitle {...titleProps}>
            <BackgroundWrapper>{children}</BackgroundWrapper>
          </RouteTitle>
        </Providers>
      </body>
    </html>
  );
}
