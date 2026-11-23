/**
 * Geräteplätze einer Schule (#2312): wie viele Geräte die Schule gekauft hat
 * und wie viele ihre registrierten Geräte belegen. Gesperrte Geräte behalten
 * ihren Platz, entfernte geben ihn frei. Solange moto keine Grenze gesetzt
 * hat, ist `booked` null.
 */

import { bffJson } from "./bff-fetch";
import type * as iotContract from "./contract/iot.generated";

export interface DeviceSlots {
  /** Gekaufte Geräteplätze; null ohne Grenze. */
  readonly booked: number | null;
  /** Registrierte, nicht entfernte Geräte. */
  readonly occupied: number;
  /** Freie Plätze; null ohne Grenze. */
  readonly free: number | null;
}

export function mapDeviceSlots(
  data: iotContract.DeviceSlotsResponse,
): DeviceSlots {
  return {
    booked: data.device_slots ?? null,
    occupied: data.occupied,
    free: data.free ?? null,
  };
}

/** Alle Plätze belegt: ein weiteres Gerät lehnt das Backend ab. */
export function deviceSlotsFull(slots: {
  readonly booked: number | null;
  readonly occupied: number;
}): boolean {
  return slots.booked !== null && slots.occupied >= slots.booked;
}

/** Freie Plätze, nie unter null; null ohne Grenze. */
export function freeDeviceSlots(
  booked: number | null,
  occupied: number,
): number | null {
  return booked === null ? null : Math.max(booked - occupied, 0);
}

export async function fetchDeviceSlots(): Promise<DeviceSlots> {
  return mapDeviceSlots(
    await bffJson("tenant", "GET /api/iot/device-slots", {
      errorMessage: "device slots failed",
    }),
  );
}
