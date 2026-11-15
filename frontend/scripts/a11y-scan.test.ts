import type { Page, TestInfo } from "@playwright/test";
import type {
  FullConfig,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import A11yReporter from "../e2e/a11y/reporter";
import { A11yRecorder, SCAN_ATTACHMENT } from "../e2e/a11y/scan";

const { analyze } = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("@axe-core/playwright", () => ({
  default: class {
    withTags() {
      return this;
    }
    exclude() {
      return this;
    }
    analyze = analyze;
  },
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  writeFileSync: vi.fn(),
}));

beforeEach(() => {
  analyze.mockReset();
  vi.mocked(writeFileSync).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup() {
  let address = "http://localhost/login";
  const page = {
    isClosed: () => false,
    url: () => address,
    viewportSize: () => ({ width: 1280, height: 720 }),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(null),
  } as unknown as Page;
  const scanned = new Set<string>();
  const recorder = new A11yRecorder(
    { reasons: {}, routes: {} },
    { annotations: [] } as unknown as TestInfo,
    scanned,
  );
  return {
    page,
    recorder,
    scanned,
    navigate: (url: string) => {
      address = url;
    },
  };
}

describe("a11y scan completeness", () => {
  it.each([false, true])(
    "leaves timed-out routes open for a loaded scan (quiet at deadline=%s)",
    async (quietAtDeadline) => {
      vi.useFakeTimers();
      const { page, recorder, scanned } = setup();
      const started = Date.now();
      vi.mocked(page.evaluate).mockImplementation(async () =>
        quietAtDeadline && Date.now() - started >= 9_800
          ? null
          : '<div aria-busy="true">Loading</div>',
      );
      analyze.mockResolvedValue({
        violations: [
          {
            id: "image-alt",
            help: "Images need alternative text",
            helpUrl: "https://example.com/image-alt",
            nodes: [{ target: ["img"] }],
          },
        ],
      });

      const pending = recorder.scan(page);
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;

      expect(recorder.complete).toBe(false);
      expect(recorder.records).toEqual([]);
      expect(scanned.size).toBe(0);
      expect(analyze).not.toHaveBeenCalled();

      vi.mocked(page.evaluate).mockResolvedValue(null);
      const loaded = recorder.scan(page);
      await vi.advanceTimersByTimeAsync(400);
      await loaded;

      expect(recorder.records).toEqual([
        { route: "web /login", counts: { "image-alt": 1 } },
      ]);
      expect(scanned.has("web /login")).toBe(true);
      expect(recorder.failure()).toContain("image-alt");
      expect(recorder.complete).toBe(false);
    },
  );

  it("propagates stable-page scanner failures and keeps the route unmeasured", async () => {
    const { page, recorder, scanned } = setup();
    const error = new Error("axe injection failed");
    analyze.mockRejectedValue(error);

    await expect(recorder.scan(page)).rejects.toBe(error);
    expect(recorder.failure()).toContain("axe injection failed");
    expect(recorder.complete).toBe(false);
    expect(recorder.records).toEqual([]);
    expect(scanned.size).toBe(0);
  });

  it("retries a navigation race and records only the stable destination", async () => {
    const { page, recorder, navigate } = setup();
    analyze
      .mockImplementationOnce(async () => {
        navigate("http://localhost/home");
        throw new Error("execution context destroyed");
      })
      .mockResolvedValue({ violations: [] });

    await recorder.scan(page);

    expect(recorder.complete).toBe(true);
    expect(recorder.records).toEqual([{ route: "web /home", counts: {} }]);
  });

  it("marks exhausted navigation retries incomplete", async () => {
    const { page, recorder, navigate } = setup();
    let navigation = 0;
    analyze.mockImplementation(async () => {
      navigate(`http://localhost/redirect-${++navigation}`);
      return { violations: [] };
    });

    await recorder.scan(page);

    expect(analyze).toHaveBeenCalledTimes(3);
    expect(recorder.complete).toBe(false);
    expect(recorder.records).toEqual([]);
  });
});

describe("a11y baseline shrinking", () => {
  it.each([
    { complete: false, skipped: false },
    { complete: true, skipped: false },
    { complete: false, skipped: true },
    { complete: true, skipped: true },
  ])(
    "requires complete scans and no skipped tests ($complete, $skipped)",
    ({ complete, skipped }) => {
      vi.stubEnv("A11Y_BASELINE_SHRINK", "1");
      vi.spyOn(process, "argv", "get").mockReturnValue([
        "node",
        "playwright",
        "test",
      ]);
      vi.spyOn(console, "log").mockImplementation(() => {});
      const reporter = new A11yReporter();
      reporter.onBegin({ shard: null } as FullConfig);
      for (const report of [
        { complete, records: [], ms: 0, settleMs: 0 },
        {
          complete: true,
          records: [{ route: "web /login", counts: {} }],
          ms: 0,
          settleMs: 0,
        },
      ]) {
        reporter.onTestEnd(
          {} as TestCase,
          {
            status: "passed",
            attachments: [
              {
                name: SCAN_ATTACHMENT,
                body: Buffer.from(JSON.stringify(report)),
              },
            ],
          } as TestResult,
        );
      }
      if (skipped) {
        reporter.onTestEnd(
          {} as TestCase,
          {
            status: "skipped",
            attachments: [],
          } as unknown as TestResult,
        );
      }

      reporter.onEnd({ status: "passed", startTime: new Date(), duration: 0 });

      expect(writeFileSync).toHaveBeenCalledTimes(complete && !skipped ? 1 : 0);
    },
  );
});
