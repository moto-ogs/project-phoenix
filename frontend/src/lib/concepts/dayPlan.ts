import { ClockAfternoonIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

/**
 * „Heute“ (#8134): der Betreuungsplan des laufenden Tages. Eine Uhr für das,
 * was gerade dran ist; der ganze Plan direkt darunter trägt den Kalender
 * (`carePlanConcept`). Zwei Kalender untereinander ließen sich in der
 * Seitenleiste nicht unterscheiden. Dasselbe Bild trägt der Hilfe-Artikel zur
 * Seite.
 */
export const dayPlanConcept = defineMotoConcept(
  "dayPlan",
  "Heute",
  ClockAfternoonIcon,
  "indigo",
  "function",
  "planning",
);
