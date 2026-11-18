import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/info-displays`. Nur wenn die Schule die Funktion einschaltet. */
export function infoDisplaysTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadInfoDisplays,
    title: "Ein Info-Display verwalten",
    question: "Wie richte ich einen Bildschirm im Flur ein?",
    summary:
      "Ein Bildschirm im Flur zeigt Raumbelegung, Angebote und Abholzeiten.",
    group: "konfiguration",
    audience: "lead",
    icon: "Monitor",
    steps: [],
    instructionGroups: [
      {
        title: "Ein Display anlegen",
        description:
          "Ein Display lohnt sich dort, wo viele vorbeikommen. Eltern sehen beim Abholen selbst, in welchem Raum die Gruppen gerade sind. Dein Team muss dann nicht jedem einzeln Auskunft geben.",
        steps: [
          "Klappe in der Seitenleiste `Verwaltung` auf.",
          "Öffne `Info-Displays`.",
          "Wähle `Neues Display`.",
          "Trage einen Namen ein, zum Beispiel `Eingang`.",
          "Speichere das Display.",
          "Öffne den Link des Displays auf dem Bildschirm im Flur.",
        ],
      },
    ],
    result: "Der Bildschirm zeigt die Angaben ohne Anmeldung an.",
    notes: [
      "Auf dem Bildschirm stehen nur Anzahlen, Raumnamen und Uhrzeiten. Namen von Kindern erscheinen nicht.",
      "Oben läuft eine Uhr. Bei fehlender Verbindung steht dort, wie alt der Stand ist.",
      "Lege für jeden Bildschirm ein eigenes Display an.",
    ],
    differences: [
      "Fehlt `Info-Displays` in der Seitenleiste? Dann ist die Funktion ausgeschaltet. Schalte sie in den `Einstellungen` unter `Betrieb` bei `Info-Displays nutzen` ein.",
    ],
    troubleshootingDetails: [
      "Der Bildschirm zeigt nichts? Prüfe, ob der Link vollständig geöffnet wurde.",
    ],
    related: [
      HELP_TOPICS.leadDevices,
      HELP_TOPICS.settings,
      HELP_TOPICS.leadParentVisibility,
    ],
  };
}
