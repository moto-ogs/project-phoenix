import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { networkPorts } from "./ports.mjs";

// #8082: after a logout, another account, a logout and new login of the
// same account, a school switch across hosts, a staff preview or a portal
// change, nothing of the old session stays visible or comes back: not in the
// tab that changed, not in another tab of the same or another school's
// origin, not through the browser's back and forward buttons or its
// back-forward cache, not through a late answer. A production build
// (`next build`, `next start`) with real Auth.js domain cookies against the
// synthetic localhost backend; two synthetic accounts, two synthetic schools.
// No real data or keys.
const ports = networkPorts("sessionTree");
const schoolA = `http://school-a.mfa.localhost:${ports.frontend}`;
const schoolB = `http://school-b.mfa.localhost:${ports.frontend}`;
const parents = `http://eltern.localhost:${ports.frontend}`;
const accounts = {
  a: { email: "fixture@example.invalid", name: "Test Fixture" },
  b: { email: "fixture-b@example.invalid", name: "Bea Zweitkonto" },
} as const;
type Account = keyof typeof accounts;
const NAMES = Object.values(accounts).map(({ name }) => name);
const DRAFT = "Entwurf über Mira";
const BFCACHE_PROBE = "e2e-session-tree-bfcache";

interface Rendered {
  /** Account names the page renders, hidden parts included. */
  names: string[];
  /** Whether a field holds the draft. */
  draft: boolean;
}

async function isolate(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      !url.hostname.endsWith(".localhost") ||
      url.pathname === "/monitoring" ||
      url.pathname.startsWith("/ingest")
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  await context.addInitScript(
    ({ probe, names, draft }) => {
      for (const slug of ["school-a", "school-b"])
        for (const account of ["1", "2"])
          localStorage.setItem(
            `moto.tenant.notification-setup.v1.${slug}.${account}`,
            JSON.stringify({ done: true }),
          );
      // Registered before the app's own listeners: what a restored page
      // shows before the app could react to the restore. The rendered DOM
      // only, without the server's inline data.
      addEventListener(
        "pageshow",
        (event) => {
          if (!event.persisted) return;
          const copy = document.documentElement.cloneNode(true) as HTMLElement;
          for (const node of copy.querySelectorAll("script, style, template"))
            node.remove();
          const text = copy.textContent ?? "";
          sessionStorage.setItem(
            probe,
            JSON.stringify({
              persisted: true,
              names: names.filter((name) => text.includes(name)),
              draft: Array.from(
                document.querySelectorAll("input, textarea"),
                (field) => (field as HTMLInputElement).value,
              ).includes(draft),
            }),
          );
        },
        true,
      );
    },
    { probe: BFCACHE_PROBE, names: NAMES, draft: DRAFT },
  );
}

async function newContext(browser: Browser) {
  const context = await browser.newContext();
  await isolate(context);
  return context;
}

async function login(page: Page, account: Account, origin = schoolA) {
  await page.goto(origin);
  await page.locator('input[type="email"]').fill(accounts[account].email);
  await page
    .locator('input[type="password"]')
    .fill(randomBytes(24).toString("hex"));
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.waitForURL(`${origin}/home`);
  await expectShowsAccount(page, account);
}

async function openHome(page: Page, account: Account, origin = schoolA) {
  await page.goto(`${origin}/home`);
  await expectShowsAccount(page, account);
}

/** The synthetic record: the signed-in person's name in the shell. */
async function expectShowsAccount(page: Page, account: Account) {
  await expect(
    page.getByText(accounts[account].name, { exact: false }).first(),
  ).toBeVisible();
}

