import { expect, test, type Page } from "@playwright/test";
import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ParentPageHeader,
  ParentPageSkeleton,
} from "../../src/components/parent/parent-page";
import type { TenantPageHeaderSkeleton } from "../../src/components/ui/page-skeletons";
import type { TenantPage } from "../../src/components/ui/tenant-page";
import { compileGlobalsCss, loadSourceModules, render } from "./harness";

// Der Skeleton-Kopf steht während des Ladens dort, wo danach der Kopf von
// `TenantPage` steht (#6568). Ist er niedriger oder höher, springt die Seite
// beim Wechsel. Beide Köpfe kommen aus dem Produktionscode.

// Nur die Typen kommen über `import type`; zur Laufzeit lädt Vite die Module.
type HeadProps = ComponentProps<typeof TenantPage>;
type SkeletonProps = NonNullable<
  ComponentProps<typeof TenantPageHeaderSkeleton>
>;

let compiledCss = "";
let LoadedHead: ComponentType<HeadProps>;
let SkeletonHead: ComponentType<SkeletonProps>;
let ParentSkeleton: ComponentType<ComponentProps<typeof ParentPageSkeleton>>;
let ParentHead: ComponentType<ComponentProps<typeof ParentPageHeader>>;
let IntlProvider: ComponentType<{
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children?: ReactNode;
}>;

// Beide Tests in einem Worker: Er lädt die Quellen nur einmal über Vite.
test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  compiledCss = await compileGlobalsCss();
  await loadSourceModules(async (importSource) => {
    const page = await importSource("/src/components/ui/tenant-page.tsx");
    const skeletons = await importSource(
      "/src/components/ui/page-skeletons.tsx",
    );
    LoadedHead = page.TenantPage as ComponentType<HeadProps>;
    SkeletonHead =
      skeletons.TenantPageHeaderSkeleton as ComponentType<SkeletonProps>;
    const parentPage = await importSource(
      "/src/components/parent/parent-page.tsx",
    );
    ParentSkeleton = parentPage.ParentPageSkeleton as typeof ParentSkeleton;
    ParentHead = parentPage.ParentPageHeader as typeof ParentHead;
    // Über denselben Modulgraphen wie `parent-page.tsx`, sonst fände
    // `useTranslations` den Kontext des Providers nicht.
    const intl = await importSource("next-intl");
    IntlProvider = intl.NextIntlClientProvider as typeof IntlProvider;
  });
});

// Desktop, die Dichte-Stufe `compact` (Tablet) und ein Telefon.
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "compact", width: 900, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

const search = { value: "", onChange: () => undefined, placeholder: "Suchen" };

// `MobilePageHelpPortal` setzt diesen echten Link nach der Registrierung des
// Ziels in beide Kopfvarianten. Der Komponenten-Test prüft die Registrierung
// mit dem auflösbaren Hilfe-Thema; hier messen wir seinen CSS-Vertrag. Die
// Layouttests rendern bewusst statisches Produktionsmarkup, in dem Reacts
// `useEffect` für die Portalregistrierung nicht läuft.
const MOBILE_HELP = `
  <a
    class="inline-flex aspect-square h-8 items-center justify-center shrink-0 lg:hidden"
    data-button-link
    data-icon-only
    aria-label="Hilfe zu dieser Seite"
  >
    <svg class="size-5" aria-hidden="true"></svg>
  </a>`;

const CASES: readonly {
  name: string;
  skeleton: SkeletonProps;
  page: Omit<HeadProps, "title">;
}[] = [
  {
    name: "title and status line",
    skeleton: { stats: true },
    page: { stats: "116 Kinder" },
  },
  { name: "title only", skeleton: { stats: false }, page: {} },
  {
    name: "info button",
    skeleton: { stats: true, info: true },
    page: { stats: "116 Kinder", info: "Erklärung" },
  },
  {
    name: "search row",
    skeleton: { stats: true, controls: true },
    page: { stats: "116 Kinder", search },
  },
];

