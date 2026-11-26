// Shared by the Arbeitszeitmodell tab and its Sonderarbeitszeiten section.
import { timeTrackingKeys } from "~/lib/swr/portal-keys";

// A model save reprices the admin views, own Dienstplan and own
// Zeiterfassung. SWR prefixes these keys with the school and account.
export function isStaleAfterModelSave(key: unknown): boolean {
  return (
    typeof key === "string" &&
    (key.includes("staff-schedule-targets-") ||
      key.includes("staff-month-summary-") ||
      key.includes("time-tracking-schedule-targets-") ||
      key.includes(timeTrackingKeys.periodFamily) ||
      key.includes(timeTrackingKeys.overviewFamily))
  );
}

const MAX_DAILY_HOURS = 12;
const DECIMAL_HOURS_FORMAT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export type DecimalHoursParseResult =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "valid"; minutes: number };

export function parseDecimalHours(value: string): DecimalHoursParseResult {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return { status: "empty" };
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return { status: "invalid" };
  }

  const [wholePart = "0", fractionPart = ""] = normalized.split(".");
  const scale = 10n ** BigInt(fractionPart.length);
  const decimalUnits =
    BigInt(wholePart || "0") * scale + BigInt(fractionPart || "0");
  if (decimalUnits > BigInt(MAX_DAILY_HOURS) * scale) {
    return { status: "invalid" };
  }
  const minutes = Number((decimalUnits * 60n * 2n + scale) / (scale * 2n));
  return { status: "valid", minutes };
}

export function formatDecimalHours(minutes: number): string {
  return DECIMAL_HOURS_FORMAT.format(minutes / 60);
}
