// Geräteplätze (#2312): how many devices a school bought. The bound mirrors
// the backend (organizationtenancy.MaxDeviceSlots), so a number the form
// accepts is one the server accepts.

import { formatCount } from "~/lib/format-utils";

export const DEVICE_SLOTS_MAX = 1000;
const WHOLE_NUMBER_RE = /^\d+$/;

export type DeviceSlotsDraft =
  | { readonly ok: true; readonly slots: number }
  | { readonly ok: false; readonly kind: "format"; readonly error: string }
  | {
      readonly ok: false;
      readonly kind: "below";
      readonly slots: number;
      readonly error: string;
    };

/**
 * Checks the typed number against the contract model and the registered
 * devices. A number below them is a warning only: the count on the page can
 * be outdated, the backend refuses a limit below the current devices.
 */
export function validateDeviceSlotsDraft(
  value: string,
  occupied: number,
): DeviceSlotsDraft {
  const trimmed = value.trim();
  if (!WHOLE_NUMBER_RE.test(trimmed) || Number(trimmed) > DEVICE_SLOTS_MAX) {
    return {
      ok: false,
      kind: "format",
      error: `Bitte gib eine ganze Zahl von 0 bis ${DEVICE_SLOTS_MAX} ein.`,
    };
  }
  const slots = Number(trimmed);
  if (slots < occupied) {
    const devices =
      occupied === 1
        ? "1 registriertes Gerät"
        : `${formatCount(occupied)} registrierte Geräte`;
    return {
      ok: false,
      kind: "below",
      slots,
      error: `Die Schule hat ${devices}. Weniger Plätze lehnt moto ab, solange diese Geräte nicht entfernt sind.`,
    };
  }
  return { ok: true, slots };
}
