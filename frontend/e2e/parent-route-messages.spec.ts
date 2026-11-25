import type { Page } from "@playwright/test";
import {
  readSeedEnrollmentToken,
  readSeedParents,
} from "../scripts/seed-state";
import { loginToLocalTenant } from "./local-tenant-login";
import { MISSING_SEED_ACCESS, seedAccess, tenantBase } from "./tenant-session";
import { expect, test } from "./a11y/scan";
import { frontendPort } from "./frontend-port";

const host =
  process.env.NEXT_PUBLIC_PARENTS_HOSTNAME ??
  `eltern.localhost:${frontendPort}`;
const base = `http://${host}`;
const parent = readSeedParents().find((account) => account.children === 1);
const statusToken = readSeedEnrollmentToken();
if (process.env.CI && (!parent || !statusToken))
  throw new Error(
    "Der E2E-Seed braucht ein Elternkonto mit einem Kind und eine Anmeldung.",
  );

function collectIntlErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (event) => {
    if (
      /MISSING_MESSAGE|FORMATTING_ERROR|IntlError|INVALID_MESSAGE/.test(
        event.text(),
      )
    )
      errors.push(event.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.use({ locale: "de-DE" });

test("keeps login messages scoped on direct entry, language change and client navigation", async ({
  page,
}) => {
  const intlErrors = collectIntlErrors(page);

  const response = await page.goto(`${base}/login`);
  await expect(
    page.getByRole("button", { name: "Anmelden", exact: true }),
  ).toBeVisible();
  const html = await response!.text();
  expect(html).toContain("Willkommen im Eltern-Portal");
  expect(
    ["careContractSigning", "parentChildDetail"].filter((key) =>
      html.includes(key),
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Sprache Deutsch" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/reset-password`);
  await expect(
    page.getByText("The link is incomplete. Please request a new link."),
  ).toBeVisible();

  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "We will send you a link.",
  );
  expect(documents).toEqual([]);
  expect(intlErrors).toEqual([]);
});

test("Elternstart und Kinddetail behalten ihre eigenen Texte beim Seitenwechsel", async ({
  page,
}) => {
  test.skip(!parent, MISSING_SEED_ACCESS);
  const errors = collectIntlErrors(page);
  await page.goto(`${base}/login`);
  await page.getByLabel("E-Mail-Adresse").fill(parent!.email);
  await page.locator("#password").fill(parent!.password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(
    page.getByText("Das Wichtigste für heute auf einen Blick."),
  ).toBeVisible();
  const collapse = page.getByRole("button", {
    name: "Erste Schritte einklappen",
  });
  await page.addLocatorHandler(collapse, () => collapse.click());
  await page.getByRole("link", { name: "Profil ansehen" }).first().click();
  const details = page.getByRole("tab", { name: "Angaben zum Kind" });
  await details.click();
  await expect(
    page.getByRole("tabpanel", { name: "Angaben zum Kind" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Kontakte & Abholung" }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Kontakte & Abholung" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("English public enrollment", () => {
  test.use({ locale: "en-GB" });
  test("translates the picker, a submitted application and the staff preview", async ({
    page,
  }) => {
    test.skip(!seedAccess || !statusToken, MISSING_SEED_ACCESS);
    const errors = collectIntlErrors(page);
    await page.goto(`${tenantBase}/anmeldung`);
    await expect(
      page.getByRole("heading", {
        name: "What would you like to enroll your child for?",
      }),
    ).toBeVisible();
    await page.goto(`${tenantBase}/anmeldung/status/${statusToken}`);
    await expect(
      page.getByRole("heading", { name: "Status of your enrollment" }),
    ).toBeVisible();
    await loginToLocalTenant(page, tenantBase, seedAccess!);
    await page.goto(`${tenantBase}/anmeldung/preview?base=1`);
    await expect(
      page.getByText("Legal guardian", { exact: true }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
