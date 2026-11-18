import { expect, test, type Page } from "@playwright/test";
import { HEAD_ACTIONS_LAYOUT } from "../../src/components/ui/control-geometry";
import { compileGlobalsCss, render } from "./harness";

// Bedienelemente, die auf Tablet und Handy aus dem Bild rutschten (#4975):
// die Aktionen im Kopf einer `SectionCard` (Speiseplan, Bestellung) und die
// untere Navigation mit einem langen aktiven Reiter. Nachgebaut ist das
// Markup der Komponenten; Playwright importiert kein JSX aus `src`.

// Die Klassen stehen im Klartext, damit Tailwinds Quellensuche sie findet.
const CARD_ACTIONS_FIXED =
  "order-last flex w-full max-w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto sm:shrink-0";
const CARD_ACTIONS_BEFORE =
  "order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto sm:shrink-0";

const HEAD_ACTIONS_FIXED =
  "ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2";
const HEAD_ACTIONS_BEFORE =
  "ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2";

// `HEAD_ACTIONS_LAYOUT` (control-geometry.ts) mit einer Tagesnavigation:
// Pfeil, Datum, Pfeil in einer Hülle, wie auf der Startseite der Schule.
// Vor #7114 zog die Regel für Menüs hinter einem Textknopf auch die beiden
// Pfeile auf volle Breite; die Seite scrollte bei 320 px waagrecht.
const HEAD_LAYOUT_BEFORE =
  "[&>div[data-icon-only]]:inline-flex max-sm:contents max-sm:[&>*:not([data-icon-only])]:order-last max-sm:[&>*:not([data-icon-only])]:basis-full max-sm:[&>div:not([data-icon-only])>button]:w-full";

const NAV_ITEM =
  "relative z-10 flex min-h-[44px] items-center justify-center gap-2.5 rounded-full px-3 py-2.5";

let compiledCss = "";

test.beforeAll(async () => {
  compiledCss = await compileGlobalsCss();
});

function button(testId: string, width: number): string {
  return `<button data-testid="${testId}" type="button" style="width:${width}px;height:36px;flex:none">x</button>`;
}

/** Kopf einer `SectionCard` mit vier Aktionen, wie in der Bestellung. */
function cardHeader(actionsClass: string): string {
  return `
    <section data-testid="card" class="moto-content-surface overflow-hidden rounded-2xl border p-5 shadow-sm" style="width:720px">
      <div class="flex flex-wrap items-start gap-3">
        <div class="flex min-w-0 flex-1 gap-3">
          <div class="min-w-0">
            <h3 class="text-base font-semibold">Bestellung</h3>
            <p class="mt-1 text-sm">Kinder, die an diesem Tag mitessen.</p>
          </div>
        </div>
        <div class="${actionsClass}">
          ${button("a1", 160)}${button("a2", 176)}${button("a3", 180)}${button("last", 220)}
        </div>
      </div>
    </section>`;
}

/** Kopf von `TenantPage` mit vielen Aktionen, wie in der Anmeldephase. */
function pageHeader(actionsClass: string): string {
  return `
    <header data-testid="head" class="moto-content-surface rounded-2xl border p-5" style="width:728px">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h1 class="min-w-24 text-xl font-semibold">Anmeldung Schuljahr 2026/2027</h1>
        <div class="${actionsClass}">
          ${button("h1", 230)}${button("h2", 200)}${button("h3", 40)}${button("h4", 180)}${button("last", 40)}
        </div>
      </div>
    </header>`;
}

/** Kopf von `TenantPage` mit der Tagesnavigation der Schul-Startseite. */
function dayNavigationHeader(layoutClass: string): string {
  const arrow = (testId: string) =>
    `<button data-testid="${testId}" data-icon-only type="button" class="aspect-square h-8 shrink-0">&gt;</button>`;
  return `
    <header data-testid="head" class="moto-content-surface rounded-2xl border p-4">
      <div class="flex flex-wrap items-start justify-between gap-x-2 gap-y-2">
        <h1 class="min-w-24 text-xl font-semibold">Guten Abend, Lena Weber</h1>
        <div class="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 ${layoutClass}">
          <div class="flex w-full items-center gap-1">
            ${arrow("previous")}
            <div class="min-w-0 flex-1"><input class="w-full" value="15.11.2026"></div>
            ${arrow("last")}
          </div>
        </div>
      </div>
    </header>`;
}

