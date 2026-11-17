import { randomBytes } from "node:crypto";
import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { networkPorts } from "./ports.mjs";

const port = networkPorts("tenantSwitch").frontend;

// #5194, #5399 for the portals with their own host-only cookie: parents,
// school, operator and caterer. After the portal's logout revoked its family,
// a response held back from before (same tab or a second tab) must neither
// write the old cookie back nor open anything: an answer that only re-read
// the session carries no session cookie (#5399). The session is opened with
// a synthetic password login as the portal's login page does it, the logout
// runs through the portal's real BFF logout route, and the cookie is cleared
// through Auth.js. Synthetic data only.

const portals = [
  {
    name: "Eltern",
    origin: `http://eltern.localhost:${port}`,
    basePath: "/api/parent/auth",
    provider: "parent-credentials",
    scope: "parent",
    cookie: "parent.session-token",
    logout: "/api/parent/auth/logout",
    read: "/api/parent/calendar",
  },
  {
    name: "Schule",
    origin: `http://schule.mfa.localhost:${port}`,
    basePath: "/api/school/auth",
    provider: "school-credentials",
    scope: "school",
    cookie: "school.session-token",
    logout: "/api/school/auth/logout",
    read: "/api/school/supervisions",
  },
  {
    name: "Betreiber",
    origin: `http://operator.localhost:${port}`,
    basePath: "/api/operator/auth",
    provider: "operator-credentials",
    scope: "platform",
    cookie: "operator.session-token",
    logout: "/api/operator/auth/logout",
    read: "/api/operator/provisioning/organizations",
  },
  {
    name: "Caterer",
    origin: `http://caterer.localhost:${port}`,
    basePath: "/api/caterer/auth",
    provider: "caterer-credentials",
    scope: "caterer",
    cookie: "caterer.session-token",
    logout: "/api/caterer/auth/logout",
    read: "/api/caterer/schools",
  },
] as const;
type Portal = (typeof portals)[number];

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
}

// Each portal opens through its own Auth.js `providers` route: JSON with 200
// and no cookie. The school and caterer hosts answer /api/health with an empty
// 404 by design, which Google Chrome turns into an error page (#5612).

/**
 * Opens a session of the portal with a synthetic password login: the parents
 * through their Auth.js credentials provider, the other portals through
 * their BFF login route, as their login pages do.
 */
async function signIn(page: Page, portal: Portal) {
  const password = randomBytes(24).toString("hex");
  await page.goto(`${portal.origin}${portal.basePath}/providers`);
  const status = await page.evaluate(
    async ({ basePath, provider, password }) => {
      const email = "fixture@example.invalid";
      if (provider !== "parent-credentials") {
        const response = await fetch(`${basePath}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        return response.status;
      }
      const { csrfToken } = (await (
        await fetch(`${basePath}/csrf`)
      ).json()) as {
        csrfToken: string;
      };
      const body = new URLSearchParams({
        csrfToken,
        email,
        password,
        json: "true",
      });
      const response = await fetch(`${basePath}/callback/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        // Auth.js redirects to NEXTAUTH_URL; only the cookie matters.
        redirect: "manual",
      });
      return response.type === "opaqueredirect" ? 302 : response.status;
    },
    { basePath: portal.basePath, provider: portal.provider, password },
  );
  expect(status).toBeLessThan(400);
}

async function sessionCookie(context: BrowserContext, portal: Portal) {
  return (await context.cookies(portal.origin)).find(
    (cookie) => cookie.name === portal.cookie,
  );
}

const readStatus = (page: Page, path: string) =>
  page.evaluate((target) => fetch(target).then((r) => r.status), path);

/** Holds the answer of a request started now, Set-Cookie included. */
async function holdResponse(
  page: Page,
  pattern: string,
  start: () => Promise<unknown>,
  cookieName: string,
) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let reportHeld!: (setCookie: boolean) => void;
  const held = new Promise<boolean>((resolve) => (reportHeld = resolve));
  await page.route(pattern, async (route: Route) => {
    // The fixture host names resolve only in Chromium (CI disables them for
    // Node), so the held request goes to loopback under its own Host.
    const request = route.request();
    const target = new URL(request.url());
    const host = target.host;
    target.hostname = "127.0.0.1";
    const response = await route.fetch({
      url: target.toString(),
      headers: { ...(await request.allHeaders()), host },
    });
    reportHeld(
      response
        .headersArray()
        .some(
          (h) =>
            h.name.toLowerCase() === "set-cookie" &&
            h.value.startsWith(`${cookieName}=`) &&
            !h.value.startsWith(`${cookieName}=;`),
        ),
    );
    await released;
    await route.fulfill({ response });
  });
  const finished = start().catch(() => undefined);
  return {
    held,
    release: async () => {
      release();
      await finished;
    },
  };
}

