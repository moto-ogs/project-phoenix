import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  dismissNotificationHint,
  gotoTolerant,
  loadAccess,
  login,
  tenantBaseUrl,
} from "./access";
import {
  OUT_DIR,
  REPEATS,
  CPU_THROTTLE,
  NETWORK,
  QUIET,
  armProbe,
  readProbe,
  requestCost,
  median,
  type RequestCost,
} from "./navigation-probe";
import { measureRevisits } from "./revisit";
import { revisitFixture } from "./revisit-access";
import { installContentProbe } from "./revisit-content";
import { revisitTargets } from "./revisit-targets";
import { RequestRecorder } from "./recorder";
import {
  INTENT_HOPS,
  NAVIGATION_HOPS,
  type IntentHop,
  type NavigationHop,
} from "./targets";

// Seitenwechsel-Messung (#2828). Der kalte Aufruf ist in measure.perf.ts
// gemessen; hier geht es um das, was eine Betreuungskraft den ganzen Tag tut:
// in der Seitenleiste auf die nächste Seite klicken.
//
// Was pro Wechsel festgehalten wird und warum:
//   documents       — ein Dokument-Request wäre ein echter Neuaufbau der
//                     Seite. Muss 0 sein, sonst ist es ein Full-Reload.
//   rsc             — die RSC-Nutzlast des Zielsegments (`?_rsc=`).
//   api             — Seitendaten. Die Hülle darf hier nicht auftauchen.
//   shellApi        — Aufrufe der Hüllen-Endpunkte. Bis auf die bewusst beim
//                     Seitenwechsel erneuerten Ankündigungen und das beim
//                     ersten Öffnen von Einstellungen geladene Schema muss
//                     die Liste leer sein (#2973).
//   shellSurvived   — die Hülle wurde vor dem Klick markiert; ist die Marke
//                     danach weg, hat React sie neu aufgebaut.
//   fallbacks       — welche Ladehüllen zwischendurch sichtbar waren.
//   toContentMs     — Klick bis der Zielinhalt steht.

const access = loadAccess();
const base = tenantBaseUrl(access);

/** Endpunkte, die die Hülle beim vollen Seitenaufruf einmal lädt (#2973). */
const SHELL_ENDPOINTS = [
  "/api/me/profile",
  "/api/me/navigation",
  "/api/settings/schema",
  "/api/reminders",
  "/api/platform/announcements/unread",
  "/api/messages/unread-count",
  "/api/staff-messages/unread-count",
  "/api/staff-notices/today",
  "/api/staff/absences/pending",
  "/api/students/change-requests/pending-count",
  "/api/enrollment/admin/change-requests/pending-count",
  "/api/students/care-withdrawals",
  "/api/groups/context",
  "/api/active/supervisors/all",
  "/api/active/schulhof/status",
  "/api/auth/account-tenants",
  "/api/auth/session",
];
const ALLOWED_NAVIGATION_SHELL_ENDPOINTS = new Set([
  // Eine neue Ankündigung erscheint bewusst beim Seitenwechsel statt mitten
  // in einer Eingabe. Das Schema wird beim ersten Öffnen von Einstellungen
  // nachgeladen und danach im Cache gehalten.
  "/api/platform/announcements/unread",
  "/api/settings/schema",
]);

interface HopResult {
  from: string;
  to: string;
  label: string;
  toContentMs: number;
  settleMs: number;
  shellSurvived: boolean;
  mountedLoading: boolean;
  documents: number;
  rsc: number;
  api: number;
  shellApi: string[];
  fallbacks: string[];
  paths: string[];
}

function expectNavigationInvariants(result: HopResult): void {
  const transition = `${result.from} → ${result.to}`;
  expect(result.documents, `${transition}: kein Dokument-Reload`).toBe(0);
  expect(
    result.shellSurvived,
    `${transition}: Portalhülle bleibt erhalten`,
  ).toBe(true);
  expect(
    result.shellApi.filter(
      (endpoint) => !ALLOWED_NAVIGATION_SHELL_ENDPOINTS.has(endpoint),
    ),
    `${transition}: keine wiederholten Hüllen-Endpunkte`,
  ).toEqual([]);
  expect(
    result.mountedLoading,
    `${transition}: kein allgemeiner Ladeplatzhalter`,
  ).toBe(false);
}

/** „3x /api/…“ je Pfad, absteigend — die Rohliste eines Wechsels. */
function countByPath(records: readonly { path: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const path = record.path.replace(/\?.*$/, "");
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path, count]) => `${count}x ${path}`);
}

