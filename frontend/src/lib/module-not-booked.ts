import { ApiError } from "~/lib/api-error";
import { isModuleKey, MODULE_LABELS, type ModuleKey } from "~/lib/modules";

/** Die Erklärung für Personen mit und ohne Leitungsrolle. */
export function moduleNotBookedExplanation(
  module: ModuleKey,
  leadsSchool: boolean,
): string {
  const label = MODULE_LABELS[module];
  return leadsSchool
    ? `Diese Seite gehört zum Modul ${label}. Deine Schule hat es nicht gebucht. Für eine Buchung wende dich an das moto-Team.`
    : `Diese Seite gehört zum Modul ${label}. Deine Schule nutzt es nicht. Wenn du es brauchst, sprich mit deiner Leitung.`;
}

/**
 * The module a request was refused for because the school did not book it
 * (`module.not_booked`, #4893), or `null` for every other failure. The
 * backend names the module key in `details.module`.
 */
export function isModuleNotBooked(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "module.not_booked";
}

export async function notBookedModuleOf(
  error: unknown,
): Promise<ModuleKey | null> {
  if (!isModuleNotBooked(error)) return null;
  const { ModuleNotBookedDetailsSchema } =
    await import("~/lib/contract/problem-details.generated");
  const decoded = ModuleNotBookedDetailsSchema.safeParse(error.details);
  const key = decoded.success ? decoded.data.module : undefined;
  return isModuleKey(key) ? key : null;
}

/**
 * The event of `announceModuleBookingStale`. The team portal reloads its
 * school data on it, the Träger portal the frame with its booked modules
 * (#6052).
 */
export const MODULE_BOOKING_STALE_EVENT = "phoenix:tenant-settings-stale";

/**
 * The backend refused a module the navigation still showed as booked: the
 * moto team changed the booking since the school data was loaded. Reload it,
 * so navigation and the page explanation follow without a reload (#4894).
 */
export function announceModuleBookingStale(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MODULE_BOOKING_STALE_EVENT));
}
