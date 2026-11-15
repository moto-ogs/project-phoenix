/*
 * Barrierefreiheits-Audit (#2790, #7107): manuelles Werkzeug für Re-Audits,
 * läuft nicht in CI. Die CI-Absicherung ist der axe-Ratchet in e2e/a11y/.
 *
 * Prüft 114 Ansichten (öffentliche Seiten, Eltern je Desktop und Mobil,
 * Tenant, Träger, Schulportal) mit axe (WCAG 2.0/2.1 A+AA, 2.2 AA zur
 * Information), jede Desktop-Ansicht zusätzlich auf Reflow bei 320 px, auf
 * 11 Seiten einen Tab-Lauf mit Pixelvergleich (Fokus sichtbar?) und die
 * Fehlerzustände von Logins und Anmeldeformular.
 *
 * So geht es:
 *   1. Lokalen Stack starten und mit dem Profil `vollbetrieb` seeden, den Tag
 *      simulieren (docs/agents/operations.md). Der Seed muss von heute sein.
 *   2. cd frontend && pnpm run audit:a11y
 *      AUDIT_ONLY=public,errors,eltern,tenant,traeger,schule schränkt ein.
 *      AUDIT_SANITY=1 führt die Gegenprobe aus: Ohne Fokusstile muss der
 *      Tab-Lauf jeden Stopp als unsichtbar melden.
 *   3. Ergebnisse: tmp/a11y-audit/results/*.json im Repo-Wurzelverzeichnis,
 *      eine Zeile je Ansicht im Log.
 */
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loginToLocalMfaPortal,
  loginToLocalTenant,
} from "../../e2e/local-tenant-login";
import { loadStackAccess } from "../product-screenshots/access";
import { readSeedAccess } from "../seed-state";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT = join(ROOT, "tmp", "a11y-audit", "results");
const ONLY = process.env.AUDIT_ONLY?.split(",") ?? null; // Portale filtern
mkdirSync(OUT, { recursive: true });

const NO_MOTION_CSS = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;
// Einmalige Hinweise (Benachrichtigungen, erste Schritte, Rundgang) gelten als
// erledigt, sonst überdecken sie jede Seite.
const PRESET = `(() => { const o = Storage.prototype.getItem; Storage.prototype.getItem = function (k) {
  if (/^moto\\.[a-z]+\\.notification-setup\\.v1\\./.test(k)) return '{"done":true}';
  if (/^parent-first-steps:v1:/.test(k)) return '{"dismissed":true}';
  if (/^staff-onboarding-opened:/.test(k)) return "1";
  return o.call(this, k); }; })();`;

type Creds = { email: string; password: string };
const access = loadStackAccess({ frontendDir: join(ROOT, "frontend") });
const port = new URL(access.parentsOrigin).port;
const schoolOrigin = `http://schule.localhost:${port}`;
const lehrkraft: Creds | null = readSeedAccess({
  profile: "vollbetrieb",
  role: "lehrkraft",
});