async function headHeight(
  page: Page,
  markup: string,
  { mobileHelp = false }: { mobileHelp?: boolean } = {},
): Promise<number> {
  await render(page, compiledCss, `<div style="padding:16px">${markup}</div>`);
  if (mobileHelp) {
    const target = page.locator("header .contents").last();
    await target.evaluate((element, help) => {
      element.insertAdjacentHTML("beforeend", help);
    }, MOBILE_HELP);
  }
  const head = await page.locator("header").first().boundingBox();
  if (!head) throw new Error("head is not rendered");
  return head.height;
}

// Ein Test für alle Fälle: Jeder Worker lädt die Quellen einmal über Vite, das
// kostet mehr als alle Messungen zusammen. `expect.soft` meldet trotzdem jeden
// abweichenden Fall einzeln.
test("the skeleton head has the height of the loaded head", async ({
  page,
}) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const testCase of CASES) {
      const skeleton = await headHeight(
        page,
        renderToStaticMarkup(createElement(SkeletonHead, testCase.skeleton)),
      );
      const loaded = await headHeight(
        page,
        renderToStaticMarkup(
          createElement(LoadedHead, { title: "Kinder", ...testCase.page }),
        ),
      );
      expect.soft(skeleton, `${testCase.name}, ${viewport.name}`).toBe(loaded);
    }
  }
});

// Unter `lg` wird die Hilfe aus der persistenten Portalhülle in den Kopf
// gesetzt. Sie ist genau der Fall, wegen dem der Ladekopf seinen Zielplatz
// braucht: ohne den Link stimmt der nackte Kopf, aber nicht der eingeloggte
// mobile Zustand. Desktop lässt den Link mit `lg:hidden` aus und braucht
// deshalb keinen eigenen Vergleich.
test("the skeleton head keeps the portaled mobile help control in place", async ({
  page,
}) => {
  for (const viewport of VIEWPORTS.filter(({ width }) => width < 1024)) {
    await page.setViewportSize(viewport);
    const skeleton = await headHeight(
      page,
      renderToStaticMarkup(createElement(SkeletonHead, { stats: false })),
      { mobileHelp: true },
    );
    const loaded = await headHeight(
      page,
      renderToStaticMarkup(createElement(LoadedHead, { title: "Kinder" })),
      { mobileHelp: true },
    );
    expect.soft(skeleton, viewport.name).toBe(loaded);
  }
});

// Das Elternportal lädt mit seinem eigenen Kopf (`ParentPageHeader`), nicht mit
// dem von `TenantPage`. Sein Ladekopf hat dieselbe Höhe und setzt den
// Titelbalken an die Stelle des Titels (#6613), mit und ohne die Seitenhilfe,
// die die Portalhülle unter `lg` in den Kopf setzt.
function withParentIntl(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      {
        locale: "de",
        timeZone: "Europe/Berlin",
        messages: { parentNav: { sectionLoading: "Inhalt wird geladen" } },
      },
      element,
    ),
  );
}

async function titleBox(page: Page, selector: string) {
  const header = await page.locator("header").first().boundingBox();
  const title = await page.locator(`header ${selector}`).first().boundingBox();
  if (!header || !title) throw new Error("head or title is not rendered");
  return {
    height: header.height,
    titleTop: title.y - header.y,
    titleLeft: title.x - header.x,
  };
}

test("the parents portal loading head matches ParentPageHeader", async ({
  page,
}) => {
  const skeletonMarkup = withParentIntl(
    createElement(ParentSkeleton, { rows: 1 }),
  );
  const loadedMarkup = withParentIntl(
    createElement(ParentHead, { title: "Kinder" }),
  );
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const mobileHelp of viewport.width < 1024 ? [false, true] : [false]) {
      const name = `${viewport.name}${mobileHelp ? ", mobile help" : ""}`;
      await headHeight(page, skeletonMarkup, { mobileHelp });
      const skeleton = await titleBox(page, ".h-lh");
      await headHeight(page, loadedMarkup, { mobileHelp });
      const loaded = await titleBox(page, "h1");
      expect.soft(skeleton, name).toEqual(loaded);
      // Kein Statusbalken: Der Elternkopf hat keine Statuszeile.
      await headHeight(page, skeletonMarkup, { mobileHelp });
      await expect
        .soft(page.locator("header .animate-pulse"), name)
        .toHaveCount(1);
    }
  }
});
