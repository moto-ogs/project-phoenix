"use client";

import { usePresenceMode } from "~/lib/tenant-context";
import { RoomDetailLoadingPage } from "./page-skeleton";

const ROOM_INFO =
  "Hier siehst du, ob dieser Raum belegt ist. Unter „Kinder im Raum“ stehen die Kinder, die gerade dort sind. Wähle ein Kind, um seine Angaben zu öffnen.";
const ROOM_RECORD_INFO =
  "Hier stehen die Angaben zu diesem Raum. Deine Schule erfasst nicht, welche Kinder in welchem Raum sind.";

/**
 * Route-level loading UI: dasselbe Gerüst, das die Seite zeigt, während der
 * Raum lädt, damit der Wechsel ein durchgehendes Skelett ist.
 */
export default function RoomDetailLoading() {
  const roomInfo =
    usePresenceMode() === "binary" ? ROOM_RECORD_INFO : ROOM_INFO;

  return <RoomDetailLoadingPage info={roomInfo} />;
}
