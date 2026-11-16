import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const temporaryDirectories: string[] = [];

function lintSource(source: string, relativePath = "src/probe.test.ts") {
  const directory = mkdtempSync(join(tmpdir(), "test-clock-"));
  temporaryDirectories.push(directory);
  const sourcePath = join(directory, relativePath);
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, source);

  const result = spawnSync(
    resolve("node_modules/.bin/oxlint"),
    ["-c", resolve(".oxlintrc.json"), sourcePath],
    { encoding: "utf8" },
  );
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

function countReports(output: string): number {
  return output.match(/test-clock\(no-real-clock\)/g)?.length ?? 0;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("test-clock/no-real-clock", () => {
  it("reports vi.useRealTimers() inside a test body, a before hook and a helper", () => {
    const result = lintSource(`
      import { beforeEach, it, vi } from "vitest";

      function resetClock() {
        vi.useRealTimers();
      }

      beforeEach(() => {
        vi.useRealTimers();
      });

      it("drifts back to the host clock", () => {
        vi.useFakeTimers();
        vi.advanceTimersByTime(1000);
        try {
          resetClock();
        } finally {
          vi.useRealTimers();
        }
      });
    `);

    expect(result.status).toBe(1);
    expect(countReports(result.output)).toBe(3);
    expect(result.output).toContain("releaseFakeTimers()");
  });

  it("allows vi.useRealTimers() in afterEach and afterAll cleanup", () => {
    const result = lintSource(`
      import { afterAll, afterEach, describe, vi } from "vitest";

      describe("cleanup", () => {
        afterEach(() => {
          vi.useRealTimers();
        });
      });

      afterAll(() => {
        vi.useRealTimers();
      });
    `);

    expect(result.status).toBe(0);
    expect(countReports(result.output)).toBe(0);
  });

  it("requires a non-empty literal reason for useRealClock()", () => {
    const result = lintSource(`
      import { it } from "vitest";
      import { useRealClock } from "~/test/clock";

      const why = "computed";

      it("declares exceptions", () => {
        useRealClock();
        useRealClock("");
        useRealClock("   ");
        useRealClock(why);
        useRealClock("measures real elapsed time between two fetches");
        useRealClock(\`template literal reason\`);
      });
    `);

    expect(result.status).toBe(1);
    expect(countReports(result.output)).toBe(4);
    expect(result.output).toContain("reviewed reason");
  });

  it("reports host-clock reads and Date replacement", () => {
    const result = lintSource(`
      import { it, vi } from "vitest";

      const RealDate = Date;

      it("escapes the frozen clock", () => {
        const now = vi.getRealSystemTime();
        vi.stubGlobal("Date", RealDate);
        Date = RealDate;
        globalThis.Date = RealDate;
        global.Date = RealDate;
        window.Date = RealDate;
        globalThis["Date"] = RealDate;
        window["Date"] = RealDate;
        Object.defineProperty(globalThis, "Date", { value: RealDate });
        Reflect.defineProperty(global, "Date", { value: RealDate });
        Reflect.set(window, "Date", RealDate);
        vi.stubGlobal("fetch", () => now);
      });
    `);

    expect(result.status).toBe(1);
    expect(countReports(result.output)).toBe(11);
  });

  it("allows assignments to a locally scoped Date binding", () => {
    const result = lintSource(`
      function updateLocalDate(): number {
        let Date = 1;
        Date = 2;
        return Date;
      }

      void updateLocalDate();
    `);

    expect(result.status).toBe(0);
    expect(countReports(result.output)).toBe(0);
  });

  it("accepts the sanctioned clock helpers and fake-timer control", () => {
    const result = lintSource(`
      import { afterEach, it, vi } from "vitest";
      import { releaseFakeTimers, setTestClock } from "~/test/clock";

      afterEach(() => {
        vi.useRealTimers();
      });

      it("moves and releases time on the frozen clock", () => {
        setTestClock("2026-03-29T01:30:00+01:00");
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-29T03:30:00+02:00"));
        vi.advanceTimersByTime(60_000);
        releaseFakeTimers();
        void Date.now();
      });
    `);

    expect(result.status).toBe(0);
    expect(countReports(result.output)).toBe(0);
  });

  it("leaves the clock helper itself alone", () => {
    const result = lintSource(
      `
      import { vi } from "vitest";

      export function useRealClock(reason: string): void {
        if (reason.trim() === "") throw new TypeError("reason");
        vi.useRealTimers();
      }
      `,
      "src/test/clock.ts",
    );

    expect(result.status).toBe(0);
    expect(countReports(result.output)).toBe(0);
  });

  // Playwright specs and stories run outside the Vitest freeze (#7296): the
  // browser, the Next server and the backend keep the host clock there.
  it.each([
    ["a Playwright spec", "e2e/probe.spec.ts", "runToday()"],
    ["a Playwright helper", "e2e/a11y/probe.ts", "runToday()"],
    ["a story", "src/components/probe.stories.tsx", "storyNow()"],
  ])("reports host-clock reads in %s", (_name, path, advice) => {
    const result = lintSource(
      `
      export const today = new Date();
      export const stamp = Date.now();
      export const year = new Date().getFullYear();
      `,
      path,
    );

    expect(result.status).toBe(1);
    expect(countReports(result.output)).toBe(3);
    expect(result.output).toContain(advice);
  });

  it("allows fixed dates and monotonic time in specs and stories", () => {
    for (const path of ["e2e/probe.spec.ts", "src/probe.stories.tsx"]) {
      const result = lintSource(
        `
        export const fixed = new Date("2026-09-09T12:00:00+02:00");
        export const copy = new Date(fixed);
        export const started = performance.now();
        export const parsed = Date.parse("2026-09-09");
        `,
        path,
      );

      expect(result.status).toBe(0);
      expect(countReports(result.output)).toBe(0);
    }
  });

  it("keeps new Date() and Date.now() allowed under the Vitest freeze", () => {
    const result = lintSource(`
      export const today = new Date();
      export const stamp = Date.now();
    `);

    expect(result.status).toBe(0);
    expect(countReports(result.output)).toBe(0);
  });

  it("reports the app's today readers in a spec, not in the run clock helper", () => {
    const source = `
      import { berlinTodayISO, todayISO } from "../src/lib/date-helpers";

      export const berlin = berlinTodayISO();
      export const local = todayISO();
      export const ofInstant = berlinTodayISO(new Date("2026-09-09T12:00:00Z"));
    `;

    const spec = lintSource(source, "e2e/probe.spec.ts");
    expect(spec.status).toBe(1);
    expect(countReports(spec.output)).toBe(2);
    expect(spec.output).toContain("runToday()");

    const helper = lintSource(source, "e2e/clock.ts");
    expect(helper.status).toBe(0);
    expect(countReports(helper.output)).toBe(0);
  });

  it("requires a non-empty literal reason for realClock()", () => {
    const result = lintSource(
      `
      import { realClock } from "./real-clock.mjs";

      const reason = "computed";
      export const a = realClock();
      export const b = realClock("   ");
      export const c = realClock(reason);
      export const d = realClock("Mailpit stempelt Mails mit der Wanduhr");
      `,
      "e2e/probe.ts",
    );

    expect(result.status).toBe(1);
    expect(countReports(result.output)).toBe(3);
    expect(result.output).toContain("realClock()");
  });

  it("leaves the real-clock helper of the specs alone", () => {
    const result = lintSource(
      `
      export function realClock(reason) {
        if (reason.trim() === "") throw new TypeError("reason");
        return Date.now();
      }
      `,
      "e2e/real-clock.mjs",
    );

    expect(result.status).toBe(0);
    expect(countReports(result.output)).toBe(0);
  });
});