/** Untere Navigation: fünf Reiter, einer aktiv mit Namen, dahinter `Mehr`. */
function bottomNav(fixed: boolean): string {
  const icon = `<span style="width:20px;height:20px;flex:none"></span>`;
  const idle = `${NAV_ITEM} ${fixed ? "shrink-0" : ""}`;
  const active = `${NAV_ITEM} ${fixed ? "min-w-0" : ""}`;
  const label = fixed
    ? "truncate text-sm font-semibold"
    : "text-sm font-semibold whitespace-nowrap";
  const items = `<a class="${idle}" href="#">${icon}</a>`.repeat(4);
  return `
    <div data-testid="nav" class="relative flex items-center justify-around gap-1" style="width:334px">
      ${items}
      <a class="${active}" href="#">${icon}<span class="${label}">Aktivitäten verwalten</span></a>
      <button data-testid="last" type="button" class="${idle}">${icon}</button>
    </div>`;
}

async function overhang(page: Page, frame: string): Promise<number> {
  const right = await page.evaluate(
    (id) =>
      document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
        .right,
    frame,
  );
  const last = await page.getByTestId("last").boundingBox();
  return last!.x + last!.width - right;
}

test("card actions wrap inside the card on a tablet", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await render(page, compiledCss, cardHeader(CARD_ACTIONS_FIXED));

  expect(await overhang(page, "card")).toBeLessThanOrEqual(0);
});

test("without max-w-full the card actions run past the card", async ({
  page,
}) => {
  // Gegenprobe: der Zustand vor #4975.
  await page.setViewportSize({ width: 768, height: 1024 });
  await render(page, compiledCss, cardHeader(CARD_ACTIONS_BEFORE));

  expect(await overhang(page, "card")).toBeGreaterThan(0);
});

test("a long active tab leaves room for Mehr in the bottom navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await render(page, compiledCss, bottomNav(true));

  expect(await overhang(page, "nav")).toBeLessThanOrEqual(0);
});

test("without truncation a long active tab pushes Mehr out", async ({
  page,
}) => {
  // Gegenprobe: der Zustand vor #4975.
  await page.setViewportSize({ width: 390, height: 844 });
  await render(page, compiledCss, bottomNav(false));

  expect(await overhang(page, "nav")).toBeGreaterThan(0);
});

test("page header actions wrap inside the head on a tablet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await render(page, compiledCss, pageHeader(HEAD_ACTIONS_FIXED));

  expect(await overhang(page, "head")).toBeLessThanOrEqual(0);
});

test("without max-w-full the page header actions run past the head", async ({
  page,
}) => {
  // Gegenprobe: der Zustand vor #4975.
  await page.setViewportSize({ width: 768, height: 1024 });
  await render(page, compiledCss, pageHeader(HEAD_ACTIONS_BEFORE));

  expect(await overhang(page, "head")).toBeGreaterThan(0);
});

test("the day arrows keep their size in the page header at 320 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await render(page, compiledCss, dayNavigationHeader(HEAD_ACTIONS_LAYOUT));

  const previous = await page.getByTestId("previous").boundingBox();
  expect(previous!.width).toBeLessThanOrEqual(44);
  expect(await overhang(page, "head")).toBeLessThanOrEqual(0);
});

test("stretched day arrows run past the page header at 320 px", async ({
  page,
}) => {
  // Gegenprobe: der Zustand vor #7114.
  await page.setViewportSize({ width: 320, height: 800 });
  await render(page, compiledCss, dayNavigationHeader(HEAD_LAYOUT_BEFORE));

  expect(await overhang(page, "head")).toBeGreaterThan(0);
});
