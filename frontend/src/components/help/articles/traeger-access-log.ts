import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/einstellungen/zugriffsprotokoll` (#4655): wer an den Schulen Daten gelesen oder geändert hat. */
export function traegerAccessLogTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerAccessLog,
    title: "Zugriffsprotokoll lesen",
    question: "Wie sehe ich, wer Daten gelesen oder geändert hat?",
    summary:
      "Das Zugriffsprotokoll zeigt, wer an deinen Schulen Daten von Kindern, Eltern oder Personal gelesen oder geändert hat.",
    group: "auswertung",
    audience: "traeger",
    icon: "ShieldCheck",
    requirements: [
      "Du hast im Träger-Büro die Rolle Verwaltung. Nur diese Rolle darf das Protokoll lesen.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Protokoll ansehen",
        steps: [
          "Melde dich im Träger-Portal an.",
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Zugriffsprotokoll`.",
          "Wähle den Zeitraum. Am Anfang sind es die letzten 30 Tage.",
          "Wähle bei Bedarf eine Schule und eine Person.",
          "Wähle `Gelesen` oder `Geändert`, wenn du nur eine Art sehen möchtest.",
          "Gibt es mehr Einträge? Wähle unten `Weitere Einträge laden`.",
        ],
      },
      {
        title: "Herunterladen",
        description: "Für einen Nachweis, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Stelle die Filter ein.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "moto lädt eine Datei mit allen Einträgen zu den Filtern herunter.",
        ],
      },
    ],
    result:
      "Jede Zeile zeigt Zeitpunkt, Person, Schule, Art und welche Daten es waren.",
    notes: [
      "Auch dein Lesen steht im Protokoll. Die Schule sieht so, dass das Träger-Büro hineingeschaut hat.",
      "Auch Ferienanmeldungen stehen im Protokoll. Das ist jedes Öffnen einer Anmeldung oder eines Nachweises, jeder Export und jede Änderung. Bei Schule steht dann `Träger (keine Schule)`.",
      "Löscht moto eine Ferienanmeldung, löscht es auch ihre Einträge im Protokoll. Nach dem Ende der Ferien löscht moto alle Einträge zu diesen Ferien.",
    ],
    differences: [
      "Auf dem Handy steht `Zugriffsprotokoll` in den Einstellungen unter `Mehr`.",
      "Du siehst in den Einstellungen kein `Zugriffsprotokoll`? Dann hat deine Rolle kein Recht dazu.",
      "Steht bei Person `Unbekannte Person`? Zu diesem Konto kennt moto an der Schule keinen Namen, zum Beispiel bei Eltern.",
    ],
    troubleshootingDetails: [
      "moto sagt, der Export habe zu viele Einträge? Wähle einen kürzeren Zeitraum oder eine Schule.",
      "Du brauchst das Recht für dein Konto? Wende dich an das moto-Team.",
    ],
    related: [HELP_TOPICS.traegerLogin],
  };
}
