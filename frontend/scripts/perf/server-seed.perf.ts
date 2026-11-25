import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loginToLocalMfaPortal } from "../../e2e/local-tenant-login";
import { readSeedParents } from "../seed-state";
import {
  gotoTolerant,
  loadAccess,
  loadRoleAccess,
  login,
  perfPort,
  tenantBaseUrl,
} from "./access";
import { metricsBearerToken, perfBackendUrl } from "./env.mjs";
import { RequestRecorder } from "./recorder";
import { INTENT_HOPS, type IntentHop } from "./targets";

type Portal =
  "tenant" | "parents" | "school" | "traeger" | "operator" | "caterer";
type Mode = "document" | "click" | "intent" | "warm";

interface Target {
  name: string;
  portal: Portal;
  path: string;
  from: string;
  ready(page: Page): Locator;
  link(page: Page): Locator;
  prepare?(page: Page): Promise<void>;
  revealLink?(page: Page): Promise<void>;
  warmDeparture?(page: Page): Promise<void>;
}

const access = loadAccess();
const port = perfPort();
const backend = new URL(perfBackendUrl());
if (
  backend.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)
) {
  throw new Error("The server-seed benchmark requires a localhost Go backend.");
}
const quiet = { quietMs: 700, capMs: 8_000 };
const repeats = Number(process.env.PERF_SEED_REPEATS ?? 3);
const out =
  process.env.PERF_SEED_OUT ??
  join(process.cwd(), "perf-results", "server-seed");
if (!Number.isSafeInteger(repeats) || repeats < 1) {
  throw new Error("PERF_SEED_REPEATS must be a positive integer.");
}

function origin(portal: Portal) {
  if (portal === "tenant") return tenantBaseUrl(access);
  const subdomain =
    portal === "parents" ? "eltern" : portal === "school" ? "schule" : portal;
  return `http://${subdomain}.localhost:${port}`;
}

function linkTo(path: string) {
  return (page: Page) =>
    page.locator(`a[href="${path}"]`).filter({ visible: true }).first();
}

function tenantHop(hop: IntentHop): Target {
  const accordion = hop.accordion;
  return {
    ...hop,
    portal: "tenant",
    link:
      hop.name === "aktuelle-aufsicht"
        ? (page) =>
            page
              .getByRole("button", { name: "Aktuelle Aufsicht", exact: true })
              .first()
        : hop.link,
    ready:
      hop.name === "kindersuche"
        ? (page) =>
            page.getByRole("button", { name: /Details öffnen$/ }).first()
        : hop.ready,
    ...(accordion
      ? {
          prepare: async (page: Page) => {
            await page.addInitScript((section) => {
              localStorage.setItem("sidebar-accordion-expanded", section);
            }, accordion);
          },
        }
      : {}),
  };
}

const targets: readonly Target[] = [
  ...INTENT_HOPS.map(tenantHop),
  {
    name: "zeiterfassung",
    portal: "tenant",
    path: "/time-tracking",
    from: "/home",
    ready: (page) => page.getByText("Saldo", { exact: true }).first(),
    link: linkTo("/time-tracking"),
    revealLink: async (page) => {
      const group = page.getByRole("button", { name: /^Team(?:\s|$)/ }).first();
      if ((await group.getAttribute("aria-expanded")) === "false")
        await group.click();
    },
  },
  {
    name: "eltern-start",
    portal: "parents",
    path: "/",
    from: "/children",
    ready: (page) =>
      page.locator('a[href^="/children/"]').filter({ visible: true }).first(),
    link: linkTo("/"),
  },
  {
    name: "schule-hinweise",
    portal: "school",
    path: "/tagesinformationen",
    from: "/",
    ready: (page) =>
      page.getByText("Neuer Notfallplan", { exact: true }).first(),
    link: linkTo("/tagesinformationen"),
  },
  {
    name: "traeger-schulen",
    portal: "traeger",
    path: "/",
    from: "/uebersicht",
    ready: (page) => page.getByRole("link", { name: "OGS Sonnenhof" }).first(),
    link: linkTo("/"),
  },
  {
    name: "operator-traeger",
    portal: "operator",
    path: "/organizations",
    from: "/schools",
    ready: (page) =>
      page.getByText("Ganztag Nord e. V.", { exact: true }).first(),
    link: linkTo("/organizations"),
  },
  {
    name: "caterer-bestellungen",
    portal: "caterer",
    path: "/",
    from: "/konto",
    warmDeparture: async (page) => {
      await page
        .getByRole("button", { name: /Profilmenü/ })
        .first()
        .click();
    },
    ready: (page) =>
      page
        .getByRole("row", { name: /OGS Sonnenhof/ })
        .getByRole("cell", { name: /^\d+$/ })
        .first(),
    link: linkTo("/"),
  },
];

function credentials(portal: "operator" | "caterer") {
  const prefix = portal.toUpperCase();
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password)
    throw new Error(`Missing local ${portal} credentials.`);
  return { email, password };
}

