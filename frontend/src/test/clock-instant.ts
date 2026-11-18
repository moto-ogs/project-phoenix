/**
 * The frozen test instant (#3101), without a Vitest import so the Playwright
 * kit pixel comparison (#6562) runs on the same clock. Tests import it from
 * `~/test/clock`; see the rationale there.
 */
const DEFAULT_TEST_CLOCK_ISO = "2026-09-09T12:00:00+02:00";

/**
 * The early-warning run (`scripts/test-frontend-clocks.sh`, #7296) moves the
 * default instant through `TEST_CLOCK_INSTANT`, an ISO instant with offset.
 * Unset everywhere else, and absent in the browser (Storybook tests).
 */
function configuredInstant(): Date {
  const moved =
    typeof process === "undefined" ? "" : process.env.TEST_CLOCK_INSTANT;
  const instant = new Date(moved ? moved : DEFAULT_TEST_CLOCK_ISO);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`TEST_CLOCK_INSTANT is no ISO instant: ${moved}`);
  }
  return instant;
}

/** The frozen instant every test starts on. */
export const TEST_CLOCK_INSTANT = configuredInstant();

/** The Berlin calendar day of {@link TEST_CLOCK_INSTANT}. */
export const TEST_CLOCK_TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(TEST_CLOCK_INSTANT);

/**
 * The calendar day `days` after {@link TEST_CLOCK_TODAY} (negative: before)
 * as `YYYY-MM-DD`. For fixtures and expectations that must follow the test
 * clock when the early-warning run moves it: `testClockDay(-7)` instead of a
 * literal `"2026-09-02"`. Plain calendar arithmetic, independent of the date
 * helpers under test.
 */
export function testClockDay(days = 0): string {
  const [year = 0, month = 1, day = 1] =
    TEST_CLOCK_TODAY.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
