import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Arbeitsverträge einer Personalakte (#4706, ADR 0237): Vertrag mit
 * Laufzeit, Soll je Schule und Wochentag, Ferien-Soll je Woche. Die Schulen
 * rechnen in ihrer Zeiterfassung damit.
 */
export function traegerStaffContractsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffContracts,
    title: "Arbeitsvertrag und Soll",
    question: "Wie trage ich Vertrag, Soll und Ferien-Soll ein?",
    summary:
      "Im Arbeitsvertrag stehen die Stunden pro Schule und Wochentag. Die Schulen rechnen damit in ihrer Zeiterfassung.",
    group: "personal",
    audience: "traeger",
    icon: "Hourglass",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Die Person hat eine Personalakte.",
    ],
    instructionGroups: [
      {
        title: "Vertrag anlegen",
        steps: [
          "Öffne die Akte im Reiter `Akten`.",
          "Öffne den Reiter `Verträge und Zeit`.",
          "Wähle bei `Arbeitsverträge` den Knopf `Vertrag anlegen`.",
          "Wähle die Art: `Teilzeit`, `Vollzeit`, `Minijob`, `Übungsleiter` oder `Ehrenamt`.",
          "Wähle den `Ersten Tag`. Den `Letzten Tag` lässt du leer, wenn der Vertrag unbefristet ist.",
          "Trage pro Schule die Stunden von Montag bis Freitag ein. Ein leeres Feld ist ein freier Tag.",
          "Wähle `Vertrag anlegen`.",
        ],
      },
      {
        title: "Soll ändern",
        description:
          "Zum Beispiel, wenn die Person ab dem nächsten Monat mehr Stunden hat.",
        steps: [
          "Wähle beim Vertrag das Menü mit den drei Punkten. Wähle `Soll ändern`.",
          "Wähle bei `Gilt ab` den ersten Tag mit den neuen Stunden.",
          "Ändere die Stunden der Schulen. Wähle `Soll speichern`.",
        ],
      },
      {
        title: "Ferien-Soll eintragen",
        description:
          "Für Ferienwochen mit anderen Stunden, zum Beispiel in der Ferienbetreuung.",
        steps: [
          "Wähle beim Vertrag das Menü. Wähle `Ferien-Soll eintragen`.",
          "Wähle die Schule, die erste und, für mehrere Wochen, die letzte Woche.",
          "Trage die Stunden ein. Wähle `Eintragen`.",
        ],
      },
      {
        title: "Vertrag beenden",
        steps: [
          "Wähle beim Vertrag das Menü. Wähle `Vertrag ändern`.",
          "Wähle den `Letzten Tag`. Wähle `Speichern`.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Schulen rechnen ab dem laufenden Monat mit diesem Soll: im Stundenkonto, bei Krankheit und Urlaub und in der Abrechnung. Feiertage und Schließtage bleiben frei. Die Schule sieht das Soll und kann es nicht mehr ändern.",
    notes: [
      "Abgeschlossene Monate bleiben, wie sie sind. Eine Änderung geht an einer Schule erst ab dem Tag nach ihrem letzten abgeschlossenen Monat.",
      "Den Verlauf des Solls siehst du beim Vertrag unter `Weiteres Soll`.",
      "Eine Person kann mehrere Verträge haben, zum Beispiel Teilzeit an einer Schule und einen Minijob an einer anderen.",
      "Jede Art rechnet der Lohnexport mit eigenen Lohnarten ab. Übungsleiter ist für die Übungsleiterpauschale, Ehrenamt für die Ehrenamtspauschale.",
      "Das Ferien-Soll gilt auch an Schließtagen der Schule. Arbeitet die Person dort nicht, trage für den Tag 0 Stunden ein.",
      "Löschst du einen falschen Vertrag, rechnet die Schule wieder mit ihrem eigenen Soll.",
    ],
    differences: [
      "`Vertrag anlegen` ist grau: Die Person arbeitet an keiner Schule mehr.",
    ],
    troubleshootingDetails: [
      "„Die Schule hat die Zeit davor schon abgerechnet“: Wähle den genannten Tag oder einen späteren.",
      "„An der Schule gilt an diesen Tagen schon ein anderer Arbeitsvertrag“: Beende zuerst den anderen Vertrag.",
      "„Die Schule hat für die Woche schon eine eigene Sonderarbeitszeit“: Frag die Schule, ob sie sie löscht.",
      "„Noch nicht bei … angekommen“: Die Änderung ist gespeichert. Speicherst du später eine weitere Änderung, dann holt moto es nach.",
      "`Vertrag löschen` geht nicht: Der Vertrag hat schon gezählt. Trage stattdessen einen letzten Tag ein.",
    ],
    related: [HELP_TOPICS.traegerStaffRecords],
  };
}
