import { resolveDetailReferrer } from "~/lib/detail-referrer";

/**
 * Der Einstieg „Unterwegs“ auf „Alle Kinder“ (#5026) führt dorthin zurück;
 * jeder andere Rückweg geht zu den Räumen.
 */
export const CHILD_OVERVIEW_PATH = "/students/search";

export function transitDayStatusFromReferrer(
  referrer: string,
): "comes_today" | "not_coming_today" | undefined {
  const dayStatus = new URL(referrer, "https://moto.invalid").searchParams.get(
    "day_status",
  );
  return dayStatus === "comes_today" || dayStatus === "not_coming_today"
    ? dayStatus
    : undefined;
}

export function transitReferrer(candidate: string | null): string {
  return resolveDetailReferrer(candidate, "/rooms", [
    "/rooms",
    CHILD_OVERVIEW_PATH,
  ]);
}
