import { expect, test, type Page } from "@playwright/test";
import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HomeBoard as HomeBoardType } from "../../src/components/home/home-board";
import type {
  HomeCard as HomeCardType,
  HomeCardEmpty as HomeCardEmptyType,
} from "../../src/components/home/home-card";
import type {
  HomeBlockKey,
  HomeBlockPlacement,
} from "../../src/lib/home-blocks";
import { box, compileGlobalsCss, loadSourceModules, render } from "./harness";

// Das Brett der Startseite im Browser: Karten mit Inhalt stehen auf dem
// 7rem-Raster, eine Karte, die nur ihren Leertext zeigt, belegt so viel Höhe
// wie dieser Text. Vorher blieb sie zwei oder drei Rasterzeilen hoch und ließ
// unter einer Zeile Text ein weißes Loch. Brett und Karte kommen aus dem
// Produktionscode; jsdom rechnet weder Raster noch `:has()`.

const ROW = 112; // 7rem
const GAP = 16;

let compiledCss = "";
let HomeBoard: ComponentType<ComponentProps<typeof HomeBoardType>>;
let HomeCard: ComponentType<ComponentProps<typeof HomeCardType>>;
let HomeCardEmpty: ComponentType<ComponentProps<typeof HomeCardEmptyType>>;

// Alle Tests in einem Worker: er lädt die Quellen nur einmal über Vite.
test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  compiledCss = await compileGlobalsCss();
  await loadSourceModules(async (importSource) => {
    const board = await importSource("/src/components/home/home-board.tsx");
    const card = await importSource("/src/components/home/home-card.tsx");
    HomeBoard = board.HomeBoard as typeof HomeBoard;
    HomeCard = card.HomeCard as typeof HomeCard;
    HomeCardEmpty = card.HomeCardEmpty as typeof HomeCardEmpty;
  });
});

const MY_DAY = "section.my_day"; // drei Rasterzeilen
const BIRTHDAYS = "section.birthdays"; // drei Rasterzeilen
const NOTICES = "section.staff_notices"; // zwei Rasterzeilen
const PRESENT = "tile.students_present"; // eine Rasterzeile

function board(
  placements: readonly HomeBlockPlacement[],
  emptyKeys: readonly string[],
): string {
  const noop = () => undefined;
  // Das Brett nimmt seine Karten als Funktion je Platz entgegen.
  const props: ComponentProps<typeof HomeBoardType> = {
    placements,
    addable: [],
    requiredKeys: new Set<HomeBlockKey>(),
    editing: false,
    onMove: noop,
    onMoveBy: noop,
    onSpanChange: noop,
    onRemove: noop,
    onAdd: noop,
    onRestoreDefault: noop,
    restoring: false,
    children: (placement: HomeBlockPlacement): ReactNode =>
      createElement(
        HomeCard,
        { title: placement.key },
        emptyKeys.includes(placement.key)
          ? createElement(HomeCardEmpty, {
              title: "Heute sind Sie für keinen Block eingeteilt",
              description:
                "Ihre Einsätze aus dem Betreuungsplan erscheinen hier.",
            })
          : createElement("p", null, "Inhalt"),
      ),
  };
  return renderToStaticMarkup(createElement(HomeBoard, props));
}

async function show(page: Page, width: number, markup: string): Promise<void> {
  await page.setViewportSize({ width, height: 1000 });
  await render(page, compiledCss, `<div style="padding:24px">${markup}</div>`);
}

/** Die sichtbare Karte einer Zelle, ohne den Abstand der Zelle darunter. */
async function card(page: Page, key: string) {
  const rect = await page
    .getByTestId(`home-block-${key}`)
    .locator("section")
    .first()
    .boundingBox();
  if (!rect) throw new Error(`${key} is not rendered`);
  return rect;
}

const rows = (count: number) => count * ROW + (count - 1) * GAP;

