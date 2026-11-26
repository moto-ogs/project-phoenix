"use client";

import { useMemo } from "react";

import {
  closedRoomsOn,
  fetchRoomClosures,
  type RoomClosure,
} from "~/lib/room-closures-api";
import { useSWRAuth } from "~/lib/swr";
import { roomKeys } from "~/lib/swr/rooms-keys";

const NO_CLOSED_ROOMS: ReadonlyMap<string, RoomClosure> = new Map();

/** The closures of `day`, including whether the first lookup is still pending. */
export function useClosedRoomsOnState(day: string | null | undefined): {
  readonly closedRooms: ReadonlyMap<string, RoomClosure>;
  readonly isLoading: boolean;
  readonly data: readonly RoomClosure[] | undefined;
  readonly error: unknown;
  readonly mutate: () => void;
} {
  const validDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const { data, error, mutate } = useSWRAuth(
    validDay ? roomKeys.closures(validDay, validDay) : null,
    () => fetchRoomClosures(validDay!, validDay!),
  );
  const closedRooms = useMemo(
    () =>
      validDay && Array.isArray(data)
        ? closedRoomsOn(data, validDay)
        : NO_CLOSED_ROOMS,
    [data, validDay],
  );
  return {
    closedRooms,
    isLoading: validDay !== null && data === undefined && error === undefined,
    data,
    error,
    mutate: () => void mutate(),
  };
}

/**
 * Die an `day` gesperrten Räume (#7653), je Raum mit seiner Sperre. Ohne Tag
 * oder solange die Sperren laden, ist kein Raum gesperrt: eine Auswahl bleibt
 * dann bedienbar, und das Backend prüft beim Kiosk selbst.
 */
export function useClosedRoomsOn(
  day: string | null | undefined,
): ReadonlyMap<string, RoomClosure> {
  return useClosedRoomsOnState(day).closedRooms;
}
