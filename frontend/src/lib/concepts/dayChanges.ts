import { CalendarDotIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

/** „Heute anders“ (#7659): was heute anders läuft als geplant. */
export const dayChangesConcept = defineMotoConcept(
  "dayChanges",
  "Heute anders",
  CalendarDotIcon,
  "amber",
  "function",
  "planning",
);
