import { expect, test } from "@playwright/test";
import { perfPort } from "./access";
import { RequestRecorder } from "./recorder";

// A real local caterer with PERF_SCHOOLS live supplies. No session or response
// body is written to the report. One warm-up leaves the Next dev compilation
// out of the cold document / empty browser-cache measurement.
test("Bestellsummen und erste geöffnete Schule", async ({ page }, info) => {
  test.skip(
    !process.env.PERF_SCHOOLS,
    "Set PERF_SCHOOLS for the caterer measurement",
  );
  const base = `http://caterer.localhost:${perfPort()}`;
  const email = process.env.PERF_CATERER_EMAIL;
  const password = process.env.PERF_CATERER_PASSWORD;
  const schools = Number(process.env.PERF_SCHOOLS);
  if (!email || !password || !Number.isSafeInteger(schools) || schools < 1)
    throw new Error(
      "Set PERF_CATERER_EMAIL, PERF_CATERER_PASSWORD and PERF_SCHOOLS",
    );
  const login = await page.request.post(`${base}/api/caterer/auth/login`, {
    data: { email, password },
    headers: { Origin: base },
  });
  expect(login.status()).toBe(200);
  const table = page.getByRole("table").first();
  const totals = table
    .locator("tbody tr td:last-child")
    .filter({ hasText: /^\d+$/ });
  const ready = () =>
    expect(totals).toHaveCount(schools + Number(schools > 1), {
      timeout: 45_000,
    });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await ready();
  const recorder = new RequestRecorder(page);
  const baseline = process.env.PERF_BASELINE === "1";
  async function measure(
    step: string,
    act: () => Promise<unknown>,
    visible: () => Promise<void>,
  ) {
    const started = Date.now();
    recorder.start();
    await act();
    await visible();
    const visibleMs = Date.now() - started;
    expect(await recorder.waitForQuiet({ quietMs: 500, capMs: 20_000 })).toBe(
      "quiet",
    );
    const feature = recorder.records.filter(
      (r) =>
        r.method === "GET" && /^\/api\/caterer\/schools(?:[/?]|$)/.test(r.path),
    );
    expect(feature.every((r) => r.status === 200)).toBe(true);
    const result = {
      step,
      schools,
      started,
      visibleMs,
      browserGETs: feature.length,
      wireBytes: feature.reduce((n, r) => n + (r.bytes ?? 0), 0),
      paths: feature.map((r) => r.path),
    };
    console.log(JSON.stringify(result));
    await info.attach(step, {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    return feature;
  }
  const cold = await measure(
    "cold",
    () => page.reload({ waitUntil: "commit" }),
    ready,
  );
  expect(cold).toHaveLength(0); // Both versions seed the first document on the server.
  const next = page.getByRole("button", { name: "Morgen", exact: true });
  const window = await measure(
    "window",
    () => next.click(),
    async () => {
      await expect(table.getByRole("columnheader")).toHaveCount(3);
      await ready();
    },
  );
  expect(window).toHaveLength(baseline ? schools : 1);
  const expand = page.getByRole("button", { name: / ausklappen$/ }).first();
  const details = page.getByRole("table").nth(1);
  const first = await measure(
    "expand",
    () => expand.click(),
    () => expect(details).toBeVisible(),
  );
  expect(first).toHaveLength(baseline ? 0 : 1);
  const directory = process.env.PERF_SCREENSHOT_DIR;
  if (directory) {
    for (const [viewport, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `${directory}/${viewport}.png`,
        animations: "disabled",
      });
    }
  }
});
