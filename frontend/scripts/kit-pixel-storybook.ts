import type { BrowserContext, Page, Route } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { TEST_CLOCK_INSTANT } from "../src/test/clock-instant";
import { selectStories, type SelectedStory } from "./kit-pixel-lib.mjs";

// Storybook-Build für die Playwright-Läufe über die Kit-Stories: der
// Pixel-Vergleich (kit-pixel-stories.pw.ts, #6562) und die Trefferflächen
// (kit-touch-targets.pw.ts, #8060). Start nur über `pnpm run kit-pixel`.

/** Ordner des Storybook-Builds, gesetzt von scripts/kit-pixel.mjs. */
function storybookDir(): string {
  if (!process.env.KIT_PIXEL_STORYBOOK_DIR) {
    throw new Error(
      'KIT_PIXEL_STORYBOOK_DIR fehlt. Mit "pnpm run kit-pixel baseline|compare|touch" starten.',
    );
  }
  return path.resolve(process.env.KIT_PIXEL_STORYBOOK_DIR);
}

/** Stories des Laufs nach `KIT_PIXEL_FILTER` und `KIT_PIXEL_ALL_STORIES`. */
export function kitStories(): SelectedStory[] {
  const stories = selectStories(
    JSON.parse(readFileSync(path.join(storybookDir(), "index.json"), "utf8")),
    {
      filter: process.env.KIT_PIXEL_FILTER || undefined,
      allStories: process.env.KIT_PIXEL_ALL_STORIES === "1",
    },
  );
  if (stories.length === 0) {
    throw new Error(
      `Keine Story ausgewählt (Filter: ${process.env.KIT_PIXEL_FILTER || "–"}).`,
    );
  }
  return stories;
}

/** Erfundene Adresse: Der Build kommt per `route` von der Platte, kein Port, kein Netz. */
const ORIGIN = "http://storybook.kit-pixel.test";

/**
 * Keine Übergänge, jede CSS-Animation sofort im Endzustand, schon vor dem
 * ersten Render. Ein laufender Übergang hebt ein Element auf eine eigene
 * Compositing-Ebene; je nach Zeitpunkt glättet Chrome Kanten dann anders
 * (gemessen: Schließen-X der Modals, Farbwerte ±5 zwischen zwei Läufen).
 * Playwrights `animations: "disabled"` greift erst beim Bild, zu spät dafür.
 */
const FREEZE_MOTION_STYLE = `<style data-kit-pixel>
*, *::before, *::after {
  transition: none !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
}
</style>`;

async function serveStorybook(dir: string, route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) {
    // Alles Fremde (Fonts, Tracking, APIs) bleibt draußen: Bilder hängen nur am Build.
    await route.abort("blockedbyclient");
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const file = path.join(
    dir,
    pathname.endsWith("/") ? `${pathname}index.html` : pathname,
  );
  if (
    !file.startsWith(dir + path.sep) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    await route.fulfill({ status: 404, body: "" });
    return;
  }
  if (pathname === "/iframe.html") {
    const html = readFileSync(file, "utf8");
    await route.fulfill({
      contentType: "text/html",
      body: html.replace("</head>", `${FREEZE_MOTION_STYLE}</head>`),
    });
    return;
  }
  await route.fulfill({ path: file });
}

/** Ergebnis einer Story; `failedReporters`: Prüfungen von Storybook, die fehlschlugen (`a11y`). */
type StoryOutcome = {
  status: string;
  errors: string[];
  failedReporters: string[];
};
type KitPixelWindow = Window & {
  __KIT_PIXEL_OUTCOME__?: Record<string, StoryOutcome>;
};

/**
 * Hört auf Storybooks Kanal, bevor die Vorschau startet. `storyFinished`
 * markiert das Ende von Render, `play` und `afterEach`; Fehler kommen als
 * eigene Ereignisse davor. Die Phase des Renders hilft nicht: Sie steht auch
 * nach einem Fehler in `play` am Ende auf `finished`.
 */
function listenForStoryOutcome(): void {
  const outcomes: Record<string, StoryOutcome> = {};
  const errors: string[] = [];
  (window as KitPixelWindow).__KIT_PIXEL_OUTCOME__ = outcomes;
  type Channel = {
    on: (event: string, listener: (payload: never) => void) => void;
  };
  const listened = new WeakSet<Channel>();
  let current: Channel | undefined;
  Object.defineProperty(globalThis, "__STORYBOOK_ADDONS_CHANNEL__", {
    configurable: true,
    get: () => current,
    set: (next: Channel | undefined) => {
      current = next;
      if (!next || listened.has(next)) return;
      listened.add(next);
      const remember = (payload: { message?: string } | undefined) => {
        errors.push(payload?.message ?? JSON.stringify(payload));
      };
      for (const event of [
        "storyErrored",
        "storyThrewException",
        "playFunctionThrewException",
        "unhandledErrorsWhilePlaying",
        "storyMissing",
      ]) {
        next.on(event, remember);
      }
      next.on(
        "storyFinished",
        (payload: {
          storyId: string;
          status: string;
          reporters?: { type: string; status: string }[];
        }) => {
          outcomes[payload.storyId] = {
            status: payload.status,
            errors: [...errors],
            failedReporters: (payload.reporters ?? [])
              .filter((reporter) => reporter.status === "failed")
              .map((reporter) => reporter.type),
          };
          // Fehler gehören zur eben beendeten Story; die nächste (Wechsel
          // ohne Neuladen) beginnt ohne.
          errors.length = 0;
        },
      );
    },
  });
}