async function signIn(page: Page, portal: Portal) {
  if (portal === "tenant") {
    await login(page, access);
    const dismiss = page.getByRole("button", { name: "Verstanden" });
    if (await dismiss.isVisible()) await dismiss.click();
    return;
  }
  const base = origin(portal);
  const account =
    portal === "parents"
      ? readSeedParents().find((candidate) => candidate.children > 0)
      : portal === "school"
        ? loadRoleAccess("lehrkraft")
        : portal === "traeger"
          ? loadRoleAccess("school_admin")
          : credentials(portal);
  if (!account) throw new Error(`Missing local ${portal} seed account.`);
  await loginToLocalMfaPortal(page, base, account);
}

async function goReads(page: Page) {
  const response = await page.request.get(
    new URL("/internal/metrics", backend).href,
    {
      headers: { Authorization: `Bearer ${metricsBearerToken()}` },
      maxRedirects: 0,
    },
  );
  expect(response.ok(), "local Go metrics").toBe(true);
  const counts = new Map<string, number>();
  for (const line of (await response.text()).split("\n")) {
    if (!line.startsWith("phoenix_backend_http_requests_total{")) continue;
    const method = /\bmethod="([^"]+)"/.exec(line)?.[1];
    const route = /\broute="([^"]+)"/.exec(line)?.[1];
    const count = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (method === "GET" && route && Number.isFinite(count)) {
      counts.set(route, (counts.get(route) ?? 0) + count);
    }
  }
  expect(counts.size, "Go GET counters in the metrics scrape").toBeGreaterThan(
    0,
  );
  return counts;
}

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (3 * 1024 * 1024) / 8,
    uploadThroughput: (1024 * 1024) / 8,
  });
}

type Storage = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<Portal, Storage>();

async function authenticatedContext(browser: Browser, target: Target) {
  let storageState = sessions.get(target.portal);
  if (!storageState) {
    const setup = await browser.newContext();
    try {
      const page = await setup.newPage();
      await signIn(page, target.portal);
      storageState = await setup.storageState();
      sessions.set(target.portal, storageState);
    } finally {
      await setup.close();
    }
  }
  return browser.newContext({
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    storageState,
  });
}

async function measure(browser: Browser, target: Target, mode: Mode) {
  const context = await authenticatedContext(browser, target);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await target.prepare?.(page);
    const base = origin(target.portal);
    const recorder = new RequestRecorder(page);
    await throttle(page);
    if (mode === "warm") {
      await gotoTolerant(page, base + target.path);
      await expect(target.ready(page)).toBeVisible({ timeout: 15_000 });
    }
    if (mode !== "document") {
      if (mode === "warm") {
        await target.warmDeparture?.(page);
        await linkTo(target.from)(page).click();
      } else {
        await gotoTolerant(page, base + target.from);
      }
      await page.waitForURL((url) => url.pathname === target.from);
      await target.revealLink?.(page);
      await expect(target.link(page)).toBeVisible();
      recorder.start();
      await recorder.waitForQuiet(quiet);
    }
    const before = await goReads(page);
    recorder.start();
    if (mode === "intent") {
      await target.link(page).hover();
      // Give the shared pointer-intent timer and resulting RSC request a slot.
      await page.waitForTimeout(600);
    }
    const clickMark = recorder.mark();
    const started = performance.now();
    if (mode === "document") {
      await gotoTolerant(page, base + target.path);
    } else {
      await target.link(page).click();
      await page.waitForURL((url) => url.pathname === target.path);
    }
    await expect(target.ready(page)).toBeVisible({ timeout: 15_000 });
    const toContentMs = Math.round(performance.now() - started);
    await recorder.waitForQuiet(quiet);
    const after = await goReads(page);
    const delta = [...after]
      .map(([route, total]) => ({
        route,
        count: total - (before.get(route) ?? 0),
      }))
      .filter(({ count }) => count > 0);
    const records = recorder.records.filter((record) => !record.noise);
    const document = records.find(
      (record) => record.resourceType === "document",
    );
    const rsc = records.filter((record) => record.path.includes("_rsc="));
    const firstResponse =
      document ??
      rsc.find(
        (record) =>
          new URL(record.url).pathname === target.path && !record.failed,
      );
    const timing = firstResponse?.ttfbMs;
    const size = (rows: typeof records) =>
      rows.reduce((sum, record) => sum + (record.bytes ?? 0), 0);
    return {
      mode,
      toContentMs,
      ttfbMs: timing == null ? null : Math.round(timing),
      rscBytes: size(rsc),
      jsBytes: size(
        records.filter((record) => record.resourceType === "script"),
      ),
      documentBytes: document?.bytes ?? null,
      beforeClick: recorder.records
        .slice(0, clickMark)
        .filter((record) => !record.noise)
        .map(({ path }) => path),
      browserGets: records
        .filter(
          (record) =>
            record.method === "GET" && record.path.startsWith("/api/"),
        )
        .map(({ path }) => path.split("?")[0]),
      goGets: delta,
    };
  } finally {
    await context.close();
  }
}

for (const target of targets) {
  test(target.name, async ({ browser }) => {
    const results = [];
    mkdirSync(out, { recursive: true });
    const path = join(out, `${target.name}.json`);
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      for (const mode of ["document", "click", "intent", "warm"] as const) {
        results.push({ repeat, ...(await measure(browser, target, mode)) });
        writeFileSync(path, JSON.stringify(results, null, 2));
      }
    }
  });
}
