import { expect, test } from "./a11y/scan";
import { frontendPort } from "./frontend-port";

test.use({ locale: "de-DE" });

test("keeps login messages scoped on direct entry, language change and client navigation", async ({
  page,
}) => {
  const host =
    process.env.NEXT_PUBLIC_PARENTS_HOSTNAME ??
    `eltern.localhost:${frontendPort}`;
  const base = `http://${host}`;
  const intlErrors: string[] = [];
  page.on("console", (event) => {
    if (/MISSING_MESSAGE|FORMATTING_ERROR|IntlError/.test(event.text()))
      intlErrors.push(event.text());
  });
  page.on("pageerror", (error) => intlErrors.push(error.message));

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