/** The portal's logout: revoke through its BFF route, then Auth.js signout. */
async function logOut(page: Page, portal: Portal) {
  const result = await page.evaluate(
    async ({ basePath, logout }) => {
      const revoked = await fetch(logout, { method: "POST" });
      const { csrfToken } = (await (
        await fetch(`${basePath}/csrf`)
      ).json()) as {
        csrfToken: string;
      };
      await fetch(`${basePath}/signout`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrfToken, json: "true" }),
        redirect: "manual",
      });
      return revoked.status;
    },
    { basePath: portal.basePath, logout: portal.logout },
  );
  expect(result).toBe(204);
}

const lateSources = {
  "BFF GET": (portal: Portal) => ({
    pattern: `**${portal.read}`,
    start: (page: Page) => readStatus(page, portal.read),
  }),
  "session GET": (portal: Portal) => ({
    pattern: `**${portal.basePath}/session`,
    start: (page: Page) =>
      page.evaluate(
        (path) => fetch(path).then((r) => r.status),
        `${portal.basePath}/session`,
      ),
  }),
  "session update() POST": (portal: Portal) => ({
    pattern: `**${portal.basePath}/session`,
    start: (page: Page) =>
      page.evaluate(async (basePath) => {
        const { csrfToken } = (await (
          await fetch(`${basePath}/csrf`)
        ).json()) as { csrfToken: string };
        const response = await fetch(`${basePath}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csrfToken, data: {} }),
        });
        return response.status;
      }, portal.basePath),
  }),
} as const;

for (const portal of portals) {
  for (const [sourceName, makeSource] of Object.entries(lateSources)) {
    for (const tabs of ["same tab", "second tab"] as const) {
      test(`${portal.name}: a late ${sourceName} Set-Cookie (${tabs}) restores no access`, async ({
        browser,
      }) => {
        const context = await browser.newContext();
        await isolate(context);
        const tab1 = await context.newPage();
        await signIn(tab1, portal);
        expect(await readStatus(tab1, portal.read)).toBe(200);
        const lateTab = tabs === "same tab" ? tab1 : await context.newPage();
        if (lateTab !== tab1)
          await lateTab.goto(`${portal.origin}${portal.basePath}/providers`);

        const source = makeSource(portal);
        const pending = await holdResponse(
          lateTab,
          source.pattern,
          () => source.start(lateTab),
          portal.cookie,
        );
        // Before #5399 Auth.js wrote the unchanged session with every answer.
        expect(await pending.held).toBe(false);

        await logOut(tab1, portal);
        expect(await sessionCookie(context, portal)).toBeUndefined();

        // The held answer arrives late; the deleted cookie stays deleted.
        await pending.release();
        expect(await sessionCookie(context, portal)).toBeUndefined();

        // A fresh page of the portal reads nothing protected and no session.
        const fresh = await context.newPage();
        await fresh.goto(`${portal.origin}${portal.basePath}/providers`);
        expect(await readStatus(fresh, portal.read)).toBe(401);
        expect(
          await fresh.evaluate(
            async (path) => (await fetch(path)).json(),
            `${portal.basePath}/session`,
          ),
        ).toBeNull();
        expect(await sessionCookie(context, portal)).toBeUndefined();
        await context.close();
      });
    }
  }

  test(`${portal.name}: logout leaves another family of the portal valid`, async ({
    browser,
  }) => {
    const device1 = await browser.newContext();
    const device2 = await browser.newContext();
    await isolate(device1);
    await isolate(device2);
    const page1 = await device1.newPage();
    const page2 = await device2.newPage();
    await signIn(page1, portal);
    await signIn(page2, portal);

    await logOut(page1, portal);

    expect(await readStatus(page2, portal.read)).toBe(200);
    await device1.close();
    await device2.close();
  });
}

// #2352: the guardians' portal answers `/api/parent/…` paths without a route
// file through one catalog proxy. Next must prefer the route files that
// exist, and the proxy must forward nothing the contract does not register.
test("Eltern: the catalog proxy serves only registered routes", async ({
  browser,
}) => {
  const portal = portals[0];
  const context = await browser.newContext();
  await isolate(context);
  const page = await context.newPage();
  const read = (path: string) =>
    page.evaluate(async (target) => {
      const response = await fetch(target);
      return {
        status: response.status,
        cache: response.headers.get("Cache-Control"),
        body: (await response.json().catch(() => null)) as {
          data?: Record<string, unknown>[];
          detail?: string;
          code?: string;
        } | null,
      };
    }, path);
  const registered = "/api/parent/me/enrollable-schools";
  const unregistered = "/api/parent/me/enrollable-schools/3";

  // Without a session the registered route asks for one; a path the
  // contract does not name does not exist, session or not.
  await page.goto(`${portal.origin}${portal.basePath}/providers`);
  expect((await read(registered)).status).toBe(401);
  expect((await read(unregistered)).status).toBe(404);

  await signIn(page, portal);
  const phases = await read(registered);
  expect(phases.status).toBe(200);
  expect(phases.cache).toBe("private, no-store");
  // Decoded against the contract: the identifier stays exact, and a field
  // the contract does not know is dropped.
  expect(phases.body?.data?.[0]?.school_id).toBe("9007199254740993");
  expect(phases.body?.data?.[0]).not.toHaveProperty("internal_note");

  const refused = await read(unregistered);
  expect(refused.status).toBe(404);
  // The proxy's own answer; the fixture API would say fixture.not_configured.
  expect(refused.body?.detail).toBe("route not found");
  expect(refused.cache).toBe("private, no-store");

  // A route with its own file still answers through that file.
  expect(await readStatus(page, portal.read)).toBe(200);
  await context.close();
});

// The other portals' proxies: a registered route asks for the portal's
// session and answers decoded, and a path the contract does not name for
// the portal (here another portal's route under this prefix) does not exist.
const catalogReads = {
  Schule: {
    registered: "/api/school/staff-messages/unread-count",
    unregistered: "/api/school/billing/key-day",
    data: { unread_count: 2 },
  },
  Betreiber: {
    registered: "/api/operator/billing/key-day",
    unregistered: "/api/operator/staff-messages/unread-count",
    data: {
      key_day: 15,
      next_key_date: "2026-12-15",
      updated_at: "2026-11-01T08:00:00Z",
    },
  },
  Caterer: {
    registered: "/api/caterer/schools",
    unregistered: "/api/caterer/billing/key-day",
    data: { caterer_name: "Fixture-Küche", schools: [] },
  },
} as const;

for (const portal of portals.slice(1)) {
  const { registered, unregistered, data } =
    catalogReads[portal.name as keyof typeof catalogReads];
  test(`${portal.name}: the catalog proxy serves only registered routes`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await isolate(context);
    const page = await context.newPage();
    await page.goto(`${portal.origin}${portal.basePath}/providers`);
    expect(await readStatus(page, registered)).toBe(401);
    expect(await readStatus(page, unregistered)).toBe(404);

    await signIn(page, portal);
    const answer = await page.evaluate(async (target) => {
      const response = await fetch(target);
      return {
        status: response.status,
        body: (await response.json()) as { data?: unknown },
      };
    }, registered);
    expect(answer.status).toBe(200);
    // Exactly the contract's fields: the fixture's extra one is dropped.
    expect(answer.body.data).toEqual(data);
    expect(await readStatus(page, unregistered)).toBe(404);
    await context.close();
  });
}

// The proxy of moto schule beyond a plain read: only the registered query
// travels, a legacy numeric id leaves as a string, and a write the backend
// answers with 204 succeeds without data.
test("Schule: the catalog proxy forwards a query and a write without data", async ({
  browser,
}) => {
  const portal = portals[1];
  const context = await browser.newContext();
  await isolate(context);
  const page = await context.newPage();
  await page.goto(`${portal.origin}${portal.basePath}/providers`);
  await signIn(page, portal);

  const feed = await page.evaluate(async () => {
    const response = await fetch(
      "/api/school/notifications/feed?limit=5&debug=1",
    );
    return (await response.json()) as {
      data?: { entries: { id: unknown }[]; next_cursor: string };
    };
  });
  expect(feed.data?.next_cursor).toBe("?limit=5");
  expect(feed.data?.entries[0]?.id).toBe("7");

  const write = (path: string) =>
    page.evaluate(async (target) => {
      const response = await fetch(target, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as {
          data?: unknown;
        } | null,
      };
    }, path);
  const saved = await write("/api/school/notifications/preferences/absence");
  expect(saved.status).toBe(200);
  expect(saved.body?.data).toBeNull();
  // The same path under a method the contract does not register.
  expect((await write("/api/school/notifications/feed/read-all")).status).toBe(
    404,
  );
  await context.close();
});
