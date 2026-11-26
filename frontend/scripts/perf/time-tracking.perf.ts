import { expect, test, type Page } from "@playwright/test";
import {
  dismissNotificationHint,
  loadAccess,
  login,
  tenantBaseUrl,
} from "./access";
import { RequestRecorder, type RequestRecord } from "./recorder";

const access = loadAccess();
const base = tenantBaseUrl(access);

function describeRequests(records: readonly RequestRecord[], step: string) {
  const groups: Record<
    "feature" | "polling" | "shell" | "rsc" | "assets",
    string[]
  > = { feature: [], polling: [], shell: [], rsc: [], assets: [] };
  for (const { method, path, status, noise } of records) {
    const route = path.split("?")[0] ?? path;
    const group =
      noise ||
      (route === "/api/time-tracking/absences/mails" &&
        (step !== "entry" ||
          groups.feature.some((line) => line.includes("/absences/mails"))))
        ? "polling"
        : method === "GET" &&
            (/^\/api\/(time-tracking\/|me\/(staff|schedule)$|staff\/\d+\/schedule$)/.test(
              route,
            ) ||
              route.startsWith("/api/absence-types"))
          ? "feature"
          : route.startsWith("/api/")
            ? "shell"
            : path.includes("_rsc=")
              ? "rsc"
              : "assets";
    groups[group]!.push(`${method} ${path} (${status ?? "pending"})`);
  }
  return groups;
}

async function rangesReady(page: Page) {
  await expect(page.getByRole("table").last()).toBeVisible();
  await expect(page.getByLabel("Einträge werden geladen…")).toHaveCount(0);
}

async function capture(page: Page, surface: "entry" | "month") {
  const directory = process.env.PERF_SCREENSHOT_DIR;
  if (!directory) return;
  const heading = page.getByRole("heading", {
    name: surface === "entry" ? "Stempeluhr" : /Monatskarte \w/,
  });
  for (const [viewport, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(heading).toBeVisible();
    await heading.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${directory}/${viewport}-${surface}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("Zeiterfassung: kalter Einstieg, Zeitraumwechsel und Rückkehr", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, access);
  await dismissNotificationHint(page, base);
  await expect(page).toHaveURL(`${base}/home`);

  const recorder = new RequestRecorder(page);
  const result: Record<string, ReturnType<typeof describeRequests>> = {};
  const measure = async (
    name: string,
    action: () => Promise<void>,
    ready: () => Promise<void>,
  ) => {
    recorder.start();
    await action();
    await ready();
    expect(await recorder.waitForQuiet({ quietMs: 850, capMs: 25_000 })).toBe(
      "quiet",
    );
    result[name] = describeRequests(recorder.records, name);
    console.log(name, JSON.stringify(result[name]));
  };

  const link = page.getByRole("link", { name: "Zeiterfassung", exact: true });
  const team = page.getByRole("button", { name: /^Team(?: |$)/ });
  if ((await team.getAttribute("aria-expanded")) === "false")
    await team.click();
  await measure(
    "entry",
    () => link.click(),
    async () => {
      await expect(
        page.getByRole("heading", { name: "Stempeluhr" }),
      ).toBeVisible();
      await expect(
        page.getByText("Wochenübersicht", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Tage Anspruch für/)).toBeVisible();
      if (process.env.PERF_EXPECT_OPEN === "1") {
        await expect(
          page.getByRole("button", { name: /Ausstempeln/ }),
        ).toBeVisible();
        await expect(
          page.getByText("Wartet auf Antwort", { exact: true }).first(),
        ).toBeVisible();
      }
      await rangesReady(page);
    },
  );
  await capture(page, "entry");
  await measure(
    "week",
    () => page.getByRole("button", { name: "Vorherige Woche" }).click(),
    async () => {
      await expect(
        page.getByRole("button", { name: "Diese Woche", exact: true }),
      ).toBeEnabled();
      await rangesReady(page);
    },
  );
  await measure(
    "return",
    () =>
      page.getByRole("button", { name: "Diese Woche", exact: true }).click(),
    rangesReady.bind(null, page),
  );
  await measure(
    "month-view",
    () => page.getByRole("button", { name: "Monat", exact: true }).click(),
    async () => {
      await expect(
        page.getByRole("heading", { name: /Monatskarte \w/ }),
      ).toBeVisible();
      await rangesReady(page);
    },
  );
  await capture(page, "month");
  await measure(
    "month",
    () => page.getByRole("button", { name: "Vorheriger Monat" }).click(),
    async () => {
      await expect(
        page.getByRole("button", { name: "Dieser Monat", exact: true }),
      ).toBeEnabled();
      await rangesReady(page);
    },
  );
  if (process.env.PERF_EXERCISE_ACTIONS === "1") {
    const start = page.getByRole("button", {
      name: "Pause starten",
      exact: true,
    });
    const end = page.getByRole("button", {
      name: "Pause beenden",
      exact: true,
    });
    await page
      .getByRole("button", { name: "Dieser Monat", exact: true })
      .click();
    await rangesReady(page);
    try {
      await measure(
        "pause-start",
        async () => {
          await start.click();
          await page
            .getByRole("button", { name: "Starten", exact: true })
            .click();
        },
        async () => {
          await expect(end).toBeEnabled();
        },
      );
      await measure(
        "pause-end",
        () => end.click(),
        async () => {
          await expect(start).toBeEnabled();
        },
      );
      for (const step of ["pause-start", "pause-end"]) {
        expect(
          result[step]?.feature.map((line) => line.split(/\?| \(/)[0]).sort(),
        ).toEqual([
          "GET /api/time-tracking/overview",
          "GET /api/time-tracking/period",
        ]);
      }
    } finally {
      if ((await end.isVisible()) && (await end.isEnabled())) await end.click();
    }
  }

  await info.attach("Zeiterfassung requests", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  if (process.env.PERF_BASELINE !== "1") {
    expect(
      result.entry?.feature.map((line) => line.split(/\?| \(/)[0]).sort(),
    ).toEqual([
      "GET /api/time-tracking/leave-overview",
      "GET /api/time-tracking/overview",
      "GET /api/time-tracking/period",
    ]);
    for (const name of ["week", "month-view", "month"]) {
      expect(result[name]?.feature).toHaveLength(1);
      expect(result[name]?.feature[0]).toMatch(
        /^GET \/api\/time-tracking\/period\?/,
      );
    }
    expect(result.return?.feature.length).toBeLessThanOrEqual(1);
    for (const step of Object.values(result)) {
      for (const request of step.feature) expect(request).toMatch(/\(200\)$/);
    }
  }
});