// ---------- Logins ----------
async function loginParents(page: Page, c: Creds) {
  await page.goto(`${access.parentsOrigin}/login`, {
    waitUntil: "domcontentloaded",
  });
  await page.fill("#parent-email", c.email);
  await page.fill("#parent-password", c.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}
async function newCtx(
  browser: Browser,
  viewport: { width: number; height: number },
  state?: Awaited<ReturnType<BrowserContext["storageState"]>>,
) {
  const ctx = await browser.newContext({
    viewport,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    storageState: state,
    reducedMotion: "reduce",
  });
  await ctx.addInitScript(PRESET);
  return ctx;
}
async function sessionFor(
  browser: Browser,
  portal: string,
): Promise<Awaited<ReturnType<BrowserContext["storageState"]>> | undefined> {
  if (portal === "public") return undefined;
  const ctx = await newCtx(browser, { width: 1366, height: 900 });
  const page = await ctx.newPage();
  try {
    if (portal === "tenant")
      await loginToLocalTenant(page, access.tenantOrigin, access.admin);
    else if (portal === "eltern") await loginParents(page, access.eltern!);
    else if (portal === "traeger")
      await loginToLocalMfaPortal(page, access.traegerOrigin!, access.traeger!);
    else if (portal === "schule")
      await loginToLocalMfaPortal(page, schoolOrigin, lehrkraft!);
    // Einwilligungsdialog Nutzungsanalyse einmal ablehnen (lokales Demo-Konto), sonst überdeckt er jede Seite.
    const home = {
      tenant: access.tenantOrigin + "/home",
      eltern: access.parentsOrigin + "/",
      traeger: (access.traegerOrigin ?? "") + "/uebersicht",
      schule: schoolOrigin + "/",
    }[portal]!;
    await page.goto(home, { waitUntil: "domcontentloaded" });
    const decline = page.getByRole("button", { name: /^Ablehnen/ });
    if (
      await decline
        .waitFor({ timeout: 8000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await decline.click();
      await page.waitForTimeout(1500);
      console.log(`${portal}: Analyse-Einwilligung abgelehnt`);
    }
    return await ctx.storageState();
  } finally {
    await ctx.close();
  }
}

// ---------- Messungen ----------
async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const busy = await page
      .evaluate(
        () =>
          Array.from(
            document.querySelectorAll('[aria-busy="true"], .animate-pulse'),
          ).filter((e) => {
            if (e.matches('[aria-busy="true"]')) return true;
            if (e instanceof SVGElement) return false;
            const r = e.getBoundingClientRect();
            return r.width > 8 || r.height > 8;
          }).length,
      )
      .catch(() => 1);
    if (busy === 0) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(600);
}
async function axe(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("nextjs-portal")
    .analyze();
  return {
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      tags: v.tags.filter((t) => t.startsWith("wcag")),
      help: v.help,
      count: v.nodes.length,
      nodes: v.nodes.slice(0, 6).map((n) => ({
        target: n.target.join(" "),
        html: n.html.slice(0, 200),
        summary: (n.failureSummary ?? "").slice(0, 300),
      })),
    })),
    incomplete: r.incomplete.map((v) => ({ id: v.id, count: v.nodes.length })),
  };
}
async function pageFacts(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    h1: document.querySelectorAll("h1").length,
    main: document.querySelectorAll("main").length,
    navs: Array.from(document.querySelectorAll("nav")).map(
      (n) =>
        n.getAttribute("aria-label") ??
        n.getAttribute("aria-labelledby") ??
        null,
    ),
    ariaCurrent: document.querySelectorAll("[aria-current]").length,
  }));
}
async function reflow(page: Page) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const sw = document.documentElement.scrollWidth;
    let widest: string | null = null;
    if (sw > 321) {
      let max = 0;
      for (const e of Array.from(document.body.querySelectorAll("*"))) {
        const r = e.getBoundingClientRect();
        if (
          r.right > 322 &&
          r.width > 0 &&
          r.width < 2000 &&
          getComputedStyle(e).position !== "fixed"
        ) {
          // innerstes Element, das rausragt
          if (r.right > max || r.right === max) {
            max = r.right;
            widest = `${e.tagName.toLowerCase()} "${(e.textContent ?? "").trim().slice(0, 50)}" in ${e.parentElement?.closest("section,[data-slot],main")?.querySelector("h2,h3")?.textContent?.trim().slice(0, 40) ?? "?"} right=${Math.round(r.right)}`;
          }
        }
      }
    }
    return { scrollWidth: sw, overflow: sw > 321, widest };
  });
}