/** A draft in an overlay: the school search with a typed query. */
async function typeDraft(page: Page) {
  // The query starts a search of the tab's own: it answers before the case
  // goes on. One still running when another school takes the shared cookie
  // learns of that school, and TenantGuard switches back (#5130).
  const searched = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/search",
  );
  // The shortcut works once the page registered it: pressed until the
  // search opens.
  const field = page.getByRole("dialog").getByRole("combobox").first();
  await expect(async () => {
    if (!(await field.isVisible())) await page.keyboard.press("Control+k");
    await expect(field).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await field.fill(DRAFT);
  await expect(field).toHaveValue(DRAFT);
  await searched;
}

/** What the page renders now, hidden parts included, without inline data. */
async function rendered(page: Page): Promise<Rendered> {
  try {
    return await renderedNow(page);
  } catch {
    // The page is navigating (a reload, the login): ask again.
    return { names: ["(navigating)"], draft: true };
  }
}

function renderedNow(page: Page): Promise<Rendered> {
  return page.evaluate(
    ({ names, draft }) => {
      const copy = document.documentElement.cloneNode(true) as HTMLElement;
      for (const node of copy.querySelectorAll("script, style, template"))
        node.remove();
      const text = copy.textContent ?? "";
      return {
        names: names.filter((name) => text.includes(name)),
        draft: Array.from(
          document.querySelectorAll("input, textarea"),
          (field) => (field as HTMLInputElement).value,
        ).includes(draft),
      };
    },
    { names: NAMES, draft: DRAFT },
  );
}

/** Nothing of `account` or the draft in the DOM, visible or hidden. */
async function expectNothingOf(page: Page, account: Account) {
  await expect
    .poll(async () => {
      const state = await rendered(page);
      return {
        name: state.names.includes(accounts[account].name),
        draft: state.draft,
      };
    })
    .toEqual({ name: false, draft: false });
}

/** The tab dropped its tree: it offers to load again or shows the login. */
async function expectDroppedTree(page: Page) {
  await expect(
    page
      .getByRole("button", { name: "Seite neu laden" })
      .or(page.locator('input[type="email"]')),
  ).toBeVisible();
}

async function openProfileMenu(page: Page) {
  await page
    .getByRole("button", { name: /Profilmenü|Profil/ })
    .first()
    .click();
}

async function logout(page: Page) {
  await openProfileMenu(page);
  await page.getByRole("button", { name: "Abmelden" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Abmelden" })
    .click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function switchSchool(page: Page, name: string) {
  await page.getByRole("button", { name: "Einrichtung wechseln" }).click();
  await page.getByText(name, { exact: true }).click();
}

/** Waits until the shared cookie names `tenantId` for this tab's school. */
async function expectSessionSchool(page: Page, tenantId: string) {
  await expect
    .poll(() =>
      page
        .evaluate(async () => {
          const session = await (await fetch("/api/auth/session")).json();
          return session?.user?.tenantId ?? null;
        })
        // The page is loading again (a switch): ask once more.
        .catch(() => "(navigating)"),
    )
    .toBe(tenantId);
}

/**
 * The tenant logout's requests from a page of `origin` outside the app: the
 * revocation, then Auth.js' signout, which deletes the shared cookie.
 */
async function logoutThrough(page: Page, origin: string) {
  await page.goto(`${origin}/api/auth/providers`);
  const status = await page.evaluate(async () => {
    const revoked = await fetch("/api/auth/logout", { method: "POST" });
    const { csrfToken } = (await (await fetch("/api/auth/csrf")).json()) as {
      csrfToken: string;
    };
    const signedOut = await fetch("/api/auth/signout", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
      },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/" }),
    });
    return [revoked.status, signedOut.status];
  });
  expect(status).toEqual([204, 200]);
}

/** The probe of the last restore; null also while the page reloads. */
async function bfcacheProbe(
  page: Page,
): Promise<(Rendered & { persisted: boolean }) | null> {
  try {
    return await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
      BFCACHE_PROBE,
    );
  } catch {
    // The restored page loads again (its pageshow handler): ask once more.
    return null;
  }
}

test("logout in another tab removes the account from this tab", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "a");
  await typeDraft(tab1);
  const tab2 = await context.newPage();
  await openHome(tab2, "a");
  await logout(tab2);
  await expectNothingOf(tab1, "a");
  await expect(tab1).toHaveURL(`${schoolA}/`);
  await context.close();
});

test("another account in another tab: A to B never shows A again", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "a");
  await typeDraft(tab1);
  const tab2 = await context.newPage();
  await openHome(tab2, "a");
  await logout(tab2);
  await login(tab2, "b");
  await expectNothingOf(tab1, "a");
  // The tab shows the new account from scratch, never A's draft.
  await tab1.goto(`${schoolA}/home`);
  await expectShowsAccount(tab1, "b");
  await expectNothingOf(tab1, "a");
  await context.close();
});

