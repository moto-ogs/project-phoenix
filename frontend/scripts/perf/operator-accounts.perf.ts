import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loginToLocalMfaPortal } from "../../e2e/local-tenant-login";
import { perfPort } from "./access";
import { RequestRecorder } from "./recorder";

test("Operator-Konten: erste Seite und Mehr laden", async ({ page }, info) => {
  const matches = Number(process.env.PERF_ACCOUNTS);
  test.skip(
    !Number.isSafeInteger(matches) || matches < 50,
    "Set PERF_ACCOUNTS to the local fixture size.",
  );
  const email = process.env.OPERATOR_EMAIL;
  const password = process.env.OPERATOR_PASSWORD;
  if (!email || !password)
    throw new Error("The local operator credentials are required.");
  const origin = `http://operator.localhost:${perfPort()}`;
  const baseline = process.env.PERF_BASELINE === "1";
  const sessionFile = process.env.PERF_OPERATOR_SESSION;
  const cookies =
    sessionFile && (await readFile(sessionFile, "utf8").catch(() => null));
  if (cookies) {
    await page
      .context()
      .addCookies(
        JSON.parse(cookies) as Awaited<
          ReturnType<ReturnType<typeof page.context>["cookies"]>
        >,
      );
  } else {
    await loginToLocalMfaPortal(page, origin, { email, password });
    if (sessionFile) {
      await writeFile(
        sessionFile,
        JSON.stringify(await page.context().cookies(origin)),
        { mode: 0o600 },
      );
    }
  }
  const rows = page.locator("table tbody tr");
  const more = page.getByRole("button", { name: "Mehr laden" });

  const open = () =>
    page.goto(`${origin}/accounts`, { waitUntil: "domcontentloaded" });
  await open();
  await expect(rows).toHaveCount(50, { timeout: 45_000 });
  const recorder = new RequestRecorder(page);

  async function measure(
    step: string,
    act: () => Promise<unknown>,
    count: number,
  ) {
    recorder.start();
    const start = performance.now();
    await act();
    await expect(rows).toHaveCount(count, { timeout: 45_000 });
    const visibleMs = Math.round(performance.now() - start);
    expect(await recorder.waitForQuiet({ quietMs: 400, capMs: 20_000 })).toBe(
      "quiet",
    );
    const reads = recorder.records.filter(
      ({ method, path }) =>
        method === "GET" && /^\/api\/operator\/accounts(?:[?]|$)/.test(path),
    );
    expect(reads.every((read) => read.status === 200)).toBe(true);
    const result = {
      step,
      matches,
      visibleMs,
      accountGETs: reads.length,
      accountWireBytes: reads.reduce(
        (total, read) => total + (read.bytes ?? 0),
        0,
      ),
      documentWireBytes:
        recorder.records.find((read) => read.resourceType === "document")
          ?.bytes ?? null,
    };
    console.log(JSON.stringify(result));
    await info.attach(step, {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    return reads;
  }

  const initial = await measure("first-page", open, 50);
  expect(initial).toHaveLength(baseline ? 1 : 0);
  if (matches > 50) {
    const next = await measure(
      "load-more",
      () => more.click(),
      Math.min(100, matches),
    );
    expect(next).toHaveLength(baseline ? 0 : 1);
  } else {
    await expect(more).toHaveCount(0);
  }

  const screenshotDir = process.env.PERF_SCREENSHOT_DIR;
  if (screenshotDir) {
    await open();
    await expect(rows).toHaveCount(50);
    await page.screenshot({
      path: join(screenshotDir, "desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: "Konten", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: join(screenshotDir, "mobile.png"),
      animations: "disabled",
    });
  }

  const started = performance.now();
  const api = await page.request.get(`${origin}/api/operator/accounts`);
  expect(api.status()).toBe(200);
  const body = await api.body();
  const reply = JSON.parse(body.toString()) as {
    data: unknown[];
    pagination?: { total_records: number };
  };
  expect(reply.data).toHaveLength(baseline ? matches : 50);
  if (!baseline) expect(reply.pagination?.total_records).toBe(matches);
  console.log(
    JSON.stringify({
      step: "account-response",
      matches,
      rows: reply.data.length,
      decodedBytes: body.byteLength,
      responseMs: Math.round(performance.now() - started),
    }),
  );
});
