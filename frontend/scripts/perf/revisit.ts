import {
  devices,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gotoTolerant, PERF_ACTION_TIMEOUT } from "./access";
import {
  armProbe,
  CPU_THROTTLE,
  NETWORK,
  OUT_DIR,
  QUIET,
  readProbe,
  REPEATS,
  requestCost,
} from "./navigation-probe";
import {
  saveObservations,
  writeReport,
  type Observation,
  type Step,
} from "./revisit-report";
import { measurePermissionChange } from "./revisit-permission";
import { measureParentSwitch } from "./revisit-context";
import { routeCatalog } from "./revisit-catalog";
import { RequestRecorder } from "./recorder";
import { openRevisitSession, revisitFixture } from "./revisit-access";
import {
  armContentClock,
  installContentProbe,
  type Content,
} from "./revisit-content";
import { revisitTargets, type Stop, type Journey } from "./revisit-targets";

type Input = "click" | "keyboard" | "touch";
type Session = {
  origin: string;
  state: Awaited<ReturnType<BrowserContext["storageState"]>>;
};

async function ready(page: Page, content: Content) {
  await page.waitForFunction((c) => window.__revisit.matches(c), content, {
    timeout: 30_000,
  });
}

async function navigate(
  page: Page,
  stop: Stop,
  input: Input,
  recorder?: RequestRecorder,
) {
  await stop.prepare?.(page);
  const link = stop.link(page);

  if (recorder) {
    await armProbe(page);
    await armContentClock(
      page,
      stop.content,
      input === "touch"
        ? "touchstart"
        : input === "keyboard"
          ? "keydown"
          : "pointerdown",
    );
    recorder.start();
  }
  if (input === "keyboard") {
    await link.focus();
    await link.press("Enter");
  } else if (input === "touch") await link.tap();
  else await link.click();
}

async function measure(
  page: Page,
  recorder: RequestRecorder,
  stop: Stop,
  input: Input,
  back = 0,
) {
  if (back) {
    await armProbe(page);
    recorder.start();
    await armContentClock(page, stop.content, "history");
    await page.evaluate((delta) => {
      window.__revisit.start();
      history.go(delta);
    }, back);
  } else await navigate(page, stop, input, recorder);
  await page.waitForFunction(
    () => window.__revisit.elapsed !== null,
    undefined,
    { timeout: 30_000 },
  );
  const ms = await page.evaluate(() => Math.round(window.__revisit.elapsed!));
  const settle = await recorder.waitForQuiet(QUIET);
  const records = recorder.records.filter((record) => !record.noise);
  const documents = records.filter(
    (record) => record.resourceType === "document",
  ).length;
  if (documents)
    throw new Error(
      "Dokument-Reload beim Sitzungswechsel: " + stop.content.path,
    );
  return {
    ms,
    ...requestCost(records),
    documents,
    settle,
    loading: (await readProbe(page)).fallbacks.map((label) =>
      label.startsWith("loading:") ? "loading" : label,
    ),
  };
}

async function historyIndex(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & { navigation: { currentEntry: { index: number } } })
        .navigation.currentEntry.index,
  );
}