test("returning from public help after another tab signs out never restores the portal", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const app = await context.newPage();
  await login(app, "a");
  await app.goto(`${schoolA}/students/search`);
  await expectShowsAccount(app, "a");
  await app.getByRole("link", { name: "Hilfe zu dieser Seite" }).click();
  await expect(app).toHaveURL(/\/help\/kindersuche\?/);
  await expectNothingOf(app, "a");

  const other = await context.newPage();
  await openHome(other, "a");
  await logout(other);
  await expectNothingOf(app, "a");
  await app.goBack();
  await expectDroppedTree(app);
  await expectNothingOf(app, "a");
  await context.close();
});

test("another account replaces a live session: A to B without a logout never shows A again", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "a");
  await typeDraft(tab1);
  // Another tab signs B in while A's session lives: no logout before it.
  const tab2 = await context.newPage();
  await tab2.goto(`${schoolA}/api/auth/providers`);
  const status = await tab2.evaluate(
    async ({ email, password }) =>
      (
        await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, tenant_slug: "school-a" }),
        })
      ).status,
    { email: accounts.b.email, password: randomBytes(24).toString("hex") },
  );
  expect(status).toBe(200);
  await expectDroppedTree(tab1);
  await expectNothingOf(tab1, "a");
  await tab1.goto(`${schoolA}/home`);
  await expectShowsAccount(tab1, "b");
  await expectNothingOf(tab1, "a");
  await context.close();
});

test("A to logout to A in another tab: the old draft does not come back", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "a");
  await typeDraft(tab1);
  const tab2 = await context.newPage();
  await openHome(tab2, "a");
  await logout(tab2);
  await login(tab2, "a");
  await expect.poll(async () => (await rendered(tab1)).draft).toBe(false);
  await context.close();
});

test("a late session answer cannot release the old tree", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "a");
  await typeDraft(tab1);
  // Tab 1's next session lookup is answered at once and delivered late.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => (held = resolve));
  let holding = false;
  await tab1.route("**/api/auth/session", async (route: Route) => {
    if (holding || route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    holding = true;
    // The fixture host names resolve only in Chromium; the held request
    // goes to loopback under its own Host, like late-session-cookie.spec.ts.
    const request = route.request();
    const target = new URL(request.url());
    const host = target.host;
    target.hostname = "127.0.0.1";
    const response = await route.fetch({
      url: target.toString(),
      headers: { ...(await request.allHeaders()), host },
    });
    held();
    await released;
    await route.fulfill({ response });
  });
  const tab2 = await context.newPage();
  await openHome(tab2, "a");
  await logout(tab2);
  // While its lookup is held, the other tab's logout already took the tree.
  await isHeld;
  const isSession = (url: string) =>
    new URL(url).pathname === "/api/auth/session";
  // Delivered late, or dropped with a document that left for the login.
  const settled = Promise.race([
    tab1.waitForEvent("response", (response) => isSession(response.url())),
    tab1.waitForEvent("requestfailed", (request) => isSession(request.url())),
  ]);
  await expectNothingOf(tab1, "a");
  await login(tab2, "a");
  release();
  await settled;
  // Neither the late answer nor the new login brings the old tree back.
  await expect.poll(async () => (await rendered(tab1)).draft).toBe(false);
  await context.close();
});

test("a late staff list after a logout in another tab shows nothing", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "b");
  // The preview dialog reads the school's staff in the browser; that answer
  // is taken at once and delivered late.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => (held = resolve));
  let holding = false;
  await tab1.route(
    "**/api/auth/staff-preview/candidates",
    async (route: Route) => {
      if (holding) {
        await route.fallback();
        return;
      }
      holding = true;
      const request = route.request();
      const target = new URL(request.url());
      const host = target.host;
      target.hostname = "127.0.0.1";
      const response = await route.fetch({
        url: target.toString(),
        headers: { ...(await request.allHeaders()), host },
      });
      held();
      await released;
      await route.fulfill({ response });
    },
  );
  await openProfileMenu(tab1);
  await tab1
    .getByRole("button", { name: "Ansicht eines Mitarbeitenden" })
    .click();
  await isHeld;
  const isCandidates = (url: string) =>
    new URL(url).pathname === "/api/auth/staff-preview/candidates";
  // Delivered to the dropped page, or dropped with a document that left for
  // the login.
  const settled = Promise.race([
    tab1.waitForEvent("response", (response) => isCandidates(response.url())),
    tab1.waitForEvent("requestfailed", (request) =>
      isCandidates(request.url()),
    ),
  ]);
  // Another tab ends the session on the same origin.
  const tab2 = await context.newPage();
  await logoutThrough(tab2, schoolA);
  await tab1.bringToFront();
  await expectDroppedTree(tab1);
  release();
  await settled;
  // The staff list of the ended session never shows.
  await expectNothingOf(tab1, "a");
  await expectNothingOf(tab1, "b");
  await context.close();
});

