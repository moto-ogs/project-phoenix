import { expect, test, type Page } from "@playwright/test";
import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SelectionBar } from "../../src/components/ui/selection-bar";
import { box, compileGlobalsCss, loadSourceModules, render } from "./harness";

// Ein offenes Auswahlfeld hebt seine Fläche über die nächste
// (`.moto-content-surface:has([aria-expanded="true"])`). Die Regel darf dabei
// die Position der Fläche nicht ersetzen: Die klebende Auswahlleiste über den
// Kinderkacheln wurde beim Öffnen von „Anmelden in“ `relative`, ihr `top-2`
// schob sie 8 px nach unten, und sie klebte nicht mehr. Die Leiste kommt aus
// dem Produktionscode, das Auswahlfeld ist ein Knopf mit `aria-expanded`.

type BarProps = ComponentProps<typeof SelectionBar>;

let compiledCss = "";
let Bar: ComponentType<BarProps>;

test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  compiledCss = await compileGlobalsCss();
  await loadSourceModules(async (importSource) => {
    const source = await importSource("/src/components/ui/selection-bar.tsx");
    Bar = source.SelectionBar as ComponentType<BarProps>;
  });
});

function pageWithBar(): string {
  const bar = renderToStaticMarkup(
    createElement(
      Bar,
      { count: 0, "aria-label": "Auswahl", "data-testid": "bar" } as BarProps,
      createElement(
        "button",
        {
          type: "button",
          role: "combobox",
          "aria-expanded": false,
          "data-testid": "select",
        },
        "Schulhof",
      ),
    ),
  );
  return `
    <div style="width:900px">
      <div data-testid="above" style="height:120px"></div>
      ${bar}
      <div data-testid="below" class="moto-content-surface rounded-2xl border" style="height:2000px"></div>
    </div>`;
}

async function setOpen(page: Page, open: boolean): Promise<void> {
  await page
    .getByTestId("select")
    .evaluate(
      (el, value) => el.setAttribute("aria-expanded", String(value)),
      open,
    );
}

test("an open select does not move its sticky bar", async ({ page }) => {
  await render(page, compiledCss, pageWithBar());
  const closed = await box(page, "bar");

  await setOpen(page, true);
  const open = await box(page, "bar");

  expect(open.y).toBe(closed.y);
  expect(open.height).toBe(closed.height);
  expect((await box(page, "below")).y).toBe(open.y + open.height + 12);
});

test("the bar keeps sticking while its select is open", async ({ page }) => {
  await render(page, compiledCss, pageWithBar());
  await setOpen(page, true);
  await page.evaluate(() => window.scrollTo(0, 600));

  // `top-2`: 8 px unter der Oberkante.
  expect((await box(page, "bar")).y).toBe(8);
});

test("an open select still lifts its surface above the next one", async ({
  page,
}) => {
  await render(page, compiledCss, pageWithBar());
  await setOpen(page, true);

  const lift = (testId: string) =>
    page.getByTestId(testId).evaluate((el) => {
      const style = getComputedStyle(el);
      return { position: style.position, zIndex: style.zIndex };
    });
  expect(await lift("bar")).toEqual({ position: "sticky", zIndex: "60" });

  // Eine Fläche ohne eigene Position bekommt weiter `relative`, sonst griffe
  // ihr `z-index` nicht.
  await page
    .getByTestId("below")
    .evaluate((el) =>
      el.insertAdjacentHTML(
        "beforeend",
        '<button type="button" aria-expanded="true">Offen</button>',
      ),
    );
  expect(await lift("below")).toEqual({ position: "relative", zIndex: "60" });
});
