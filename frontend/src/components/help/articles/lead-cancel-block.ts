import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Einen einzelnen Termin im Betreuungsplan absagen (#2601, #3731). Ob die
 * Eltern Bescheid bekommen, entscheidet die absagende Person im Dialog; es
 * gibt dafür keine Schuleinstellungen mehr. Beschriftungen live geprüft.
 * Bis zum Ende des Termins lässt sich die Absage zurücknehmen (#7151).
 */
export function leadCancelBlockTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadCancelBlock,
    title: "Einen Termin absagen",
    question: "Wie sage ich einen Termin ab und informiere die Eltern?",
    summary:
      "Ein abgesagter Termin bleibt im Plan sichtbar. Die Eltern der eingetragenen Kinder kannst du dabei gleich informieren.",
    group: "planung",
    audience: "lead",
    icon: "CalendarCheck",
    requirements: ["Du darfst den Betreuungsplan bearbeiten."],
    steps: [
      "Öffne in der Seitenleiste unter `Tagesbetrieb` den `Betreuungsplan`.",
      "Wähle den Termin.",
      "Wähle `Absagen`.",
      "Lass den Haken bei `Eltern per App und E-Mail informieren` gesetzt, wenn die Familien Bescheid bekommen sollen.",
      "Prüfe `Betreff` und `Text an die Eltern`. moto schlägt beides vor.",
      "Wähle `Absagen`.",
    ],
    result:
      "Der Termin ist als abgesagt markiert. Mit Haken bekommen die Familien eine Mitteilung im Elternportal und eine E-Mail.",
    notes: [
      "Der interne Grund der Absage geht nicht an die Eltern. Du siehst nur deinen Text.",
      "Ohne Haken bekommen die Eltern keine Nachricht.",
      "Bis zum Ende des Termins kannst du die Absage zurücknehmen: Termin wählen, dann `Absage zurücknehmen`. Das eingeplante Personal bekommt einen Hinweis „Termin findet doch statt“. Die Eltern bekommen keine Nachricht. Informiere sie bei Bedarf selbst.",
    ],
    differences: [
      "Fehlt der Haken? Dann sind für diesen Termin keine Kinder eingetragen, oder der Termin liegt in der Vergangenheit.",
      "Einzelne Familien haben E-Mails oder Hinweise in ihrem Konto abgeschaltet. Diese Familien sehen die Mitteilung nur im Elternportal.",
    ],
    related: [HELP_TOPICS.leadCarePlan, HELP_TOPICS.leadCalendarPeriods],
  };
}
