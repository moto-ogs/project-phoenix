import { expect, test } from "@playwright/test";

import {
  MISSING_SEED_ACCESS,
  seedAccess as access,
  tenantBase as base,
} from "./tenant-session";

// /planung und die Alt-Stubs leiten mit übersetzten Parametern in das
// Drei-Parameter-Schema (d, view, block/verlauf) weiter. Die Übersetzung prüft
// src/components/timetable/planung-redirect.test.ts, hier nur die
// Verdrahtung am laufenden Server. Seitenleiste und Menü „Mehr“ prüfen
// sidebar.test.tsx und mobile-bottom-nav.test.tsx; ihre Browser-Tests hier
// schlugen nach jeder gewollten Navigationsänderung fehl, ohne einen
// Produktfehler zu finden (#7096).

if (access) test.use({ baseURL: base });

test.describe("Planung server redirects", () => {
  // Inspect the first HTTP response, without following it or signing in:
  // compatibility must work before any client navigation can render.
  for (const [source, target] of [
    ["/planung", "/betreuungsplan"],
    ["/planung?tab=dienstplan", "/dienstplan"],
    [
      "/timetables?day=2026-09-14&view=month&instance=42",
      "/betreuungsplan?d=2026-09-14&view=monat&block=42",
    ],
    [
      "/vertretungsplan?history=1&instance=42",
      "/vertretung?block=42&verlauf=1",
    ],
    ["/staff/dienstplan?tab=betreuung&instance=42", "/dienstplan"],
  ] as const) {
    test(`${source} redirects before rendering`, async ({ request }) => {
      test.skip(access === null, MISSING_SEED_ACCESS);
      const response = await request.get(source, { maxRedirects: 0 });

      expect(response.status()).toBe(307);
      expect(
        new URL(response.headers().location ?? "", response.url()).href,
      ).toBe(`${base}${target}`);
    });
  }
});
