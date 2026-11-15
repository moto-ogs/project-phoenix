import { type Page } from "@playwright/test";

import { readSeedAccess, readSeedParents } from "../scripts/seed-state";
import { expect, test } from "./a11y/scan";
import { loginToLocalMfaPortal } from "./local-tenant-login";
import { tenantBase } from "./tenant-session";

// A11y-Ratchet (#7107): Die Flow-Specs decken nur das Tenant-Portal ab. Diese
// Spec öffnet die übrigen Einstiege einmal, damit axe sie prüft (scan.ts):
// Personal-, Eltern- und Träger-Login, Anmeldeformular leer und nach leerem
// Absenden, Startseiten von Eltern, Träger und Schulportal. Sie prüft nur,
// dass die Seite da ist; die Verstöße zählt der Fixture-Wrapper.

function origin(hostVariable: string): string {
  const host = process.env[hostVariable];
  if (!host) throw new Error(`${hostVariable} fehlt (playwright.config.ts).`);
  return `http://${host}`;
}

const parent = readSeedParents()[0] ?? null;
const traeger = readSeedAccess({ role: "school_admin" });
const lehrkraft = readSeedAccess({ role: "lehrkraft" });
const parentsBase = origin("NEXT_PUBLIC_PARENTS_HOSTNAME");
const traegerBase = origin("NEXT_PUBLIC_TRAEGER_HOSTNAME");
const schoolBase = origin("NEXT_PUBLIC_SCHOOL_HOSTNAME");

if (process.env.CI && !(parent && traeger && lehrkraft && tenantBase)) {
  throw new Error(
    "E2E in CI braucht Eltern-, Träger- und Lehrkraft-Zugang in backend/.seed-state.json.",
  );
}

test.use({ locale: "de-DE", timezoneId: "Europe/Berlin" });

async function visibleMain(page: Page) {
  await expect(page.getByRole("main").first()).toBeVisible({
    timeout: 60_000,
  });
}

test("Personal-Login", async ({ page }) => {
  test.skip(!tenantBase, "backend/.seed-state.json fehlt");
  await page.goto(`${tenantBase}/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("Anmeldeformular leer und nach leerem Absenden", async ({
  page,
  a11y,
}) => {
  test.skip(!tenantBase, "backend/.seed-state.json fehlt");
  await page.goto(`${tenantBase}/anmeldung`, { waitUntil: "domcontentloaded" });
  const phase = page
    .locator('a[href*="/anmeldung/"]')
    .filter({ hasNotText: /status|vorschau/i })
    .first();
  await expect(phase).toBeVisible({ timeout: 60_000 });
  await page.goto(
    new URL((await phase.getAttribute("href"))!, page.url()).href,
    {
      waitUntil: "domcontentloaded",
    },
  );
  const submit = page.locator('button[type="submit"]').last();
  await expect(submit).toBeVisible({ timeout: 60_000 });
  await submit.click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await a11y.scan(page, "leer abgesendet");
});

test("Eltern-Login und Startseite", async ({ page }) => {
  test.skip(!parent, "Elternkonto in backend/.seed-state.json fehlt");
  await page.goto(`${parentsBase}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(parent!.email);
  await page.locator("#password").fill(parent!.password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
  await visibleMain(page);
});

test("Träger-Login und Startseite", async ({ page }) => {
  // Anmeldung mit zweitem Faktor über Mailpit und kalte Übersetzung.
  test.slow();
  test.skip(!traeger, "Träger-Zugang in backend/.seed-state.json fehlt");
  await loginToLocalMfaPortal(page, traegerBase, traeger!);
  await visibleMain(page);
});

test("Schulportal-Startseite", async ({ page }) => {
  // Anmeldung mit zweitem Faktor über Mailpit und kalte Übersetzung.
  test.slow();
  test.skip(!lehrkraft, "Lehrkraft in backend/.seed-state.json fehlt");
  await loginToLocalMfaPortal(page, schoolBase, lehrkraft!);
  await visibleMain(page);
});
