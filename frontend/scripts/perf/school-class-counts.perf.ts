import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { loginToLocalMfaPortal } from "../../e2e/local-tenant-login";
import { loadRoleAccess, perfPort } from "./access";
import { RequestRecorder } from "./recorder";

const fixture = process.env.PERF_SCHOOL_FIXTURE;

// The fixture command configures the seeded teacher's assignments in the
// isolated DB and publishes a school-scoped change through the live SSE relay.
test("Deine Klassen: cold start, live refresh and opening a class", async ({
  page,
}, info) => {
  test.skip(!fixture, "Set PERF_SCHOOL_FIXTURE for the school measurement");
  const baseline = process.env.PERF_BASELINE === "1";
  const base = "http://schule.localhost:" + perfPort();
  const cards = page.locator('main a[href*="/klasse?klasse="]');
  const workbook = (path: string) =>
    /^\/api\/school\/class-day\/?\?/.test(path);

  if (!baseline) await page.clock.install();
  execFileSync(fixture!, ["1"]);
  await loginToLocalMfaPortal(page, base, loadRoleAccess("lehrkraft"));
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(/\d+ Kinder/);

  const recorder = new RequestRecorder(page);
  async function record(
    step: string,
    classes: number,
    action: () => Promise<unknown>,
  ) {
    recorder.start();
    const started = Date.now();
    await action();
    expect(await recorder.waitForQuiet({ quietMs: 700, capMs: 20_000 })).toBe(
      "quiet",
    );
    const reads = recorder.records.filter(
      (record) =>
        record.method === "GET" &&
        /^\/api\/school\/class-day(?:[/?]|$)/.test(record.path),
    );
    expect(
      reads.every((record) => record.status === 200 && record.bytes !== null),
    ).toBe(true);
    const result = {
      step,
      classes,
      started,
      ended: Date.now(),
      browserGETs: reads.length,
      wireBytes: reads.reduce((sum, record) => sum + (record.bytes ?? 0), 0),
      paths: reads.map((record) => record.path.split("?")[0]),
    };
    console.log(JSON.stringify(result));
    await info.attach(step + "-" + classes, {
      body: JSON.stringify(result),
      contentType: "application/json",
    });
    return reads;
  }

  for (const classes of [1, 3, 6]) {
    execFileSync(fixture!, [String(classes)]);
    const cold = await record("cold", classes, async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(cards).toHaveCount(classes);
      await expect(cards.last()).toContainText(/\d+ Kinder/);
    });
    expect(cold.filter((read) => workbook(read.path))).toHaveLength(
      baseline ? classes : 0,
    );
    expect(cold).toHaveLength(baseline ? classes : 0);

    const live = await record("sse", classes, async () => {
      const first = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return baseline
          ? workbook(url.pathname + url.search)
          : url.pathname === "/api/school/class-day/assigned-classes";
      });
      // A burst should debounce to one read per reader.
      execFileSync(fixture!, ["event"]);
      execFileSync(fixture!, ["event"]);
      await first;
    });
    expect(live).toHaveLength(baseline ? classes : 1);
  }

  if (!baseline) {
    // A class-assignment change doesn't depend on a child event. The
    // foreground refresh has to replace the class list as well as its totals.
    for (const classes of [3, 6]) {
      execFileSync(fixture!, [String(classes)]);
      await page.clock.fastForward(61_000);
      const refreshed = await record("focus", classes, async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(cards).toHaveCount(classes);
      });
      expect(refreshed).toHaveLength(1);
    }
  }

  const opened = await record("open", 6, async () => {
    await cards.first().click();
    await expect(page).toHaveURL(/\/klasse\?klasse=/);
    await expect(
      page.getByRole("heading", { name: /Bleiben in der Betreuung/ }),
    ).toBeVisible();
  });
  expect(opened.filter((read) => workbook(read.path))).toHaveLength(
    baseline ? 0 : 1,
  );
});
