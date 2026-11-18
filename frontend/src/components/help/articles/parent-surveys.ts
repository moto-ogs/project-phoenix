import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/news`: eine Umfrage mit Fragebogen der OGS beantworten (#4781).
 * Eine Antwort je Elternkonto, nicht je Kind.
 */
export function parentSurveysTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentSurveys,
    title: "An einer Umfrage teilnehmen",
    question: "Was bedeutet eine anonyme Umfrage?",
    summary:
      "Die OGS fragt nach deiner Meinung. Vor der ersten Frage steht, ob die Umfrage anonym ist.",
    group: "nachrichten",
    audience: "parent",
    icon: "CheckSquare",
    steps: [
      "Tippe unten auf `Mehr`.",
      "Wähle `Elternbriefe`.",
      "Tippe unter `Offen` auf den Eintrag mit `Umfrage`.",
      "Lies den Hinweis `Anonym` oder `Nicht anonym`.",
      "Beantworte die Fragen.",
      "Tippe auf `Antwort absenden`.",
    ],
    result:
      "Du siehst `Danke, deine Antwort ist gespeichert.` Der Eintrag steht danach mit `Teilgenommen` unter `Erledigt`.",
    notes: [
      "`Anonym` heißt: Die Schule sieht nicht, wer was geantwortet hat. Sie sieht nur Summen, erst nach dem Ende und ab 5 Antworten.",
      "`Nicht anonym` heißt: Die Schule sieht deinen Namen bei deinen Antworten.",
      "Du antwortest einmal für dein Elternkonto, nicht für jedes Kind.",
      "Nach dem Absenden kannst du deine Antwort nicht mehr ändern.",
    ],
    differences: [
      "Steht dort `Die Teilnahme ist beendet.`? Dann ist die Frist vorbei. Antworten geht nicht mehr.",
    ],
    image: "/help/screens/umfrage-eltern.webp",
    imageAlt:
      "Umfrage im Elternportal. Vor der ersten Frage steht, ob sie anonym ist.",
    related: [HELP_TOPICS.parentNews, HELP_TOPICS.parentNotifications],
  };
}
