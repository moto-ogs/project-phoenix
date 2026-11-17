import type { Preview } from "@storybook/nextjs-vite";
import { SessionProvider } from "next-auth/react";
import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import { Providers } from "~/app/providers";
import { TenantProvider } from "~/lib/tenant-context";
import { mockSessionData } from "./fixtures/session";
import type { TenantInfo } from "~/lib/tenant-api";
import deMessages from "~/i18n/messages/de.generated";

import { configure } from "storybook/test";

import { findTextCollisions } from "./text-collisions";

import "~/styles/globals.css";
import "./fonts.css";

// Fake tenant metadata satisfying TenantInfo (see ~/lib/tenant-api) so
// components reading tenant context (LOCATION_COLORS-driven badges, feature
// gates, etc.) render as if inside the real [tenant] route segment.
const storybookTenant: TenantInfo = {
  tenantId: 1,
  slug: "storybook",
  name: "Storybook Schule",
  subdomain: "storybook",
  organizationId: 1,
  organizationName: "Storybook Org",
  settings: {},
  presenceMode: "detailed",
  studentPhotosEnabled: true,
  nfcEnabled: true,
  messagingEnabled: true,
};

// Die Storybook-Tests (#7108) laufen alle Stories parallel; unter dieser Last
// öffnete ein Kalender im ersten Vollauf erst nach der Standardsekunde von
// findBy*. Fünf Sekunden fangen das ab, ein echter Fehler bleibt rot.
configure({ asyncUtilTimeout: 5000 });

const PHONE_WIDTH = 360;
const PHONE_HEIGHT = 780;

/** Two frames: the layout and what ResizeObservers change after it. */
function nextFrames(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

const preview: Preview = {
  // Schriften vor jedem Render laden, wie next/font es in der App vorab tut.
  // Sonst misst ein Baustein beim Mounten mit der Ersatzschrift und misst
  // nicht neu: der Unterstrich der damaligen NavigationTabs saß im Pixel-Vergleich
  // (#6562) in etwa jedem fünften Lauf 18 px zu weit links.
  loaders: [
    async () => {
      await Promise.all([
        document.fonts.load('1em "Inter Storybook"'),
        document.fonts.load('700 1em "Kalam Storybook"'),
      ]);
      return {};
    },
  ],
  parameters: {
    a11y: {
      test: "error",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  // Kein Text darf über einem Knopf oder anderem Text liegen (#7265). Eine
  // Story mit gewollter Überdeckung schaltet die Prüfung mit
  // `parameters: { textCollisions: "<Grund>" }` ab.
  afterEach: async ({ canvasElement, parameters }) => {
    if (typeof parameters.textCollisions === "string") return;
    const body = canvasElement.ownerDocument.body;
    const found = findTextCollisions(body);
    // Die erste Prüfung läuft in der Breite, die addon-vitest jeder Story
    // gibt (1200 × 900, oder ihr eigener Viewport). Im Storybook-Test
    // zusätzlich bei Telefonbreite (`vitest.setup.ts`).
    const setViewport = (
      globalThis as {
        __motoSetViewport?: (w: number, h: number) => Promise<void>;
      }
    ).__motoSetViewport;
    if (setViewport) {
      const { innerWidth, innerHeight } = globalThis;
      await setViewport(PHONE_WIDTH, PHONE_HEIGHT);
      await nextFrames();
      found.push(
        ...findTextCollisions(body).map((hit) => `${PHONE_WIDTH} px: ${hit}`),
      );
      await setViewport(innerWidth, innerHeight);
    }
    if (found.length === 0) return;
    const message = `Text überdeckt sich:\n${found.join("\n")}`;
    // Der Test scheitert; die Storybook-Ansicht zeigt die Story weiter.
    if (setViewport) throw new Error(message);
    console.warn(message);
  },
  decorators: [
    (Story) => (
      <SessionProvider session={mockSessionData()}>
        <NextIntlClientProvider
          locale="de"
          messages={deMessages as AbstractIntlMessages}
        >
          <TenantProvider
            tenantSlug="storybook"
            tenant={storybookTenant}
            routingMode="path"
          >
            <Providers>
              <Story />
            </Providers>
          </TenantProvider>
        </NextIntlClientProvider>
      </SessionProvider>
    ),
  ],
};

export default preview;