// Tastatur: jeder Tab-Stopp mit/ohne Fokus fotografieren.
async function keyboardWalk(page: Page, maxStops = 45) {
  await page.addStyleTag({ content: NO_MOTION_CSS });
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: any[] = [];
  let tabsToMain: number | null = null;
  const seen = new Set<string>();
  for (let i = 1; i <= maxStops; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (
        !el ||
        el === document.body ||
        el.tagName.toLowerCase() === "nextjs-portal"
      )
        return null;
      const r = el.getBoundingClientRect();
      const name = (
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el as HTMLInputElement).labels?.[0]?.textContent ??
        el.textContent ??
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 60);
      const path: string[] = [];
      let n: Element | null = el;
      while (n && n !== document.body && path.length < 6) {
        path.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : ""));
        n = n.parentElement;
      }
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
        role: el.getAttribute("role"),
        name,
        inMain: !!el.closest("main"),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        key:
          path.join(">") +
          "|" +
          Math.round(r.x) +
          "," +
          Math.round(r.y + window.scrollY),
        opacity: getComputedStyle(el).opacity,
      };
    });
    if (!info) {
      stops.push({ i, tag: "body" });
      continue;
    }
    if (seen.has(info.key)) break;
    seen.add(info.key); // einmal rum
    if (tabsToMain === null && info.inMain && !/zum inhalt/i.test(info.name))
      tabsToMain = i;
    let visible: boolean | null = null;
    if (info.rect.w > 0 && info.rect.h > 0) {
      const vp = page.viewportSize()!;
      const pad = 6;
      const clip = {
        x: Math.max(0, info.rect.x - pad),
        y: Math.max(0, info.rect.y - pad),
        width: 0,
        height: 0,
      };
      clip.width = Math.min(vp.width - clip.x, info.rect.w + 2 * pad);
      clip.height = Math.min(vp.height - clip.y, info.rect.h + 2 * pad);
      if (clip.width > 1 && clip.height > 1) {
        const a = await page.screenshot({ clip });
        await page.evaluate(() =>
          (document.activeElement as HTMLElement).blur(),
        );
        await page.waitForTimeout(80);
        const b = await page.screenshot({ clip });
        visible = !a.equals(b);
        // Fokus zurück, damit Tab am selben Startpunkt weitergeht
        await page.evaluate((k) => {
          const all = Array.from(
            document.querySelectorAll<HTMLElement>(
              "a,button,input,select,textarea,[tabindex],summary,[contenteditable]",
            ),
          );
          for (const e of all) {
            const r = e.getBoundingClientRect();
            const p: string[] = [];
            let n: Element | null = e;
            while (n && n !== document.body && p.length < 6) {
              p.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : ""));
              n = n.parentElement;
            }
            if (
              p.join(">") +
                "|" +
                Math.round(r.x) +
                "," +
                Math.round(r.y + window.scrollY) ===
              k
            ) {
              e.focus({ preventScroll: true });
              return;
            }
          }
        }, info.key);
      }
    }
    stops.push({
      i,
      tag: info.tag,
      type: info.type,
      role: info.role,
      name: info.name,
      inMain: info.inMain,
      opacity: info.opacity,
      focusVisible: visible,
    });
  }
  return {
    tabsToMain,
    stops,
    invisible: stops.filter((s) => s.focusVisible === false).length,
    total: stops.filter((s) => s.tag !== "body").length,
  };
}

// ---------- Seitenliste ----------
type Target = {
  portal: string;
  path: string;
  label: string;
  discover?: { from: string; pattern: RegExp };
};
const T = (portal: string, paths: string[]): Target[] =>
  paths.map((p) => ({ portal, path: p, label: `${portal}${p}` }));