test("cards with content keep the fixed 7rem lattice", async ({ page }) => {
  await show(
    page,
    1440,
    board(
      [
        { key: MY_DAY, span: 4, col: 0, row: 0 },
        { key: NOTICES, span: 2, col: 0, row: 3 },
        { key: PRESENT, span: 1, col: 2, row: 3 },
      ],
      [],
    ),
  );

  const myDay = await card(page, MY_DAY);
  const notices = await card(page, NOTICES);
  const present = await card(page, PRESENT);
  expect(myDay.height).toBeCloseTo(rows(3), 0);
  expect(notices.height).toBeCloseTo(rows(2), 0);
  expect(present.height).toBeCloseTo(rows(1), 0);
  expect(notices.y - (myDay.y + myDay.height)).toBeCloseTo(GAP, 0);
  expect(present.y).toBeCloseTo(notices.y, 0);
});

test("an empty card alone in its rows is as tall as its text", async ({
  page,
}) => {
  await show(
    page,
    1440,
    board(
      [
        { key: MY_DAY, span: 4, col: 0, row: 0 },
        { key: BIRTHDAYS, span: 4, col: 0, row: 3 },
        { key: NOTICES, span: 2, col: 0, row: 6 },
      ],
      [MY_DAY, BIRTHDAYS],
    ),
  );

  const myDay = await card(page, MY_DAY);
  const birthdays = await card(page, BIRTHDAYS);
  const notices = await card(page, NOTICES);
  // Kopf, Titel und ein Satz: deutlich unter zwei Rasterzeilen.
  expect(myDay.height).toBeLessThan(rows(2));
  expect(myDay.height).toBeGreaterThan(ROW);
  // Was darunter steht, rückt mit dem üblichen Abstand nach.
  expect(birthdays.y - (myDay.y + myDay.height)).toBeCloseTo(GAP, 0);
  expect(notices.y - (birthdays.y + birthdays.height)).toBeCloseTo(GAP, 0);
  // Die Karte mit Inhalt behält ihre zwei Zeilen.
  expect(notices.height).toBeCloseTo(rows(2), 0);
});

test("an empty card beside a filled one keeps its height and centres its text", async ({
  page,
}) => {
  await show(
    page,
    1440,
    board(
      [
        { key: MY_DAY, span: 2, col: 0, row: 0 },
        { key: BIRTHDAYS, span: 2, col: 2, row: 0 },
      ],
      [MY_DAY],
    ),
  );

  const empty = await card(page, MY_DAY);
  const filled = await card(page, BIRTHDAYS);
  expect(filled.height).toBeCloseTo(rows(3), 0);
  expect(empty.height).toBeCloseTo(filled.height, 0);
  expect(empty.y).toBeCloseTo(filled.y, 0);

  // Der Leertext steht in der Mitte der Fläche unter dem Kartenkopf.
  const heading = await page
    .getByTestId(`home-block-${MY_DAY}`)
    .getByRole("heading")
    .boundingBox();
  const text = await page
    .getByTestId(`home-block-${MY_DAY}`)
    .locator("[data-home-card-empty]")
    .boundingBox();
  if (!heading || !text) throw new Error("empty card is not rendered");
  const above = text.y - (heading.y + heading.height);
  const below = empty.y + empty.height - (text.y + text.height);
  expect(above).toBeGreaterThan(40);
  expect(Math.abs(above - below)).toBeLessThan(40);
});

test("a row the person left free keeps its height", async ({ page }) => {
  await show(
    page,
    1440,
    board(
      [
        { key: PRESENT, span: 1, col: 0, row: 0 },
        { key: NOTICES, span: 2, col: 0, row: 2 },
      ],
      [],
    ),
  );

  const present = await card(page, PRESENT);
  const notices = await card(page, NOTICES);
  expect(notices.y - present.y).toBeCloseTo(2 * (ROW + GAP), 0);
});

test("on a phone every card is as tall as its content", async ({ page }) => {
  await show(
    page,
    390,
    board(
      [
        { key: MY_DAY, span: 4, col: 0, row: 0 },
        { key: NOTICES, span: 2, col: 0, row: 3 },
      ],
      [MY_DAY],
    ),
  );

  const myDay = await card(page, MY_DAY);
  const notices = await card(page, NOTICES);
  expect(notices.height).toBeLessThan(rows(2));
  expect(notices.y - (myDay.y + myDay.height)).toBeCloseTo(GAP, 0);
  const boardBox = await box(page, "home-board");
  expect(boardBox.width).toBeLessThanOrEqual(390);
});