test("logout in this tab: back and forward show nothing of the session", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab = await context.newPage();
  await login(tab, "a");
  await logout(tab);
  await tab.goBack();
  await expectNothingOf(tab, "a");
  await tab.goForward();
  await expectNothingOf(tab, "a");
  await context.close();
});

test("school switch across hosts: the other tab and the way back keep nothing", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "b");
  await typeDraft(tab1);
  const tab2 = await context.newPage();
  await openHome(tab2, "b");
  await switchSchool(tab2, "School B");
  await tab2.waitForURL(`${schoolB}/home`);
  // The other tab of the old host loses its tree with its draft.
  await expect.poll(async () => (await rendered(tab1)).draft).toBe(false);
  await tab1.close();
  await openHome(tab2, "b", schoolB);
  await expectSessionSchool(tab2, "2");
  await expectShowsAccount(tab2, "b");
  await typeDraft(tab2);
  // Back to the old school's page: no draft, and if the browser restored it,
  // no protected frame in it.
  await tab2.goBack();
  await expect(tab2).toHaveURL(`${schoolA}/home`);
  await expect.poll(async () => (await rendered(tab2)).draft).toBe(false);
  const back = await bfcacheProbe(tab2);
  if (back) expect(back).toMatchObject({ names: [], draft: false });
  // The old school's guard switches the session back and loads the page
  // again; the way forward starts once that page stands.
  await expectSessionSchool(tab2, "1");
  await expectShowsAccount(tab2, "b");
  // Forward to the target school: restored or loaded again, never with the
  // draft it had.
  await tab2.goForward();
  await expect(tab2).toHaveURL(`${schoolB}/home`);
  await expect.poll(async () => (await rendered(tab2)).draft).toBe(false);
  const forward = await bfcacheProbe(tab2);
  if (forward) expect(forward).toMatchObject({ names: [], draft: false });
  await context.close();
});

test("two schools of one person: the other origin drops its tree and switches nothing back", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const source = await context.newPage();
  await login(source, "b");
  await typeDraft(source);
  // Another school's subdomain: no storage event or broadcast reaches the
  // source tab. Its guard switches the shared cookie to its school.
  const other = await context.newPage();
  await other.bringToFront();
  await other.goto(`${schoolB}/home`);
  await expectSessionSchool(other, "2");
  await expectShowsAccount(other, "b");
  // The source tab, live in the background, drops its tree and its draft
  // instead of switching the cookie back.
  await expect.poll(async () => (await rendered(source)).draft).toBe(false);
  await expect(
    source.getByRole("button", { name: "Seite neu laden" }),
  ).toBeAttached();
  // Its guard is gone with the tree: the cookie stays with the other school.
  await expectSessionSchool(other, "2");
  // A logout on the first school's origin reaches the second one too.
  await typeDraft(other);
  await logoutThrough(await context.newPage(), schoolA);
  await other.bringToFront();
  await expectNothingOf(other, "b");
  await expectDroppedTree(other);
  await context.close();
});

test("portal change: a tab that moves to another portal and back shows nothing of the old tree", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab = await context.newPage();
  await login(tab, "a");
  await typeDraft(tab);
  // The same tab opens the parents' portal: another host, another session.
  await tab.goto(`${parents}/login`);
  await expect(tab.locator('input[type="email"]')).toBeVisible();
  // Back to the school: its session still holds, its old tree does not.
  await tab.goBack();
  await expectShowsAccount(tab, "a");
  await expect.poll(async () => (await rendered(tab)).draft).toBe(false);
  await context.close();
});