const PUBLIC: Target[] = [
  {
    portal: "public",
    path: `${access.tenantOrigin}/`,
    label: "public/personal-login",
  },
  {
    portal: "public",
    path: `${access.tenantOrigin}/reset-password`,
    label: "public/passwort-vergessen",
  },
  {
    portal: "public",
    path: `${access.parentsOrigin}/login`,
    label: "public/eltern-login",
  },
  {
    portal: "public",
    path: `${access.parentsOrigin}/reset-password`,
    label: "public/eltern-passwort-vergessen",
  },
  {
    portal: "public",
    path: `${access.tenantOrigin}/anmeldung`,
    label: "public/anmeldung-phasen",
  },
  {
    portal: "public",
    path: `${access.traegerOrigin}/login`,
    label: "public/traeger-login",
  },
  {
    portal: "public",
    path: `${schoolOrigin}/login`,
    label: "public/schule-login",
  },
];
const ELTERN = T("eltern", [
  "/",
  "/calendar",
  "/children",
  "/documents",
  "/ferienanmeldungen",
  "/meal-plan",
  "/messages",
  "/news",
  "/settings",
  "/anmeldung",
]);
const ELTERN_DYN: Target[] = [
  {
    portal: "eltern",
    path: "",
    label: "eltern/children/[id]",
    discover: { from: "/children", pattern: /^\/children\/[^/]+$/ },
  },
  {
    portal: "eltern",
    path: "",
    label: "eltern/messages/[id]",
    discover: { from: "/messages", pattern: /^\/messages\/(?!group)[^/]+$/ },
  },
];
const TENANT = T("tenant", [
  "/dashboard",
  "/home",
  "/students/search",
  "/ogs-groups",
  "/active-supervisions",
  "/rooms",
  "/activities",
  "/absences",
  "/anfragen",
  "/betreuungsplan",
  "/calendar",
  "/care-offerings",
  "/database",
  "/database/students",
  "/database/personal",
  "/database/rooms",
  "/database/groups",
  "/database/roles",
  "/dateien",
  "/day-log",
  "/dienstplan",
  "/mein-dienstplan",
  "/eltern/bankverbindungen",
  "/emergency",
  "/enrollment-phases",
  "/admin/enrollments",
  "/ferienwochen",
  "/meal-plan",
  "/messages",
  "/team-chat",
  "/parent-announcements",
  "/payroll",
  "/profile",
  "/reminders",
  "/settings",
  "/staff",
  "/statistics",
  "/substitutions",
  "/tagesinformationen",
  "/tagesplan",
  "/time-tracking",
  "/umfragen",
  "/vertretung",
  "/wochenprotokolle",
  "/lists",
  "/info-displays",
]);
const TENANT_DYN: Target[] = [
  {
    portal: "tenant",
    path: "",
    label: "tenant/students/[id]",
    discover: { from: "/students/search", pattern: /^\/students\/\d+$/ },
  },
  {
    portal: "tenant",
    path: "",
    label: "tenant/staff/[id]",
    discover: { from: "/staff", pattern: /^\/staff\/\d+$/ },
  },
];
const TRAEGER = T("traeger", [
  "/",
  "/uebersicht",
  "/abrechnung",
  "/abrechnung/familien",
  "/abrechnung/monatsbeitraege",
  "/abrechnung/jahresbescheide",
  "/abrechnung/lastschrift",
  "/abrechnung/preise",
  "/abrechnung/exporte",
  "/abrechnung/ermaessigungen",
  "/abrechnung/kostentraeger",
  "/anmeldephasen",
  "/belegung",
  "/dokumente",
  "/einstellungen",
  "/einstellungen/mitglieder",
  "/einstellungen/zugriffsprotokoll",
  "/ferien",
  "/schliesstage",
  "/stichtagszahlen",
  "/vertraege",
  "/zeitvergleich",
  "/konto",
]);
const SCHULE = T("schule", [
  "/",
  "/aufsichten",
  "/elternbriefe",
  "/fehlzeiten",
  "/kalender",
  "/klasse",
  "/nachrichten",
  "/tagesinformationen",
  "/einstellungen",
]);

const ORIGIN: Record<string, string> = {
  tenant: access.tenantOrigin,
  eltern: access.parentsOrigin,
  traeger: access.traegerOrigin ?? "",
  schule: schoolOrigin,
};
const KEYBOARD = new Set([
  "public/personal-login",
  "public/eltern-login",
  "public/traeger-login",
  "public/schule-login",
  "public/anmeldung-formular",
  "tenant/dashboard",
  "eltern/",
  "traeger/uebersicht",
  "schule/",
  "tenant/students/search",
  "eltern/settings",
]);

function save(name: string, data: unknown) {
  writeFileSync(
    join(OUT, name.replace(/[^a-z0-9_-]+/gi, "_") + ".json"),
    JSON.stringify(data, null, 1),
  );
}

async function scanOne(
  page: Page,
  url: string,
  label: string,
  opts: { mobile?: boolean; keyboard?: boolean },
) {
  const t0 = Date.now();
  const resp = await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
    .catch((e) => ({ status: () => `ERR ${String(e).slice(0, 80)}` }) as any);
  await settle(page);
  const finalUrl = page.url();
  const facts = await pageFacts(page);
  const ax = await axe(page).catch((e) => ({ error: String(e).slice(0, 200) }));
  let kb = null;
  if (opts.keyboard)
    kb = await keyboardWalk(page).catch((e) => ({
      error: String(e).slice(0, 200),
    }));
  const rf = opts.mobile
    ? null
    : await reflow(page).catch((e) => ({ error: String(e).slice(0, 200) }));
  const res = {
    label,
    url,
    finalUrl,
    status: resp?.status?.(),
    ms: Date.now() - t0,
    facts,
    axe: ax,
    reflow: rf,
    keyboard: kb,
    mobile: !!opts.mobile,
  };
  save(`${label}${opts.mobile ? "@mobile" : ""}`, res);
  const v =
    (ax as any).violations?.map((x: any) => `${x.id}:${x.count}`).join(" ") ??
    (ax as any).error;
  console.log(
    `${label}${opts.mobile ? "@m" : ""} → ${finalUrl.replace(/^https?:\/\/[^/]+/, "")} | title="${facts.title}" | ${v || "0"}${rf && (rf as any).overflow ? " | REFLOW" : ""}${kb && !(kb as any).error ? ` | kb ${(kb as any).invisible}/${(kb as any).total} unsichtbar, main@${(kb as any).tabsToMain}` : ""}`,
  );
}

