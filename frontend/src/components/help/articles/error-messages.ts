import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function errorMessagesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.errorMessages,
    title: "Fehlermeldungen verstehen",
    question: "Was kann ich bei einer Fehlermeldung tun?",
    summary:
      "Hier findest du den nächsten Schritt, wenn moto einen Fehler meldet.",
    group: "probleme",
    audience: "all",
    icon: "ListChecks",
    steps: [],
    instructionGroups: [
      {
        title: "Eingabe prüfen",
        steps: [
          "Prüfe die markierten Felder.",
          "Verbessere die Angaben und versuche es erneut.",
        ],
      },
      {
        title: "Zugriff prüfen",
        steps: [
          "Melde dich erneut an, falls moto dich dazu auffordert.",
          "Fehlt dir weiterhin der Zugriff? Frage deine Ansprechperson.",
        ],
      },
      {
        title: "Vorgang nicht möglich",
        steps: [
          "Lies, warum moto den Vorgang nicht ausführen kann.",
          "Ändere die Angaben oder frage deine Ansprechperson.",
        ],
      },
      {
        title: "Gerade nicht erreichbar",
        steps: [
          "Prüfe deine Internetverbindung.",
          "Tippe auf `Wiederholen`, wenn der Knopf zu sehen ist.",
        ],
      },
      {
        title: "Unerwarteter Fehler",
        steps: [
          "Tippe auf `Wiederholen`, wenn der Knopf zu sehen ist.",
          "Klappt es weiter nicht? Tippe auf die Vorgangskennung und nenne sie dem moto-Team.",
        ],
      },
    ],
    related: [],
  };
}