test("portal change: a parents' tab keeps its own session when the school logs out", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const school = await context.newPage();
  await login(school, "a");
  const parent = await context.newPage();
  await parent.goto(`${parents}/login`);
  await parent.locator('input[type="email"]').fill(accounts.a.email);
  await parent
    .locator('input[type="password"]')
    .fill(randomBytes(24).toString("hex"));
  await parent.getByRole("button", { name: "Anmelden", exact: true }).click();
  await parent.waitForURL((url) => url.pathname !== "/login");
  await logout(school);
  await expectNothingOf(school, "a");
  // Host-only cookies: the parents' session is not the school's.
  const parentSession = await parent.evaluate(async () => {
    const session = await (await fetch("/api/parent/auth/session")).json();
    return session?.user?.scope ?? null;
  });
  expect(parentSession).toBe("parent");
  await context.close();
});

test("a page restored from the back-forward cache shows no protected frame and loads again", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab = await context.newPage();
  await login(tab, "a");
  // Chrome keeps no page whose answers say `Cache-Control: no-store`, as the
  // app's do, unless its rollout of no-store pages in the back-forward cache
  // reaches the browser. This tab gets the school's answers without that
  // header, so the restore really happens and the app's own handling runs.
  await tab.route(`${schoolA}/**`, async (route) => {
    const request = route.request();
    // Documents and data answers carry the header; assets and the event
    // stream pass untouched.
    if (
      !["document", "fetch", "xhr"].includes(request.resourceType()) ||
      new URL(request.url()).pathname.startsWith("/api/sse")
    ) {
      await route.fallback();
      return;
    }
    const target = new URL(request.url());
    const host = target.host;
    target.hostname = "127.0.0.1";
    const response = await route.fetch({
      url: target.toString(),
      headers: { ...(await request.allHeaders()), host },
      maxRedirects: 0,
    });
    const headers = { ...response.headers() };
    delete headers["cache-control"];
    await route.fulfill({ response, headers });
  });
  // A document of its own: the browser keeps no page whose lifetime saw a
  // session cookie change (the login's own document).
  await openHome(tab, "a");
  await typeDraft(tab);
  const cdp = await context.newCDPSession(tab);
  await cdp.send("Page.enable");
  const notRestored: string[] = [];
  cdp.on("Page.backForwardCacheNotUsed", (event) => {
    for (const reason of event.notRestoredExplanations)
      notRestored.push(`${reason.type}:${reason.reason}`);
  });
  // Another site, then back: the browser keeps a page for the way back only
  // when the navigation leaves its site (a new browsing instance).
  await tab.goto(`${parents}/login`);
  // The restored page loads again at once, which ends this navigation.
  await tab.goBack().catch((error: Error) => {
    if (!/ERR_ABORTED|frame was detached/.test(error.message)) throw error;
  });
  await expect
    .poll(
      async () => notRestored.length > 0 || (await bfcacheProbe(tab)) !== null,
    )
    .toBe(true);
  expect(notRestored, "reasons the browser gave for not restoring").toEqual([]);
  // The browser really restored the page (pageshow.persisted), and nothing
  // protected was in it ...
  expect(await bfcacheProbe(tab)).toEqual({
    persisted: true,
    names: [],
    draft: false,
  });
  // ... and the app loaded it again from the server, without the draft.
  await expectShowsAccount(tab, "a");
  expect((await rendered(tab)).draft).toBe(false);
  await tab.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
});

test("staff preview: start and end leave nothing of the other view", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab1 = await context.newPage();
  await login(tab1, "b");
  await typeDraft(tab1);
  const tab2 = await context.newPage();
  await openHome(tab2, "b");
  await openProfileMenu(tab2);
  await tab2
    .getByRole("button", { name: "Ansicht eines Mitarbeitenden" })
    .click();
  await tab2
    .getByRole("combobox", { name: "Person für die Vorschau auswählen" })
    .click();
  await tab2.getByRole("option", { name: accounts.a.name }).click();
  await tab2.getByRole("button", { name: "Vorschau starten" }).click();
  // The preview renders the target from a new document ...
  await expect(
    tab2.getByRole("button", { name: /Vorschau beenden/ }),
  ).toBeVisible();
  // ... and the admin's other tab loses its tree with the draft.
  await expect.poll(async () => (await rendered(tab1)).draft).toBe(false);
  await tab1.close();
  await typeDraft(tab2);
  await tab2.keyboard.press("Escape");
  await tab2.getByRole("button", { name: /Vorschau beenden/ }).click();
  // Back as the admin, from a new document without the preview's draft.
  await expect(
    tab2.getByRole("button", { name: /Vorschau beenden/ }),
  ).toHaveCount(0);
  await expectShowsAccount(tab2, "b");
  expect((await rendered(tab2)).draft).toBe(false);
  await context.close();
});

