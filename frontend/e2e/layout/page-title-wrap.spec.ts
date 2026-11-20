import { expect, test, type Page } from "@playwright/test";
import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StatusBadge } from "../../src/components/ui/status-badge";
import type { TenantPage } from "../../src/components/ui/tenant-page";
import { compileGlobalsCss, loadSourceModules, render } from "./harness";

// Ein langer Seitentitel neben dem Info-Knopf brach auf dem Handy mitten im
// Wort um („Anmel-dung“ ohne Trennstrich), weil Hilfe, Status und Kebab dem
// Titelblock nur seine Mindestbreite ließen (#7649). Ein kurzes Wort bleibt
// ganz; nur Wörter ab 14 Zeichen dürfen nach Silben trennen (#7417).

type HeadProps = ComponentProps<typeof TenantPage>;

let compiledCss = "";
let Head: ComponentType<HeadProps>;
let Badge: ComponentType<ComponentProps<typeof StatusBadge>>;

test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  compiledCss = await compileGlobalsCss();
  await loadSourceModules(async (importSource) => {
    const page = await importSource("/src/components/ui/tenant-page.tsx");
    const badge = await importSource("/src/components/ui/status-badge.tsx");
    Head = page.TenantPage as typeof Head;
    Badge = badge.StatusBadge as typeof Badge;
  });
});

// Das „?“ der Seitenhilfe setzt die Portalhülle unter lg per Portal ein; im
// statischen Markup läuft kein Effekt, also steht es hier von Hand
// (wie in page-header-skeleton.spec.ts).
const MOBILE_HELP = `
  <a
    class="inline-flex aspect-square h-8 items-center justify-center shrink-0 lg:hidden"
    data-button-link
    data-icon-only
    aria-label="Hilfe zu dieser Seite"
  >
    <svg class="size-5" aria-hidden="true"></svg>
  </a>`;

const menu = [
  { label: "Herunterladen", onClick: () => undefined, noDescription: "Test" },
];

function cases(): readonly { name: string; props: HeadProps }[] {
  return [
    {
      // Träger-Ferienanmeldung: Status und Kebab neben dem Titel.
      name: "Träger-Ferienanmeldung",
      props: {
        // Symbolkachel wie `ConceptIconTile size="page"`.
        leading: createElement("div", {
          style: { width: 44, height: 44, flex: "none" },
        }),
        title: "Anmeldung von Lena Frühauf",
        info: "Erklärung",
        stats: "Ferienbetreuung Winterferien 2027",
        actions: createElement(Badge, { tone: "blue", label: "Eingegangen" }),
        overflowMenu: menu,
      },
    },
    {
      name: "lange OGS-Detailseite",
      props: {
        title: "Hausaufgabenbetreuung für die Klasse 3b",
        info: "Erklärung",
        stats: "24 Kinder",
        actions: createElement(Badge, { tone: "green", label: "Aktiv" }),
        overflowMenu: menu,
      },
    },
    {
      // Ein Wort, breiter als der Kopf: Es trennt nach Silben, statt die
      // Seite seitlich scrollen zu lassen.
      name: "sehr langes Einzelwort",
      props: {
        title: "Nachmittagsbetreuungsvereinbarungen",
        info: "Erklärung",
        actions: createElement(Badge, { tone: "blue", label: "Entwurf" }),
        overflowMenu: menu,
      },
    },
    {
      // Importierte IDs und URLs haben keine deutsche Trennstelle. Sie dürfen
      // den mobilen Kopf trotzdem nicht verbreitern.
      name: "untrennbarer Titel",
      props: {
        title: "device://A8GZQX0B7F3M9K2R5V1N6C4D",
        info: "Erklärung",
        actions: createElement(Badge, { tone: "blue", label: "Entwurf" }),
        overflowMenu: menu,
      },
    },
    {
      // Das Emoji fällt bei UTF-16-Zählung genau auf die frühere 13er-Grenze.
      // Die Notbremse darf es nicht in seine beiden Surrogate teilen.
      name: "untrennbarer Titel mit Emoji",
      props: {
        title: "device://A8G😀ZQX0B7F3M9K2R5V1N6C4D",
        info: "Erklärung",
        actions: createElement(Badge, { tone: "blue", label: "Entwurf" }),
        overflowMenu: menu,
      },
    },
    {
      // `stats` ist ein beliebiger ReactNode. Auch ein Knoten, der selbst
      // nicht umbrechen darf, darf die Breite des Titelblocks nicht setzen.
      name: "untrennbarer Status",
      props: {
        title: "Anmeldung",
        info: "Erklärung",
        stats: createElement(
          "span",
          { className: "whitespace-nowrap" },
          "https://example.invalid/status/A8GZQX0B7F3M9K2R5V1N6C4D",
        ),
        actions: createElement(Badge, { tone: "blue", label: "Entwurf" }),
        overflowMenu: menu,
      },
    },
  ];
}