async function runJourney(
  browser: Browser,
  session: Session,
  journey: Journey,
  mobile: boolean,
) {
  const profile = mobile ? devices["Pixel 7"]! : devices["Desktop Chrome"]!;
  const context = await browser.newContext({
    ...profile,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    storageState: session.state,
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(PERF_ACTION_TIMEOUT);
    await installContentProbe(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      ...NETWORK,
      downloadThroughput: mobile
        ? (1.6 * 1024 * 1024) / 8
        : NETWORK.downloadThroughput,
    });
    const recorder = new RequestRecorder(page);
    const input: Input = mobile
      ? "touch"
      : journey.keyboard
        ? "keyboard"
        : "click";
    let protocol = "";
    const rows: Sample[] = [];
    const visit = async (stop: Stop) => {
      await navigate(page, stop, input);
      await ready(page, stop.content);
    };
    const target = {
      ...journey.target,
      content: { ...journey.target.content },
    };
    const sample = async (step: Step, back = 0) => {
      const result = await measure(page, recorder, target, input, back);
      rows.push({ step, input: back ? "history" : input, protocol, ...result });
    };
    recorder.start();
    await gotoTolerant(
      page,
      new URL(journey.via.entry ?? journey.via.content.path, session.origin)
        .href,
    );
    if (journey.initialSelection) await navigate(page, journey.via, input);
    await ready(page, journey.via.content);
    protocol = await page.evaluate(
      () =>
        (
          performance.getEntriesByType(
            "navigation",
          )[0] as PerformanceNavigationTiming
        ).nextHopProtocol,
    );
    await recorder.waitForQuiet({ quietMs: 3000, capMs: 30000 });
    let documentRequests = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests++;
    });
    if (target.selectContent) target.content = await target.selectContent(page);
    await sample("kalt");
    if (target.content.numericDetail)
      target.content = {
        ...target.content,
        numericDetail: false,
        path: new URL(page.url()).pathname,
      };
    // Warm and Back must restore the same selected entity, not just another
    // populated supervision/group under the same pathname. Keep names in RAM.
    if (target.rememberHeading) {
      const heading = await page
        .locator("main h1")
        .filter({ visible: true })
        .first()
        .innerText();
      target.content.markers = [
        ...target.content.markers,
        { css: "main h1", exact: heading },
      ];
      target.content.query = Object.fromEntries(
        new URL(page.url()).searchParams,
      );
    }
    const excursion = async (stops: Stop[]) => {
      const before = await historyIndex(page);
      recorder.start();
      for (const stop of stops) await visit(stop);
      if ((await recorder.waitForQuiet(QUIET)) !== "quiet")
        throw new Error("Zwischenseite nicht ruhig: " + journey.name);
      return before - (await historyIndex(page));
    };
    await excursion([journey.via]);
    await sample("warm-1");
    if (!journey.inPage) {
      const back = await excursion([journey.backVia ?? journey.via]);
      if (back >= 0) throw new Error("Kein neuer History-Eintrag.");
      await sample("zurück-1", back);
    }
    if (journey.long) {
      const circuit = [...journey.long, journey.via];
      if (
        new Set(circuit.map((stop) => stop.content.path)).size < 4 ||
        circuit.some((stop) => stop.content.path === target.content.path)
      )
        throw new Error("Vier verschiedene Zwischenseiten erforderlich.");
      await excursion(circuit);
      await sample("warm-4");
      const back = await excursion(circuit);
      if (back > -4) throw new Error("Weniger als vier History-Einträge.");
      await sample("zurück-4", back);
    }
    if (documentRequests)
      throw new Error(
        "Dokument-Reload auf einer Zwischen- oder Zielseite: " + journey.name,
      );
    return rows;
  } finally {
    try {
      session.state.cookies = await context.cookies();
    } finally {
      await context.close();
    }
  }
}
type Sample = Awaited<ReturnType<typeof measure>> & {
  step: Step;
  input: Input | "history";
  protocol: string;
};
function cpuTimes() {
  return cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );
}

function idleSince(before: ReturnType<typeof cpuTimes>) {
  const after = cpuTimes();
  return Math.round(
    (100 * (after.idle - before.idle)) / (after.total - before.total),
  );
}

/** Do not begin a timing series while another local build occupies the machine. */
async function initialIdleWindow() {
  for (;;) {
    const before = cpuTimes();
    await delay(5000);
    const idle = idleSince(before);
    if (idle >= 50) return idle;
    console.log("Warte auf eine ruhige Maschine: " + idle + " % CPU frei.");
    await delay(10000);
  }
}