async function discover(
  page: Page,
  origin: string,
  t: Target,
): Promise<string | null> {
  await page.goto(origin + t.discover!.from, { waitUntil: "domcontentloaded" });
  await settle(page);
  const hrefs = await page.$$eval("a[href]", (as) =>
    as.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
  );
  return hrefs.find((h) => t.discover!.pattern.test(h)) ?? null;
}

async function runPortal(
  browser: Browser,
  portal: string,
  targets: Target[],
  withMobile: boolean,
) {
  if (ONLY && !ONLY.includes(portal)) return;
  const state = await sessionFor(browser, portal);
  for (const vp of withMobile ? ["desktop", "mobile"] : ["desktop"]) {
    const mobile = vp === "mobile";
    const ctx = await newCtx(
      browser,
      mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
      state,
    );
    const page = await ctx.newPage();
    const origin = ORIGIN[portal] ?? "";
    for (const t of targets) {
      let url = t.path.startsWith("http") ? t.path : origin + t.path;
      if (t.discover) {
        const p = await discover(page, origin, t).catch(() => null);
        if (!p) {
          console.log(`${t.label}: kein Link gefunden`);
          continue;
        }
        url = origin + p;
      }
      try {
        await scanOne(page, url, t.label, {
          mobile,
          keyboard: !mobile && KEYBOARD.has(t.label),
        });
      } catch (e) {
        console.log(`${t.label}: FEHLER ${String(e).slice(0, 160)}`);
      }
      if (!mobile) await page.setViewportSize({ width: 1366, height: 900 });
    }
    await ctx.close();
  }
}

