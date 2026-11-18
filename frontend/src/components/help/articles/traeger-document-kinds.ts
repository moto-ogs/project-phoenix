import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/einstellungen/dokumentarten` (#4688): Rechnung, Gebührenbescheid
 * oder Bestätigung und Rechnung je Leistung; die Rechtsbehelfsbelehrung des
 * Bescheids schreibt der Träger in der Vorlage „Bescheid“.
 */
export function traegerDocumentKindsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerDocumentKinds,
    title: "Rechnung oder Gebührenbescheid",
    question:
      "Wie lege ich fest, ob Familien eine Rechnung oder einen Bescheid bekommen?",
    summary:
      "Je Leistung wählst du das Schreiben: Rechnung, Gebührenbescheid oder bei den Ferien die Bestätigung und Rechnung. Ein Gebührenbescheid braucht deine Rechtsbehelfsbelehrung.",
    group: "konfiguration",
    audience: "traeger",
    icon: "ClipboardList",
    requirements: ["Deine Rolle im Träger-Büro ist Abrechnung."],
    steps: [],
    instructionGroups: [
      {
        title: "Dokumentart wählen",
        description:
          "Ohne deine Wahl bekommen Familien bei den Ferien die Bestätigung und Rechnung und beim Monatsbeitrag eine Rechnung.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen` und dann `Dokumentarten`.",
          "In der Karte `Ferienbetreuung` oder `Monatsbeitrag` wählst du eine Art: `Rechnung`, `Gebührenbescheid` oder `Bestätigung und Rechnung`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Rechtsbehelfsbelehrung eintragen",
        description:
          "Den Text ändert, wer die Rolle `Verwaltung` hat. moto gibt keinen Rechtstext vor.",
        steps: [
          "Wähle auf der Seite `Dokumentarten` in der Karte `Rechtsbehelfsbelehrung` den Knopf `Belehrung eintragen`.",
          "Schreibe den Text in das Feld `Rechtsbehelfsbelehrung`. Nenne Frist, Stelle und Form des Widerspruchs.",
          "Wähle `Vorschau zeigen`. Die Belehrung steht unten im Bescheid.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    result:
      "Die nächste Freigabe stellt die gewählte Art aus. Im Lauf steht sie bei `Dokumentart`. Schon ausgestellte Schreiben bleiben, wie sie sind.",
    notes: [
      "Ein Gebührenbescheid nennt die Bescheidnummer und das Buchungszeichen der Familie. Das Buchungszeichen ist die Debitorennummer.",
      "Ein Storno eines Gebührenbescheids heißt `Aufhebungsbescheid`. Eine Gutschrift heißt `Änderungsbescheid`. Die Nummern kommen aus demselben Nummernkreis.",
      "Änderst du die Dokumentart nach der Prüfung eines Laufs, lehnt moto die Freigabe ab. Lade den Lauf neu und prüfe ihn noch einmal.",
    ],
    troubleshootingDetails: [
      "Statt `Belehrung eintragen` siehst du `Vorlage ansehen`? Dir fehlt die Rolle `Verwaltung`. Frag eine Person mit dieser Rolle, ob sie die Belehrung einträgt.",
      "Im Lauf steht `Rechtsbehelfsbelehrung fehlt` und `Freigeben` geht nicht? Trage die Belehrung in der Vorlage `Gebührenbescheid` ein. Danach kannst du freigeben.",
      "Die Seite `Dokumentarten` fehlt? Dir fehlt die Rolle `Abrechnung`.",
    ],
    related: [
      HELP_TOPICS.traegerDocumentTemplates,
      HELP_TOPICS.traegerBillingRun,
      HELP_TOPICS.traegerCareMonths,
    ],
  };
}