/** Der Seitenleisten-Link; liegt er in einer zugeklappten Gruppe, aufklappen. */
async function sidebarLink(page: Page, hop: NavigationHop) {
  if (hop.group) {
    // Ein zugeklappter Bereich behält seine Links im DOM. Sie gelten als
    // sichtbar, den Klick fängt aber der Bereichskopf ab.
    const group = page
      .getByRole("button", { name: hop.group, exact: true })
      .first();
    if ((await group.getAttribute("aria-expanded")) === "false") {
      await group.click();
    }
  }
  const sidebar = page.locator("nav").filter({ has: page.getByRole("link") });
  const link = page
    .getByRole("link", { name: hop.linkName, exact: true })
    .filter({ visible: true })
    .first();
  if (await link.count()) return link;
  return sidebar.getByRole("link", { name: hop.linkName }).first();
}

async function measureHop(
  page: Page,
  recorder: RequestRecorder,
  from: string,
  hop: NavigationHop,
): Promise<HopResult> {
  const link = await sidebarLink(page, hop);
  await expect(link).toBeVisible({ timeout: 15_000 });

  await armProbe(page);
  recorder.start();
  const started = performance.now();
  // Mit Frist: ein verdeckter Link soll scheitern, nicht den Lauf anhalten.
  await link.click({ timeout: 15_000 });
  // PERF_NAV_SCREENSHOTS=1 hält den Moment kurz nach dem Klick fest — dort
  // ist zu sehen, was während des Wechsels auf dem Schirm steht.
  if (process.env.PERF_NAV_SCREENSHOTS === "1") {
    // 250 ms: der Balken blendet sich nach 150 ms ein, vorher ist absichtlich
    // nichts zu sehen.
    await page.waitForTimeout(250);
    await page.screenshot({
      path: join(
        OUT_DIR,
        `waehrend-wechsel${hop.path.replaceAll("/", "-")}.png`,
      ),
    });
  }
  await expect(hop.ready(page)).toBeVisible({ timeout: 30_000 });
  const toContentMs = performance.now() - started;
  await recorder.waitForQuiet(QUIET);
  const settleMs = performance.now() - started;
  const probe = await readProbe(page);

  const records = recorder.records.filter((record) => !record.noise);
  const apiRecords = records.filter((record) =>
    record.path.startsWith("/api/"),
  );
  return {
    from,
    to: hop.path,
    label: hop.linkName,
    toContentMs: Math.round(toContentMs),
    settleMs: Math.round(settleMs),
    shellSurvived: probe.shellSurvived,
    mountedLoading: probe.mountedLoading,
    fallbacks: probe.fallbacks,
    documents: records.filter((record) => record.resourceType === "document")
      .length,
    rsc: records.filter((record) => record.path.includes("_rsc=")).length,
    api: apiRecords.length,
    shellApi: apiRecords
      .map((record) => record.path.split("?")[0] ?? record.path)
      .filter((path) => SHELL_ENDPOINTS.includes(path)),
    paths: countByPath(records),
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function navigationSession(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await login(page, access);
    await dismissNotificationHint(page, base);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

test("measure sidebar navigation", async ({ browser }) => {
  test.setTimeout(REPEATS * 180_000);
  const storageState = await navigationSession(browser);

  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    const context = await browser.newContext({
      storageState,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    // Ohne Leitungsbremse ist jeder Wechsel gegen ein lokales Backend fertig,
    // bevor irgendeine Ladehülle sichtbar wird — gemessen würde dann etwas,
    // das keine Schule je erlebt. NETWORK entspricht grob einem Schul-WLAN
    // gegen einen entfernten Server.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      ...NETWORK,
    });
    const recorder = new RequestRecorder(page);
    const results: HopResult[] = [];
    try {
      // Erster Aufruf normal laden; gemessen wird erst ab dem zweiten
      // Schritt. Das Warten auf Ruhe ist Pflicht: sonst laufen die Requests
      // des Seitenaufrufs noch, wenn der erste Wechsel startet, und werden
      // ihm zugerechnet.
      await gotoTolerant(page, `${base}${NAVIGATION_HOPS[0]!.path}`);
      await expect(NAVIGATION_HOPS[0]!.ready(page)).toBeVisible({
        timeout: 30_000,
      });
      recorder.start();
      await recorder.waitForQuiet(QUIET);
      let from = NAVIGATION_HOPS[0]!.path;
      for (const hop of NAVIGATION_HOPS.slice(1)) {
        const result = await measureHop(page, recorder, from, hop);
        expectNavigationInvariants(result);
        results.push(result);
        from = hop.path;
      }
    } finally {
      writeFileSync(
        join(OUT_DIR, `navigation.${repeat}.json`),
        JSON.stringify(results, null, 2),
      );
      await context.close();
    }
  }
});

// Zeigen vor dem Klick (#4987). Je Ziel ein frischer Kontext, damit der Klick
// kalt ist: kein Modul der Zielseite im Cache, kein Eintrag im Router.
// Beide Varianten warten INTENT_WINDOW_MS vor dem Klick; „hover“ hält die Maus
// dabei auf dem Link, „click“ lässt sie liegen. Was im Fenster angefragt
// wird, sind die Kosten des Vorladens — bei „click“ muss es leer sein.
const INTENT_WINDOW_MS = 300;
const INTENT_MODES = ["click", "hover"] as const;
/**
 * Vor dem Fenster muss die Ausgangsseite wirklich ruhen: unter 4x CPU liegen
 * zwischen zwei Daten-Stufen der Startseite mehr als 1,5 s ohne Request.
 */
const INTENT_SETTLE = { quietMs: 3000, capMs: 30_000 } as const;
/** Nach dem Klick reicht ein kürzeres Fenster: gezählt wird nur der Wechsel. */
const INTENT_QUIET = { quietMs: 1500, capMs: 10_000 } as const;

interface IntentResult {
  name: string;
  mode: (typeof INTENT_MODES)[number];
  repeat: number;
  toContentMs: number;
  /** Klick bis zum ersten Daten-Request der Zielseite. */
  firstApiMs: number | null;
  settleMs: number;
  /** Requests im Fenster vor dem Klick. */
  window: RequestCost;
  /** Requests ab dem Klick bis zur Ruhe. */
  afterClick: RequestCost;
  documents: number;
  shellSurvived: boolean;
  /** Hüllen-Endpunkte, die der Wechsel erneut abruft. */
  shellApi: string[];
  fallbacks: string[];
  windowPaths: string[];
  afterClickPaths: string[];
  /** RSC und JS relativ zum Klick: „start..ende pfad“ in ms. */
  timeline: string[];
}

async function measureIntent(
  page: Page,
  recorder: RequestRecorder,
  hop: IntentHop,
  mode: IntentResult["mode"],
  repeat: number,
): Promise<IntentResult> {
  if (hop.accordion) {
    await page.addInitScript((section) => {
      localStorage.setItem("sidebar-accordion-expanded", section);
    }, hop.accordion);
  }
  await gotoTolerant(page, `${base}${hop.from}`);
  await expect(hop.fromReady(page)).toBeVisible({ timeout: 30_000 });
  const link = hop.link(page);
  recorder.start();
  await recorder.waitForQuiet(INTENT_SETTLE);
  await expect(link).toBeVisible({ timeout: 30_000 });

  await armProbe(page);
  recorder.start();
  const windowStarted = performance.now();
  if (mode === "hover") await link.hover({ timeout: 15_000 });
  await page.waitForTimeout(INTENT_WINDOW_MS);
  const clickOffset = performance.now() - windowStarted;
  const started = performance.now();
  await link.click({ timeout: 15_000 });
  // Manche Marken stehen auch auf der Ausgangsseite; erst die Adresse zählt.
  await page.waitForURL((url) => url.pathname === hop.path, {
    timeout: 30_000,
    waitUntil: "commit",
  });
  await expect(hop.ready(page)).toBeVisible({ timeout: 30_000 });
  const toContentMs = performance.now() - started;
  await recorder.waitForQuiet(INTENT_QUIET);
  const settleMs = performance.now() - started;
  const probe = await readProbe(page);

  const records = recorder.records.filter((record) => !record.noise);
  const inWindow = records.filter((record) => record.startMs < clickOffset);
  const afterClick = records.filter((record) => record.startMs >= clickOffset);
  const firstApi = afterClick.find((record) => record.path.startsWith("/api/"));
  return {
    name: hop.name,
    mode,
    repeat,
    toContentMs: Math.round(toContentMs),
    firstApiMs: firstApi ? Math.round(firstApi.startMs - clickOffset) : null,
    settleMs: Math.round(settleMs),
    window: requestCost(inWindow),
    afterClick: requestCost(afterClick),
    documents: afterClick.filter((record) => record.resourceType === "document")
      .length,
    shellSurvived: probe.shellSurvived,
    shellApi: afterClick
      .map((record) => record.path.split("?")[0] ?? record.path)
      .filter((path) => SHELL_ENDPOINTS.includes(path)),
    fallbacks: probe.fallbacks,
    windowPaths: countByPath(inWindow),
    afterClickPaths: countByPath(afterClick),
    timeline: records
      .filter(
        (record) =>
          record.path.includes("_rsc=") || record.resourceType === "script",
      )
      .map(
        (record) =>
          `${Math.round(record.startMs - clickOffset)}..${
            record.endMs === null
              ? "offen"
              : Math.round(record.endMs - clickOffset)
          } ${record.path.replace(/\?.*$/, "")}`,
      ),
  };
}

test("measure cold click after intent", async ({ browser }) => {
  test.setTimeout(REPEATS * INTENT_HOPS.length * INTENT_MODES.length * 180_000);

  const storageState = await navigationSession(browser);

  const results: IntentResult[] = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    for (const hop of INTENT_HOPS) {
      for (const mode of INTENT_MODES) {
        const context = await browser.newContext({
          storageState,
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: CPU_THROTTLE,
        });
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          ...NETWORK,
        });
        try {
          const result = await measureIntent(
            page,
            new RequestRecorder(page),
            hop,
            mode,
            repeat,
          );
          expect(result.documents, `${hop.name}: kein Dokument-Reload`).toBe(0);
          expect(
            result.shellSurvived,
            `${hop.name}: Portalhülle bleibt erhalten`,
          ).toBe(true);
          results.push(result);
          // Laufend sichern: ein Abbruch kostet sonst alle bisherigen Läufe.
          writeFileSync(
            join(OUT_DIR, "intent.json"),
            JSON.stringify(results, null, 2),
          );
          console.log(
            `${hop.name} ${mode} #${repeat}: ${result.toContentMs} ms, Fenster ${result.window.requests} Requests / ${result.window.kB} kB`,
          );
        } finally {
          await context.close();
        }
      }
    }
  }
  const rows = INTENT_HOPS.flatMap((hop) =>
    INTENT_MODES.map((mode) => {
      const runs = results.filter(
        (result) => result.name === hop.name && result.mode === mode,
      );
      return {
        ziel: hop.name,
        variante: mode,
        klickBisInhaltMs: median(runs.map((run) => run.toContentMs)),
        ersterDatenRequestMs: median(
          runs.flatMap((run) =>
            run.firstApiMs === null ? [] : [run.firstApiMs],
          ),
        ),
        fensterRequests: median(runs.map((run) => run.window.requests)),
        fensterRsc: median(runs.map((run) => run.window.rsc)),
        fensterJs: median(runs.map((run) => run.window.scripts)),
        fensterKB: median(runs.map((run) => run.window.kB)),
        nachKlickRsc: median(runs.map((run) => run.afterClick.rsc)),
        nachKlickJs: median(runs.map((run) => run.afterClick.scripts)),
        nachKlickKB: median(runs.map((run) => run.afterClick.kB)),
        laeufe: runs.map((run) => run.toContentMs).join("/"),
        ladehuellen: [...new Set(runs.flatMap((run) => run.fallbacks))].join(
          ",",
        ),
      };
    }),
  );
  console.table(rows);
  writeFileSync(
    join(OUT_DIR, "intent.summary.json"),
    JSON.stringify(rows, null, 2),
  );
});

