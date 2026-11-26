import { DoorOpenIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

// Ein offener Raum ist dauerhaft freigegeben (CONTEXT.md, #3065): die offene
// Tür steht für die Freigabe, nicht für einen leeren Raum. Blau wie das
// Abzeichen „Offener Raum“ der Aufsichtsansicht. Die geschlossene Tür der
// übrigen Räume ist `roomsConcept` (#8130).
export const openRoomsConcept = defineMotoConcept(
  "openRooms",
  "Offene Räume",
  DoorOpenIcon,
  "blue",
  "status",
  "presence",
);