// Fehlerzustände: falsches Passwort, leeres Anmeldeformular.
async function errorStates(browser: Browser) {
  if (ONLY && !ONLY.includes("errors")) return;
  const ctx = await newCtx(browser, { width: 1366, height: 900 });
  const page = await ctx.newPage();
  const logins = [
    {
      label: "fehler/personal-login",
      url: `${access.tenantOrigin}/`,
      email: 'input[type="email"]',
      pw: 'input[type="password"]',
      user: access.admin.email,
    },
    {
      label: "fehler/eltern-login",
      url: `${access.parentsOrigin}/login`,
      email: "#parent-email",
      pw: "#parent-password",
      user: access.eltern!.email,
    },
    {
      label: "fehler/traeger-login",
      url: `${access.traegerOrigin}/login`,
      email: "#email",
      pw: "#password",
      user: access.traeger!.email,
    },
  ];
  for (const l of logins) {
    try {
      await page.goto(l.url, { waitUntil: "domcontentloaded" });
      await settle(page);
      await page.fill(l.email, l.user);
      await page.fill(l.pw, "falsch-falsch-123");
      await page.focus(l.pw);
      await page.keyboard.press("Enter");
      await page
        .waitForSelector('[role="alert"]', { timeout: 15_000 })
        .catch(() => null);
      await page.waitForTimeout(800);
      const st = await page.evaluate(() => ({
        active: (() => {
          const a = document.activeElement as HTMLElement;
          return a ? `${a.tagName.toLowerCase()}#${a.id}` : null;
        })(),
        alerts: Array.from(
          document.querySelectorAll('[role="alert"],[aria-live]'),
        )
          .map((e) => (e.textContent ?? "").trim().slice(0, 120))
          .filter(Boolean),
        invalid: document.querySelectorAll('[aria-invalid="true"]').length,
      }));
      const ax = await axe(page);
      save(l.label, { label: l.label, state: st, axe: ax });
      console.log(
        `${l.label}: Fokus=${st.active} aria-invalid=${st.invalid} Meldung="${st.alerts[0] ?? "-"}" axe=${ax.violations.map((x: any) => `${x.id}:${x.count}`).join(" ") || 0}`,
      );
    } catch (e) {
      console.log(`${l.label}: FEHLER ${String(e).slice(0, 160)}`);
    }
  }
  // Anmeldeformular: erste Phase finden, leer absenden
  try {
    await page.goto(`${access.tenantOrigin}/anmeldung`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page);
    const href = await page.$$eval(
      "a[href]",
      (as) =>
        as
          .map((a) => (a as HTMLAnchorElement).href)
          .find(
            (h) =>
              /\/anmeldung\/[^/]+$/.test(new URL(h).pathname) &&
              !/status|preview|submitted/.test(h),
          ) ?? null,
    );
    if (!href) {
      console.log("anmeldung: keine offene Phase gefunden");
    } else {
      await scanOne(page, href, "public/anmeldung-formular", {
        keyboard: true,
      });
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.goto(href, { waitUntil: "domcontentloaded" });
      await settle(page);
      await scanOne(page, href, "public/anmeldung-formular", { mobile: true });
      await page.goto(href, { waitUntil: "domcontentloaded" });
      await settle(page);
      const submit = page.locator('button[type="submit"]').last();
      await submit.scrollIntoViewIfNeeded();
      await submit.click({ trial: false }).catch(() => null);
      await page.waitForTimeout(1500);
      const st = await page.evaluate(() => ({
        active: (() => {
          const a = document.activeElement as HTMLElement;
          return a
            ? `${a.tagName.toLowerCase()}#${a.id}[name=${a.getAttribute("name")}]`
            : null;
        })(),
        invalid: document.querySelectorAll('[aria-invalid="true"]').length,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
          (e) => (e.textContent ?? "").trim().slice(0, 120),
        ),
      }));
      const ax = await axe(page);
      save("fehler/anmeldung-leer", {
        label: "fehler/anmeldung-leer",
        url: href,
        state: st,
        axe: ax,
      });
      console.log(
        `fehler/anmeldung-leer: Fokus=${st.active} aria-invalid=${st.invalid} alerts=${st.alerts.length} axe=${ax.violations.map((x: any) => `${x.id}:${x.count}`).join(" ") || 0}`,
      );
    }
  } catch (e) {
    console.log(`anmeldung: FEHLER ${String(e).slice(0, 160)}`);
  }
  await ctx.close();
}

test("a11y audit", async ({ browser }) => {
  // öffentliche Seiten zuerst (Desktop+Mobil), dann Fehlerzustände, dann Portale
  await runPortal(browser, "public", PUBLIC, true);
  await errorStates(browser);
  await runPortal(browser, "eltern", [...ELTERN, ...ELTERN_DYN], true);
  await runPortal(browser, "tenant", [...TENANT, ...TENANT_DYN], false);
  await runPortal(browser, "traeger", TRAEGER, false);
  if (lehrkraft) await runPortal(browser, "schule", SCHULE, false);
});

// Gegenprobe: Fokusstile entfernt → der Pixelvergleich muss jeden Stopp als unsichtbar melden.
test("sanity: focus removal is detected", async ({ browser }) => {
  test.skip(!process.env.AUDIT_SANITY, "nur mit AUDIT_SANITY");
  const ctx = await newCtx(browser, { width: 1366, height: 900 });
  const page = await ctx.newPage();
  await page.goto(`${access.parentsOrigin}/login`, {
    waitUntil: "domcontentloaded",
  });
  await settle(page);
  const normal = await keyboardWalk(page);
  await page.addStyleTag({
    content: `*,*:focus,*:focus-visible{outline:none!important;box-shadow:none!important;--tw-ring-shadow:0 0 #0000!important}`,
  });
  await page.goto(`${access.parentsOrigin}/login`, {
    waitUntil: "domcontentloaded",
  });
  await settle(page);
  await page.addStyleTag({
    content: `*,*:focus,*:focus-visible{outline:none!important;box-shadow:none!important}`,
  });
  const killed = await keyboardWalk(page);
  console.log(
    `normal: ${normal.invisible}/${normal.total} unsichtbar; ohne Fokusstil: ${killed.invisible}/${killed.total} unsichtbar`,
  );
  console.log(
    killed.stops.map((s: any) => `${s.name}:${s.focusVisible}`).join(" | "),
  );
  await ctx.close();
});
