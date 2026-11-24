import type { BrowserContext, Page, Route } from "@playwright/test";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

/** Datei des Builds zu einem Pfad, `null` außerhalb des Builds oder wenn sie fehlt. */
function buildFile(dir: string, pathname: string): string | null {
  const file = path.join(
    dir,
    pathname.endsWith("/") ? `${pathname}index.html` : pathname,
  );
  if (
    !file.startsWith(dir + path.sep) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    return null;
  }
  return file;
}

async function serveStorybook(dir: string, route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) {
    // Alles Fremde (Fonts, Tracking, APIs) bleibt draußen: Bilder hängen nur am Build.
    await route.abort("blockedbyclient");
    return;
  }
  const pathname = decodeURIComponent(url.pathname);
  const file = buildFile(dir, pathname);
  if (!file) {
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

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/**
 * Liefert den Build über einen eigenen HTTP-Server auf 127.0.0.1 mit freiem
 * Port aus, ohne Playwrights `route`: Routing schaltet den HTTP-Cache ab,
 * und jede Datei lief einzeln durch das Protokoll (gemessen 870 ms je
 * Story gegen 50–190 ms hier). So lädt jede Story eine frische Seite, ohne
 * dass Zustand einer Story in die nächste reicht (#8060: Story-Wechsel ohne
 * Neuladen verschob Spaltenbreiten im `DateRangePicker`). Der Server gehört
 * dem Worker; `close` beendet ihn.
 */
export async function startStorybookServer(): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const dir = storybookDir();
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://127.0.0.1").pathname,
    );
    const file = buildFile(dir, pathname);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "max-age=3600",
    });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Wie `prepareStorybookPage`, für den eigenen Server: Bewegung anhalten,
 * Story-Ende abhören, Uhr anhalten. Eine Anfrage an eine andere Adresse
 * lässt den Lauf scheitern, statt still ins Netz zu gehen. `settle` wartet
 * nach `openStory`, bis nachgeladene Teile da sind (siehe dort).
 */
export async function prepareServedStorybookPage(
  page: Page,
  origin: string,
): Promise<{ externalRequests: string[]; settle: () => Promise<void> }> {
  const externalRequests: string[] = [];
  let inFlight = 0;
  let started = 0;
  page.on("request", (request) => {
    inFlight++;
    started++;
    const url = request.url();
    if (
      !url.startsWith(`${origin}/`) &&
      !url.startsWith("data:") &&
      !url.startsWith("blob:")
    ) {
      externalRequests.push(url);
    }
  });
  const done = () => {
    inFlight = Math.max(0, inFlight - 1);
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  await page.addInitScript((style) => {
    const install = () =>
      document.documentElement.insertAdjacentHTML("beforeend", style);
    if (document.documentElement) install();
    else document.addEventListener("readystatechange", install, { once: true });
  }, FREEZE_MOTION_STYLE);
  await page.addInitScript(listenForStoryOutcome);
  // Zählt `resize` nach der ersten Eingabe von `play` (Klick, Taste): Er
  // schließt, was `play` geöffnet hat. Ein `resize` beim Laden der Seite
  // (fast immer, Chromes Mobil-Ansicht) zählt nicht.
  await page.addInitScript(() => {
    const win = window as Window & { __KIT_RESIZES__?: number };
    win.__KIT_RESIZES__ = 0;
    let played = false;
    const markPlayed = () => {
      played = true;
    };
    window.addEventListener("pointerdown", markPlayed, true);
    window.addEventListener("keydown", markPlayed, true);
    window.addEventListener("resize", () => {
      if (played) win.__KIT_RESIZES__ = (win.__KIT_RESIZES__ ?? 0) + 1;
    });
  });
  await page.clock.setFixedTime(TEST_CLOCK_INSTANT);

  /**
   * `storyFinished` kommt vor nachgeladenen Teilen: Der Kalender des
   * `DateRangePicker` (`lazy-day-picker`) war beim Messen oft noch nicht
   * da und unter Last schon, das Ergebnis hing an der Zeit (#8060). React
   * zeigt aufgelöste Suspense-Inhalte bis zu 300 ms verzögert; so lange
   * steht das Layout still, obwohl der Kalender noch fehlt. Wartet deshalb,
   * bis keine Anfrage mehr läuft, kein Platzhalter eines nachgeladenen
   * Kit-Teils (`LAZY_FALLBACKS`) mehr steht und die Bedienelemente ruhig
   * an derselben Stelle stehen, ohne dass eine neue Anfrage begann.
   */
  const settle = async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      // `inFlight` ändern die Ereignisse der Seite, nicht diese Schleife.
      const busy = () => inFlight > 0;
      while (busy() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const before = started;
      await page
        .waitForFunction(
          (selector) => !document.querySelector(selector),
          LAZY_FALLBACKS,
          { timeout: Math.max(1, deadline - Date.now()) },
        )
        .catch(() => undefined);
      await waitForStableLayout(page);
      if (inFlight === 0 && started === before) return;
    }
    throw new Error(
      "Story kommt nicht zur Ruhe: Anfragen, Platzhalter oder Layout ändern sich nach 10 s noch.",
    );
  };
  return { externalRequests, settle };
}

/**
 * Platzhalter nachgeladener Kit-Teile. Heute nur der Kalender
 * (`DayPickerSkeleton` in `lazy-day-picker.tsx`); ein neuer nachgeladener
 * Teil trägt ein eigenes Kennzeichen und gehört hierher.
 */
const LAZY_FALLBACKS = "[data-day-picker-skeleton]";

/** Bedienelemente stehen drei Frames und 100 ms an derselben Stelle (höchstens 3 s). */
async function waitForStableLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const snapshot = () =>
      Array.from(
        document.querySelectorAll("button, a[href], input, label, [role]"),
        (el) => {
          const r = el.getBoundingClientRect();
          return `${r.x},${r.y},${r.width},${r.height}`;
        },
      ).join(";");
    // Mindestens drei Frames und 100 ms ohne Bewegung: Ein Popover setzt
    // seine Lage asynchron (Floating UI); unter Last (24 Worker auf 12
    // Kernen) kam das nach zwei ruhigen Frames.
    let previous = snapshot();
    let frames = 0;
    let since = performance.now();
    const deadline = since + 3000;
    while (
      (frames < 3 || performance.now() - since < 100) &&
      performance.now() < deadline
    ) {
      await frame();
      const current = snapshot();
      if (current === previous) frames++;
      else {
        frames = 0;
        since = performance.now();
        previous = current;
      }
    }
  });
}

/**
 * Öffnet die Story und wartet, bis Render, `play` und `afterEach` fertig sind
 * und Schriften und Bilder geladen haben. Offene Zustände (Menü, Popover)
 * entstehen in `play` und sind dann sichtbar.
 */
export async function openStory(
  page: Page,
  storyId: string,
  origin: string = ORIGIN,
): Promise<void> {
  await page.goto(
    `${origin}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`,
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
