import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

/**
 * `/umfragen`: Umfragen der Schule an das Team beantworten (#4781). Ob die
 * Umfrage anonym ist, steht vor der ersten Frage.
 */
export function staffSurveysTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.staffSurveys,
    title: "An einer Umfrage im Team teilnehmen",
    question: "Wie beantworte ich eine Umfrage meiner Schule?",
    summary:
      "Deine Schule kann dem Team Fragen stellen. Du antwortest einmal, auf Wunsch der Schule auch anonym.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "CheckSquare",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Umfragen`.",
      "Wähle eine Umfrage mit `Antwort offen`.",
      "Lies oben, ob die Umfrage `Anonym` oder `Nicht anonym` ist.",
      "Beantworte die Fragen. Pflichtfragen sind markiert.",
      "Wähle `Antwort absenden`.",
    ],
    result:
      "Du siehst `Danke, deine Antwort ist gespeichert.` Die Umfrage steht danach mit `Teilgenommen` in der Liste.",
    notes: [
      "`Anonym` heißt: Die Schule sieht nicht, wer was geantwortet hat. Sie sieht nur Summen, erst nach dem Ende und ab 5 Antworten.",
      "`Nicht anonym` heißt: Die Schule sieht deinen Namen bei deinen Antworten.",
      "Nach dem Absenden kannst du deine Antwort nicht mehr ändern.",
      "Die Schule erfährt nie, wer noch nicht teilgenommen hat. Eine Erinnerung geht an alle, die noch offen sind.",
    ],
    differences: [
      "Siehst du die Reiter `Alle Umfragen` und `Für dich`? Dann darfst du Umfragen auch anlegen. Deine eigenen offenen Umfragen stehen unter `Für dich`.",
      "Steht dort `Keine offenen Umfragen`? Dann hat deine Schule gerade keine Umfrage an das Team.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    image: "/help/screens/umfrage-beantworten.webp",
    imageAlt:
      "Fragebogen einer anonymen Umfrage. Oben steht, dass die Schule nicht sieht, wer was geantwortet hat.",
    related: [HELP_TOPICS.teamChat, HELP_TOPICS.leadSurveys],
  };
}