test("a warm parent return keeps its cards while changed data revalidates", async ({
  browser,
}) => {
  const context = await newContext(browser);
  const tab = await context.newPage();
  await tab.goto(`${parents}/login`);
  await tab.locator('input[type="email"]').fill(accounts.a.email);
  await tab
    .locator('input[type="password"]')
    .fill(randomBytes(24).toString("hex"));
  await tab.getByRole("button", { name: "Anmelden", exact: true }).click();
  await tab.waitForURL((url) => url.pathname === "/");
  const childName = (name: string) =>
    tab
      .locator("main")
      .getByText(name, { exact: false })
      .filter({ visible: true })
      .first();
  const profile = tab
    .locator('main a[href="/children/11"]')
    .filter({ visible: true })
    .first();
  await expect(childName("Mira")).toBeVisible();
  await tab.evaluate(
    () => (document.documentElement.dataset.warmReturn = "same"),
  );
  await profile.click();
  await tab.waitForURL((url) => url.pathname === "/children/11");

  let signalRequest!: () => void;
  const requested = new Promise<void>((resolve) => (signalRequest = resolve));
  let signalRelease!: () => void;
  const released = new Promise<void>((resolve) => (signalRelease = resolve));
  await tab.route("**/api/parent/me/family-start*", async (route) => {
    const request = route.request();
    const loopback = new URL(request.url());
    const host = loopback.host;
    loopback.hostname = "127.0.0.1";
    const upstream = await route.fetch({
      url: loopback.href,
      headers: { ...(await request.allHeaders()), host },
    });
    const body = (await upstream.json()) as {
      data: {
        cards: Array<{ child: { student_id: string; first_name: string } }>;
      };
    };
    const child = body.data.cards.find(
      (entry) => entry.child.student_id === "11",
    );
    if (child) child.child.first_name = "Mila";
    signalRequest();
    await released;
    await route.fulfill({ response: upstream, json: body });
  });
  try {
    await tab.goBack();
    await expect(tab.locator("html")).toHaveAttribute(
      "data-warm-return",
      "same",
    );
    await expect(childName("Mira")).toBeVisible();
    await tab.evaluate(() =>
      window.dispatchEvent(new Event("parent-child-status-refresh")),
    );
    await requested;
    await expect(childName("Mira")).toBeVisible();
  } finally {
    signalRelease();
  }
  await expect(childName("Mila")).toBeVisible();
  await context.close();
});

test("a revoked child relationship discards its detail, the other child stays", async ({
  browser,
  request,
}) => {
  const context = await newContext(browser);
  const tab = await context.newPage();
  await tab.goto(`${parents}/login`);
  await tab.locator('input[type="email"]').fill(accounts.a.email);
  await tab
    .locator('input[type="password"]')
    .fill(randomBytes(24).toString("hex"));
  await tab.getByRole("button", { name: "Anmelden", exact: true }).click();
  await tab.waitForURL((url) => url.pathname !== "/login");
  await tab.goto(`${parents}/children/11`);
  await expect(tab.getByText("Mira").first()).toBeVisible();
  // The school ends the relationship to one child.
  await request.get(
    `http://127.0.0.1:${ports.api}/__fixture/revoke-child?id=11`,
  );
  // The next look at the list (focus, a refused read) brings it to the tab.
  await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() =>
      tab.evaluate(() => {
        const copy = document.documentElement.cloneNode(true) as HTMLElement;
        for (const node of copy.querySelectorAll("script, style, template"))
          node.remove();
        return (copy.textContent ?? "").includes("Mira");
      }),
    )
    .toBe(false);
  await tab.goto(`${parents}/children/12`);
  await expect(tab.getByText("Ben").first()).toBeVisible();
  await context.close();
});
