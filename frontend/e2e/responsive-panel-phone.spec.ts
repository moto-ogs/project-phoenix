import { expect, test, type Page } from "@playwright/test";

import {
  MISSING_SEED_ACCESS,
  loginToTenant,
  seedAccess,
  tenantBase,
} from "./tenant-session";

// Blatt von unten am Handy (#7798): Unter 640 px öffnet das Drei-Punkte-Menü
// als Blatt (`ResponsivePanel`). Die Unit-Tests prüfen Fokus, Escape und das
// Tippen daneben in happy-dom; hier geht es um das, was nur der echte Browser
// zeigt: Wischen nach unten, die Tastatur und ein Dialog aus einem Eintrag.
// Ein Aufbau, mehrere Fälle, damit der Lauf billig bleibt.

if (seedAccess) test.use({ baseURL: tenantBase });

test.use({
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
  locale: "de-DE",
});

/** Der Knopf „+“ unten rechts in der Personal-Liste, ein Menü mit zwei Wegen. */
function createMenu(page: Page) {
  return page.getByRole("button", { name: "Personal hinzufügen" });
}

function sheet(page: Page) {
  return page.getByRole("dialog", { name: "Personal hinzufügen" });
}

test.describe("Drei-Punkte-Menü am Handy", () => {
  test.skip(seedAccess === null, MISSING_SEED_ACCESS);

  test("öffnet als Blatt, schließt durch Wischen und Escape, ein Eintrag öffnet seinen Dialog", async ({
    page,
  }) => {
    await loginToTenant(page, seedAccess!);
    await page.goto(`${tenantBase}/database/personal`, {
      waitUntil: "domcontentloaded",
    });
    const trigger = createMenu(page);
    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    // Tastatur: Fokus auf dem ersten Eintrag, Escape gibt ihn zurück.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Personal einladen" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(trigger).toBeFocused();

    // Wischen nach unten am Griff schließt das Blatt.
    await trigger.tap();
    await expect(sheet(page)).toBeVisible();
    const handle = sheet(page).locator("[data-drawer-handle]");
    const box = await handle.boundingBox();
    expect(box, "Griff des Blatts nicht sichtbar").not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 150, { steps: 8 });
    await page.mouse.move(x, y + 400, { steps: 8 });
    await page.mouse.up();
    await expect(sheet(page)).toBeHidden();

    // Ein Eintrag öffnet seinen Dialog und schließt das Blatt.
    await trigger.tap();
    await page.getByRole("menuitem", { name: "Personal einladen" }).tap();
    await expect(sheet(page)).toBeHidden();
    await expect(
      page.locator('[data-setup-tour="invite-submit"]'),
    ).toBeVisible();
  });
});

// Auswahlliste im Filter-Blatt (#7800): Sie öffnet als zweites Blatt darüber.
// Nach dem Schließen bleibt das Filter-Blatt mit seinen Werten stehen.
test.describe("Filter mit Auswahlliste am Handy", () => {
  test.skip(seedAccess === null, MISSING_SEED_ACCESS);

  test("öffnet die Gruppe als gestapeltes Blatt über dem Filter-Blatt", async ({
    page,
  }) => {
    await loginToTenant(page, seedAccess!);
    await page.goto(`${tenantBase}/database/students`, {
      waitUntil: "domcontentloaded",
    });
    const filterButton = page.getByTestId("mobile-filter-button");
    await expect(filterButton).toBeVisible({ timeout: 60_000 });
    await filterButton.tap();
    const filterSheet = page.getByRole("dialog", { name: "Filter" });
    await expect(filterSheet).toBeVisible();

    const groupTrigger = filterSheet.getByRole("combobox", { name: "Gruppe" });
    const groupSheet = page.getByRole("dialog", { name: "Gruppe" });

    // Tastatur: Fokus auf dem gewählten Wert, Escape schließt nur das obere.
    await groupTrigger.tap();
    await expect(groupSheet).toBeVisible();
    await expect(
      groupSheet.getByRole("option", { name: "Alle Gruppen" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(groupSheet).toBeHidden();
    await expect(filterSheet).toBeVisible();
    await expect(groupTrigger).toBeFocused();

    // Tippen auf einen Eintrag setzt ihn und landet wieder im Filter-Blatt.
    await groupTrigger.tap();
    const option = groupSheet.getByRole("option").nth(1);
    const chosen = (await option.getAttribute("aria-label")) ?? "";
    await option.tap();
    await expect(groupSheet).toBeHidden();
    await expect(filterSheet).toBeVisible();
    await expect(groupTrigger).toContainText(chosen);

    // Anwenden schließt das Filter-Blatt.
    await filterSheet.getByRole("button", { name: "Anwenden" }).tap();
    await expect(filterSheet).toBeHidden();
  });
});
