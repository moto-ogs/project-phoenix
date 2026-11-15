import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal` (#4705, ADR 0089): eine Personalakte über alle
 * Schulen. Vorschläge prüfen und verknüpfen, Personalnummer und Bank- und
 * Steuerdaten pflegen, Personal aus einer Datei importieren (#4724), eine
 * Akte auflösen. Nur mit der Rolle Personal und
 * nach der Freigabe „Personal beim Träger“.
 */
export function traegerStaffRecordsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffRecords,
    title: "Personalakten über alle Schulen",
    question: "Wie führe ich eine Person mit einer Akte über alle Schulen?",
    summary:
      "Arbeitet eine Person an mehreren Schulen, führen Sie sie mit einer Akte. Die Akte hat eine Personalnummer und die Bank- und Steuerdaten.",
    group: "personal",
    audience: "traeger",
    icon: "UsersThree",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Das moto-Team hat `Personal beim Träger` für Ihren Träger freigeschaltet. Dafür bestätigt Ihr Träger: Es gibt eine Vereinbarung mit Betriebsrat oder Mitarbeitervertretung, oder es gibt keine Vertretung.",
    ],
    instructionGroups: [
      {
        title: "Einen Vorschlag verknüpfen",
        description:
          "moto schlägt vor, welche Beschäftigungen dieselbe Person sind: zuerst gleiches Konto, dann gleiche Personalnummer, dann gleicher Name und Geburtstag.",
        steps: [
          "Wählen Sie in der Navigation `Personalakten`.",
          "Öffnen Sie den Reiter `Vorschläge`.",
          "Wählen Sie einen Vorschlag.",
          "Prüfen Sie, ob es wirklich dieselbe Person ist.",
          "Wählen Sie bei `Welcher Wert gilt?` für jedes Feld den richtigen Wert.",
          "Wählen Sie `Akte anlegen`.",
        ],
      },
      {
        title: "Eine Akte für eine Person anlegen",
        steps: [
          "Öffnen Sie den Reiter `Ohne Akte`.",
          "Wählen Sie die Person.",
          "Prüfen Sie die Werte. Wählen Sie `Akte anlegen`.",
        ],
      },
      {
        title: "Personal aus einer Datei importieren",
        description:
          "Für den Start mit moto: Sie übernehmen Ihr Personal aus dem Lohnprogramm oder aus einer Liste. moto erkennt jede Person an der Personalnummer.",
        steps: [
          "Speichern Sie Ihr Personal als CSV-Datei. Eine Zeile je Person, Überschriften in der ersten Zeile. Pflicht sind Personalnummer, Vorname und Nachname. Eine Vorlage bekommen Sie mit `Beispieldatei`.",
          "Wählen Sie in der Navigation `Personalakten` und oben `Personal importieren`.",
          "Wählen Sie bei `Datei wählen` Ihre Datei.",
          "Prüfen Sie bei `Spalten zuordnen`, aus welcher Spalte jedes Feld kommt.",
          "Prüfen Sie bei `Prüfen und übernehmen` jede Zeile. `Zu prüfen` zeigt, warum eine Zeile draußen bleibt.",
          "Wählen Sie unten den grünen Knopf, zum Beispiel `7 Zeilen übernehmen`.",
          "Öffnen Sie danach den Reiter `Vorschläge`. Verknüpfen Sie jede neue Akte mit dem Personal der Schulen.",
        ],
      },
      {
        title: "Die Liste der Akten herunterladen",
        steps: [
          "Wählen Sie in der Navigation `Personalakten`.",
          "Wählen Sie oben rechts `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Akten mit Personalnummer und Einsatzorten. Bank- und Steuerdaten stehen nicht darin.",
        ],
      },
      {
        title: "Personalnummer eintragen",
        steps: [
          "Öffnen Sie die Akte im Reiter `Akten`.",
          "Wählen Sie bei `Personalnummer` den Knopf `Ändern`.",
          "Tragen Sie die Nummer aus Ihrem Lohnsystem ein. Wählen Sie `Speichern`.",
        ],
      },
      {
        title: "Bank- und Steuerdaten ändern",
        steps: [
          "Öffnen Sie die Akte.",
          "Wählen Sie bei `Bank und Steuer` den Knopf `Ändern`.",
          "Tragen Sie IBAN, Steuer-ID oder Sozialversicherungsnummer ein. Wählen Sie `Speichern`.",
        ],
      },
      {
        title: "Akte auflösen",
        description:
          "Zum Beispiel, wenn zwei verschiedene Personen verknüpft wurden.",
        steps: [
          "Öffnen Sie die Akte.",
          "Wählen Sie oben rechts das Menü mit den drei Punkten. Wählen Sie `Akte auflösen`.",
          "Bestätigen Sie zweimal.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Akte gilt für alle Schulen der Person. Jede Schule sieht die Personalnummer des Trägers und kann sie nicht mehr ändern. Die Bank- und Steuerdaten ziehen von den Schulen in die Akte. Die Schulen sehen nur noch: „führt der Träger“. Planung, Zeiten und Abwesenheiten bleiben an jeder Schule wie bisher. Vertrag und Soll tragen Sie danach in der Akte ein.",
    notes: [
      "Sie können dieselbe Datei noch einmal laden. Eine neue Personalnummer wird eine neue Akte. Bei einer bekannten Nummer trägt moto nur fehlende IBAN, Steuer-ID oder SV-Nummer ein. Bestehende Werte ändert der Import nie. Führende Nullen zählen nicht: 00123 und 123 sind dieselbe Nummer.",
      "Der Import verknüpft keine Akte von selbst mit einer Schule. Das bestätigen Sie unter `Vorschläge`.",
      "moto bewahrt die Datei nicht auf. Im `Verlauf` jeder Akte stehen Dateiname und Zeile. `Bisherige Importe` zeigt, wer wann welche Datei übernommen hat.",
      "Ein Wert, den Sie beim Verknüpfen nicht wählen, bleibt mit seiner Schule im `Verlauf` der Akte.",
      "Jede Schule sieht weiter nur ihr eigenes Personal. Sie sieht keine Akte und keine anderen Schulen.",
      "Jedes Anzeigen der Bank- und Steuerdaten steht im Zugriffsprotokoll jeder Schule der Person.",
      "Jeder Download der Liste steht im Zugriffsprotokoll jeder Schule.",
      "Lehrkräfte des Landes und Kräfte anderer Träger bekommen keine Akte. Verknüpfen Sie nur Personen, die Ihr Träger beschäftigt.",
      "Die Verarbeitung stützt sich auf Art. 6 Abs. 1 lit. b und c DSGVO: Ihr Träger ist der Arbeitgeber.",
    ],
    differences: [
      "Sie sehen nur einen Hinweis, dass Personal beim Träger noch nicht freigeschaltet ist: Bitten Sie das moto-Team um die Freigabe.",
      "Sie sehen `Personalakten` nicht in der Navigation: Ihnen fehlt die Rolle `Personal`.",
    ],
    troubleshootingDetails: [
      "Eine Zeile steht bei `Zu prüfen` mit „Passt nicht“: Name, Geburtsdatum oder ein Bankwert weicht von der Akte mit dieser Personalnummer ab. Prüfen Sie die Nummer in der Datei. moto übernimmt die Zeile nicht, damit keine Daten bei der falschen Person landen.",
      "„Die Personalnummer steht mehrmals in der Datei“: Lassen Sie jede Nummer nur einmal stehen und laden Sie die Datei noch einmal.",
      "„Seit der Vorschau hat sich etwas an den Personalakten geändert“: Jemand hat gerade eine Akte geändert. Prüfen Sie die Vorschau und übernehmen Sie noch einmal.",
      "„Diese Personalnummer ist schon vergeben“: Eine andere Akte oder eine andere Person an einer der Schulen hat die Nummer. Ändern Sie zuerst die andere Nummer.",
      "„Eine dieser Personen hat schon eine Personalakte“: Laden Sie die Seite neu. Vielleicht hat jemand den Vorschlag gerade verknüpft.",
    ],
    related: [
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerAccounts,
      HELP_TOPICS.traegerAccessLog,
    ],
  };
}
