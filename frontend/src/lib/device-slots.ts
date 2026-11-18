/**
 * Geräteplätze einer Schule (#2312): wie viele Geräte die Schule gekauft hat
 * und wie viele ihre registrierten Geräte belegen. Gesperrte Geräte behalten
 * ihren Platz, entfernte geben ihn frei. Solange moto keine Grenze gesetzt
 * hat, ist `booked` null.
 */

import { apiErrorFromResponse, transportFetch } from "./api-error";

/** Antwort von GET /api/iot/device-slots im Backend. */
export interface BackendDeviceSlots {
  readonly device_slots: number | null;
  readonly occupied: number;
  readonly free: number | null;
}

export interface DeviceSlots {
  /** Gekaufte Geräteplätze; null ohne Grenze. */
  readonly booked: number | null;
  /** Registrierte, nicht entfernte Geräte. */
  readonly occupied: number;
  /** Freie Plätze; null ohne Grenze. */
  readonly free: number | null;
}

export function mapDeviceSlots(data: BackendDeviceSlots): DeviceSlots {
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
  const response = await transportFetch("/api/iot/device-slots", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `device slots failed (${response.status})`,
    );
  }
  const json = (await response.json()) as { data: DeviceSlots };
  return json.data;
}