test("measure revisit: delayed loading probe", async ({ page }) => {
  await page.setContent(
    "<style>.moto-nav-progress{opacity:0;animation:appear 1ms 180ms forwards}@keyframes appear{to{opacity:1}}</style><main></main>",
  );
  await armProbe(page);
  await page.evaluate(() => {
    const bar = document.createElement("div");
    bar.className = "moto-nav-progress";
    bar.textContent = "Lädt";
    const placeholder = document.createElement("output");
    placeholder.setAttribute("aria-busy", "true");
    placeholder.hidden = true;
    document.querySelector("main")!.append(bar, placeholder);
  });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".moto-nav-progress")!)
        .opacity === "1",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const probe = await readProbe(page);
  expect(probe.fallbacks).toEqual(["progress-bar"]);
  expect(probe.mountedLoading).toBe(true);
});

test("measure revisit: reject a failed Caterer order row", async ({ page }) => {
  const fixture = { ...revisitFixture(), schoolName: "Testschule" };
  const orders = revisitTargets(fixture).find(
    (journey) => journey.name === "konto-bestellungen",
  )!.target.content;
  await installContentProbe(page);
  await page.route("http://localhost/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<main><table>
        <thead><tr><th>Schule</th><th>Summe</th></tr></thead>
        <tbody><tr><td>Testschule</td><td id="sum">Nicht geladen</td></tr>
        <tr><td>Andere Schule</td><td>12</td></tr></tbody>
      </table></main>`,
    }),
  );
  await page.goto("http://localhost/");
  const ready = () =>
    page.evaluate((content) => window.__revisit.matches(content), orders);
  expect(await ready()).toBe(false);
  await page.locator("#sum").evaluate((cell) => (cell.textContent = "0"));
  expect(await ready()).toBe(true);
});

// Revisit shares the production server, throttle, network recorder and visible loading probe.
test("measure revisit", async ({ browser }, testInfo) => {
  // The local study can outlast a normal test; individual actions still have short deadlines.
  test.setTimeout(4 * 60 * 60_000);
  await measureRevisits(browser, (ms) =>
    testInfo.setTimeout(testInfo.timeout + ms),
  );
});