/** Build ausliefern, Story-Ende abhören, Uhr anhalten. Für `test.beforeEach`. */
export async function prepareStorybookPage({
  context,
  page,
}: {
  context: BrowserContext;
  page: Page;
}): Promise<void> {
  const dir = storybookDir();
  await context.route("**/*", (route) => serveStorybook(dir, route));
  await page.addInitScript(listenForStoryOutcome);
  // Wie Vitest (frontend/CLAUDE.md): nur `Date` steht, Timer laufen weiter.
  await page.clock.setFixedTime(TEST_CLOCK_INSTANT);
}

/**
 * Öffnet die Story und wartet, bis Render, `play` und `afterEach` fertig sind
 * und Schriften und Bilder geladen haben. Offene Zustände (Menü, Popover)
 * entstehen in `play` und sind dann sichtbar.
 */
export async function openStory(page: Page, storyId: string): Promise<void> {
  await page.goto(
    `${ORIGIN}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`,
  );
  await waitForStory(page, storyId);
}

/**
 * Wechselt in der geöffneten Vorschau zu einer anderen Story, mit Render und
 * `play`, ohne die Seite neu zu laden (Storybooks `setCurrentStory`, wie die
 * Seitenleiste von Storybook). Storybook hängt die alte Story vorher ab. Das
 * Laden des Builds kostet ein Vielfaches des Renders; für den Pixel-Vergleich
 * bleibt es beim Neuladen je Story. `remount` rendert die aktuelle Story neu
 * (`forceRemount`), etwa nach einem Wechsel der Breite.
 */
export async function switchStory(
  page: Page,
  storyId: string,
  { remount = false }: { remount?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ id, remount }) => {
      const win = window as KitPixelWindow & {
        __STORYBOOK_ADDONS_CHANNEL__?: {
          emit: (event: string, payload: unknown) => void;
        };
      };
      delete win.__KIT_PIXEL_OUTCOME__?.[id];
      // Dieselbe Story noch einmal: `setCurrentStory` täte nichts.
      if (remount) {
        win.__STORYBOOK_ADDONS_CHANNEL__?.emit("forceRemount", { storyId: id });
      } else {
        win.__STORYBOOK_ADDONS_CHANNEL__?.emit("setCurrentStory", {
          storyId: id,
          viewMode: "story",
        });
      }
    },
    { id: storyId, remount },
  );
  await waitForStory(page, storyId);
}

/**
 * Wartet auf `storyFinished` und prüft das Ergebnis. Ein Befund von axe
 * (Storybooks `a11y`-Prüfung) lässt die Story hier nicht scheitern: Beide
 * Läufe messen in Breiten, in denen `pnpm run test:storybook` axe nicht
 * laufen lässt (Telefon im Pixel-Vergleich, iPad bei den Trefferflächen);
 * axe bleibt Sache dieses Tests. Vorher brach der Pixel-Vergleich an
 * `components-ui-datatable--phone-comparison-scroll` ab (axe
 * `scrollable-region-focusable` bei 412 px) und erzeugte keine Baseline.
 */
async function waitForStory(page: Page, storyId: string): Promise<void> {
  const outcome = (await page
    .waitForFunction(
      (id) => (window as KitPixelWindow).__KIT_PIXEL_OUTCOME__?.[id] ?? false,
      storyId,
    )
    .then((handle) => handle.jsonValue())) as StoryOutcome;
  // Ein Fehler in `play` meldet Storybook nur als eigenes Ereignis;
  // `storyFinished` sagt danach trotzdem „success“.
  const onlyA11y =
    outcome.failedReporters.length > 0 &&
    outcome.failedReporters.every((type) => type === "a11y");
  if (
    (outcome.status !== "success" && !onlyA11y) ||
    outcome.errors.length > 0
  ) {
    const failed = outcome.failedReporters.length
      ? ` Fehlgeschlagene Prüfungen: ${outcome.failedReporters.join(", ")}.`
      : "";
    throw new Error(
      `Story ${storyId} ist fehlgeschlagen (storyFinished: ${outcome.status}): ${outcome.errors.join(" | ") || "ohne Meldung"}.${failed}`,
    );
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.complete ? null : image.decode().catch(() => null),
      ),
    );
  });
}