export async function measureRevisits(browser: Browser) {
  const catalogRows = routeCatalog();
  for (const file of ["revisit.json", "revisit.summary.json", "revisit.md"]) {
    rmSync(join(OUT_DIR, file), { force: true });
  }
  writeFileSync(
    join(OUT_DIR, "revisit.catalog.json"),
    JSON.stringify(catalogRows, null, 2) + "\n",
  );
  const fixture = revisitFixture();
  const catalog = revisitTargets(fixture);
  const names = new Set(catalog.map((j) => j.name));
  for (const row of catalogRows) {
    if (
      row.representative !== "–" &&
      row.representative.split(", ").some((n) => !names.has(n))
    )
      throw new Error("Unbekannter Vertreter im Seitenkatalog: " + row.route);
  }
  const selected = process.env.PERF_REVISIT?.trim()
    ? process.env.PERF_REVISIT.split(",").map((s) => s.trim())
    : undefined;
  if (selected?.some((name) => !catalog.some((target) => target.name === name)))
    throw new Error("Unbekanntes PERF_REVISIT-Ziel.");
  const journeys = catalog.filter(
    (target) => !selected || selected.includes(target.name),
  );
  const failures = new Map<string, Error>();
  const roleOrder = new Set(journeys.map((journey) => journey.role));
  const switches: Awaited<ReturnType<typeof measureParentSwitch>>[] = [];
  const results: Observation[] = [];
  let permission: Awaited<ReturnType<typeof measurePermissionChange>> = [];
  const metadata = {
    initialIdlePercent: await initialIdleWindow(),
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    browser: browser.version(),
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    loadStart: loadavg(),
    started: new Date().toISOString(),
    cpuThrottle: CPU_THROTTLE,
    rttMs: NETWORK.latency,
    desktopMbit: 3,
    mobileMbit: 1.6,
    selection: selected ?? "all",
    seed: "vollbetrieb + simulate full-day",
    seedCreatedAt: fixture.seedCreatedAt,
    seedStudents: fixture.seedStudents,
    viewport: {
      desktop: devices["Desktop Chrome"]!.viewport,
      mobile: devices["Pixel 7"]!.viewport,
    },
    uploadMbit: 1,
    applicationTree: execFileSync("git", ["rev-parse", "HEAD:frontend/src"], {
      encoding: "utf8",
    }).trim(),
    dirtyWorktree: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
    ),
    repeats: REPEATS,
  };
  const save = (complete = false) =>
    saveObservations(
      { ...metadata, complete, loadEnd: loadavg(), permission },
      switches,
      results,
    );
  for (const role of roleOrder) {
    const setup = await browser.newContext({
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
    });
    let session: Session;
    try {
      const origin = await openRevisitSession(
        await setup.newPage(),
        role,
        fixture,
      );
      session = { origin, state: await setup.storageState() };
    } finally {
      await setup.close();
    }
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      for (const journey of journeys.filter((target) => target.role === role)) {
        for (const mobile of role === "parents" ? [false, true] : [false]) {
          const profile = mobile ? "Pixel 7" : "Desktop";
          const key = [role, journey.name, profile].join("/");
          if (failures.has(key)) continue;
          console.log(role, journey.name, profile, repeat);
          const load = loadavg();
          const before = cpuTimes();
          let samples: Sample[];
          try {
            samples = await runJourney(browser, session, journey, mobile);
          } catch (cause) {
            failures.set(
              key,
              new Error("Messung fehlgeschlagen: " + key, { cause }),
            );
            console.error("Messung fehlgeschlagen:", key, cause);
            continue;
          }
          const idlePercent = idleSince(before);
          for (const sample of samples)
            results.push({
              ...sample,
              role,
              name: journey.name,
              profile,
              repeat,
              load,
              idlePercent,
              criterion: journey.target.content.criterion,
            });
          save();
        }
      }
    }
  }
  if (roleOrder.has("parents")) {
    permission = await measurePermissionChange(browser, fixture);
    save();
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      for (const mobile of [false, true])
        switches.push(await measureParentSwitch(browser, fixture, mobile));
      save();
    }
  }
  if (failures.size)
    throw new AggregateError(
      [...failures.values()],
      "Keine vollständige Baseline: " + [...failures.keys()].join(", "),
    );
  writeReport(metadata, switches, results, permission);
  save(true);
}