async function renderHead(page: Page, props: HeadProps): Promise<void> {
  const markup = renderToStaticMarkup(createElement(Head, props));
  // `lang="de"` wie im Portal: ohne Sprache trennt der Browser nicht.
  await render(
    page,
    compiledCss,
    `<div lang="de" style="padding:16px">${markup}</div>`,
  );
  await page
    .locator("header .contents")
    .first()
    .evaluate((element, help) => {
      element.insertAdjacentHTML("beforeend", help);
    }, MOBILE_HELP);
}

/** Wörter des Titels, die über mehr als eine Zeile laufen. */
async function brokenWords(page: Page): Promise<string[]> {
  return page.locator("h1").evaluate((h1) => {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }
    const text = textNodes.map((node) => node.data).join("");
    const pointAt = (offset: number) => {
      let remaining = offset;
      for (const node of textNodes) {
        if (remaining <= node.length) return [node, remaining] as const;
        remaining -= node.length;
      }
      throw new Error("title range is outside its text nodes");
    };
    const broken: string[] = [];
    for (const match of text.matchAll(/\S+/g)) {
      if (match.index === undefined) continue;
      const range = document.createRange();
      const [startNode, startOffset] = pointAt(match.index);
      const [endNode, endOffset] = pointAt(match.index + match[0].length);
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const tops = new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      );
      if (tops.size > 1) broken.push(match[0]);
    }
    return broken;
  });
}

async function hasSplitSurrogate(page: Page): Promise<boolean> {
  return page.locator("h1").evaluate((h1) =>
    [...h1.querySelectorAll("wbr")].some((wbr) => {
      const before = wbr.previousSibling?.textContent ?? "";
      const after = wbr.nextSibling?.textContent ?? "";
      const beforeCode = before.charCodeAt(before.length - 1);
      const afterCode = after.charCodeAt(0);
      return (
        beforeCode >= 0xd800 &&
        beforeCode <= 0xdbff &&
        afterCode >= 0xdc00 &&
        afterCode <= 0xdfff
      );
    }),
  );
}

test("a long title next to the info button keeps short words whole on a phone", async ({
  page,
}) => {
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const testCase of cases()) {
      await renderHead(page, testCase.props);
      const label = `${testCase.name}, ${width} px`;

      const shortBroken = (await brokenWords(page)).filter(
        (word) => word.length < 14,
      );
      expect.soft(shortBroken, label).toEqual([]);

      if (testCase.name === "sehr langes Einzelwort") {
        expect.soft(await page.locator("h1 wbr").count(), label).toBe(0);
        if (width === 320) {
          expect
            .soft(await brokenWords(page), label)
            .toContain("Nachmittagsbetreuungsvereinbarungen");
        }
      }
      if (testCase.name === "untrennbarer Titel mit Emoji") {
        expect
          .soft(await page.locator("h1 wbr").count(), label)
          .toBeGreaterThan(0);
        expect.soft(await hasSplitSurrogate(page), label).toBe(false);
      }

      // Der Info-Knopf steht direkt hinter dem Titel, auf seiner Höhe.
      const title = await page.locator("h1").boundingBox();
      const info = await page
        .getByRole("button", { name: /^Erklärung zu / })
        .boundingBox();
      if (!title || !info) throw new Error("title or info is not rendered");
      expect.soft(info.x, label).toBeGreaterThanOrEqual(title.x + title.width);
      expect.soft(info.x - (title.x + title.width), label).toBeLessThan(12);
      expect.soft(info.y + info.height / 2, label).toBeGreaterThan(title.y);
      expect
        .soft(info.y + info.height / 2, label)
        .toBeLessThan(title.y + title.height);

      // Kein seitliches Scrollen.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect.soft(overflow, label).toBeLessThanOrEqual(0);

      // Rückt der Kebab in eine eigene Zeile, steht er rechts, nicht
      // verloren am linken Rand.
      const edges = await page.evaluate(() => {
        const row = document.querySelector("header > .flex.flex-wrap");
        const kebab = [...document.querySelectorAll("header [data-icon-only]")]
          .filter(
            (element) =>
              element.getAttribute("aria-label") !== "Hilfe zu dieser Seite",
          )
          .at(-1);
        if (!row || !kebab) throw new Error("head row or menu is missing");
        return {
          row: row.getBoundingClientRect().right,
          kebab: kebab.getBoundingClientRect().right,
        };
      });
      expect.soft(Math.abs(edges.row - edges.kebab), label).toBeLessThan(1);
    }
  }
});

test("the desktop head keeps the title, status and menu in one row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const testCase of cases()) {
    await renderHead(page, testCase.props);
    const title = await page.locator("h1").boundingBox();
    const menuButton = await page
      .locator("header [data-icon-only]")
      .last()
      .boundingBox();
    if (!title || !menuButton) throw new Error("head is not rendered");
    expect.soft(await brokenWords(page), testCase.name).toEqual([]);
    expect.soft(title.height, testCase.name).toBeLessThan(40);
    expect.soft(menuButton.y, testCase.name).toBeLessThan(title.y + 20);
  }
});
