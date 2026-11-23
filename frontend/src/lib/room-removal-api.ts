import { bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type { RoomRemovalImpactResponse } from "./contract/rooms.generated";

/** Was das Entfernen eines Raums bewirkt (#6845). */
export type RoomRemovalOutcome = "delete" | "archive" | "blocked";

const OUTCOMES: readonly RoomRemovalOutcome[] = [
  "delete",
  "archive",
  "blocked",
];

export type RoomRemovalImpact = Omit<RoomRemovalImpactResponse, "outcome"> & {
  readonly outcome: RoomRemovalOutcome;
};

/** Was das Entfernen bewirken würde; ein unbekanntes Ergebnis sperrt es. */
export async function fetchRoomRemovalImpact(
  roomId: string,
): Promise<RoomRemovalImpact> {
  const impact = await bffJson("tenant", "GET /api/rooms/{id}/removal-impact", {
    params: { id: roomId },
  });
  return {
    ...impact,
    outcome: knownEnum(OUTCOMES, impact.outcome) ?? "blocked",
  };
}

/**
 * Löscht oder archiviert den Raum, wie die bestätigte Vorschau es sagt: ihr
 * `fingerprint` reist mit, und der Server lehnt ab, wenn sich der Raum seither
 * geändert hat (ADR 0311). Das Ergebnis sagt, was geschah.
 */
export async function removeRoom(
  roomId: string,
  fingerprint: string,
): Promise<Exclude<RoomRemovalOutcome, "blocked">> {
  const result = await bffJson("tenant", "DELETE /api/rooms/{id}", {
    params: { id: roomId },
    body: { expected_fingerprint: fingerprint },
  });
  return result.outcome === "archive" ? "archive" : "delete";
}
