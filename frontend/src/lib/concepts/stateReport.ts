import { ClipboardTextIcon } from "@phosphor-icons/react/ssr";
import { defineMotoConcept } from "./define";

/**
 * Die Tagesmeldung an das Land (#4717): An- und Abwesenheit der Kinder je
 * Tag, wie Mecklenburg-Vorpommern sie von den Trägern verlangt. Das Formular
 * auf dem Klemmbrett steht für die Meldung; der grüne Ton trennt es vom
 * Dienstplan, der dasselbe Symbol in Indigo trägt.
 */
export const stateReportConcept = defineMotoConcept(
  "stateReport",
  "Tagesmeldung",
  ClipboardTextIcon,
  "greenDeep",
  "function",
  "administration",
);
