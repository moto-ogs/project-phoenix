import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Unfallanzeige (#4771): Unfall am Kind erfassen, unterschreiben, als PDF
 * weitergeben. moto schickt nichts an die Unfallkasse.
 */
export function accidentReportTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadAccidentReport,
    title: "Einen Unfall erfassen",
    question: "Wie erfasse ich einen Unfall und erstelle die Unfallanzeige?",
    summary:
      "Du trägst den Unfall am Kind ein. moto erstellt daraus die Unfallanzeige als PDF.",
    group: "kinderdaten",
    audience: "lead",
    icon: "FirstAid",
    requirements: [
      "Das Recht `Unfälle von Kindern erfassen, Unfallanzeigen ändern, unterschreiben und korrigieren`. Die Leitung hat es immer.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Den Unfall erfassen",
        steps: [
          "Öffne das Kind und wähle den Reiter `Dokumente`.",
          "Wähle `Unfall erfassen`.",
          "Trage ein, wann und wo es passiert ist und was passiert ist.",
          "Trage die Verletzung, die Erste Hilfe und die Aufsichtsperson ein.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Die Unfallanzeige unterschreiben",
        steps: [
          "Die Unfallanzeige öffnet sich nach dem Speichern.",
          "Unterschreibe im Feld `Unterschrift` und wähle `Unterschrift bestätigen`.",
          "Wähle `Unterschreiben`.",
        ],
      },
      {
        title: "Auf Papier unterschreiben",
        steps: [
          "Wähle `PDF herunterladen` und drucke das PDF aus.",
          "Lass es unterschreiben und scanne oder fotografiere es.",
          "Wähle `Unterschriebenes Papierexemplar hochladen`.",
        ],
      },
    ],
    result:
      "Die Unfallanzeige liegt unterschrieben beim Kind unter `Dokumente`. Das PDF gibst du selbst an die Unfallkasse weiter.",
    notes: [
      "Felder, die moto nicht kennt, etwa die Unternehmensnummer, ergänzt du auf dem Ausdruck.",
      "Jedes Erfassen, Ändern und Unterschreiben steht im Änderungsprotokoll des Kindes. Jedes Herunterladen hält moto im Zugriffsprotokoll fest.",
    ],
    differences: [
      "Ist die Unfallanzeige schon unterschrieben, fehlt `Ändern`. Wähle `Korrektur anlegen`. Die alte Fassung bleibt erhalten, die Korrektur wird neu unterschrieben.",
      "Fehlt `Unfall erfassen`? Dann fehlt dir das Recht dafür. Frage die Leitung.",
    ],
    related: [HELP_TOPICS.leadManageStudent],
  };
}
