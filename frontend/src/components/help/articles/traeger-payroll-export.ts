import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal/lohnexport` (#4712, ADR 0249): die DATEV-Lohndatei über
 * alle Schulen mit eigenen Lohnarten je Art des Vertrags, der Zeitexport als
 * CSV mit seinen festen Spalten und die Lohnarten im Reiter `Lohnarten`.
 */
export function traegerPayrollExportTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerPayrollExport,
    title: "Lohnexport und Zeitexport",
    question: "Wie bekomme ich die Lohndatei für DATEV?",
    summary:
      "Sie laden eine Lohndatei für alle Schulen herunter. Minijob, Übungsleiter und Ehrenamt bekommen eigene Lohnarten.",
    group: "personal",
    audience: "traeger",
    icon: "Download",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Die Personen haben einen Arbeitsvertrag beim Träger und eine Personalnummer.",
    ],
    instructionGroups: [
      {
        title: "Einmal: Lohnarten eintragen",
        steps: [
          "Wählen Sie in der Navigation `Lohnexport` und den Reiter `Lohnarten`.",
          "Tragen Sie `Beraternummer` und `Mandantennummer` Ihres Lohnbüros ein. Lohn und Gehalt braucht sie nicht.",
          "Tragen Sie in der Tabelle je Art des Vertrags die Nummer der Lohnart aus Ihrem DATEV ein.",
          "Wählen Sie bei `Krank`, `Urlaub` und `Fortbildung`, ob DATEV Stunden oder Tage erwartet.",
          "Wählen Sie unten `Speichern`.",
        ],
      },
      {
        title: "Jeden Monat: Lohndatei herunterladen",
        steps: [
          "Wählen Sie den Reiter `Lohndatei`. moto zeigt den letzten Monat.",
          "Wählen Sie das Format: `LODAS` oder `Lohn und Gehalt`.",
          "Prüfen Sie die Zahlen. Steht `Das fehlt noch` da, erledigen Sie jeden Punkt.",
          "Wählen Sie `Herunterladen` und geben Sie die Datei an Ihr Lohnbüro.",
        ],
      },
      {
        title: "Zeiten für Ihr eigenes System",
        steps: [
          "Wählen Sie den Reiter `Zeitexport` und den Monat.",
          "Wählen Sie `CSV herunterladen`.",
          "Unter `Spalten der Datei` steht, was jede Spalte enthält.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Lohndatei enthält jeden Vertrag beim Träger, an allen Schulen zusammengezählt. Jeder Download steht im Zugriffsprotokoll jeder Schule.",
    notes: [
      "Hat eine Person zwei Verträge verschiedener Art, etwa Teilzeit und Übungsleiter, stehen beide getrennt in der Datei.",
      "Personen ohne Vertrag beim Träger rechnet weiter jede Schule selbst ab.",
      "Wechselt der Vertrag einer Person im Monat an einer Schule, rechnet der neuere Vertrag den ganzen Monat dort ab. Die Seite nennt die Person unter `Vertragswechsel in diesem Monat`.",
      "Ist ein Monat an einer Schule noch offen, warnt moto. Die Werte können sich dann noch ändern. Schließen Sie den Monat vorher im Stundenkonto ab.",
      "Die Spalten des Zeitexports sind fest: Personalnummer, Nachname, Vorname, Datum, Einsatzort, Beginn, Ende, Pause_Minuten, Ist_Minuten, Abwesenheit, Abwesenheitsart. Eine Zeile steht für eine Person an einem Tag an einer Schule.",
      "Die Lohnarten gelten nur für den Träger. Die eigenen Lohnarten einer Schule zählen hier nicht.",
    ],
    differences: [
      "Statt der Zahlen steht `In diesem Monat gilt kein Arbeitsvertrag des Trägers`: Für den Monat gibt es keine Lohndatei des Trägers.",
      "`Personal beim Träger ist noch nicht freigeschaltet`: Das moto-Team schaltet es frei. Bis dahin rechnet jede Schule selbst ab.",
    ],
    troubleshootingDetails: [
      "`Herunterladen` ist grau: Unter `Das fehlt noch` steht, was zuerst erledigt sein muss.",
      "„… hat noch keine Personalnummer“: Wählen Sie `Akte öffnen` und tragen Sie die Nummer ein.",
      "Ein Wert fehlt in der Tabelle `Nach Art des Vertrags`: Für diese Art fehlt die Lohnart. Tragen Sie sie im Reiter `Lohnarten` ein.",
      "Eine Person fehlt im Zeitexport: Sie hat keine Personalnummer. Die Seite nennt sie unter `Nicht in der Datei`.",
    ],
    related: [
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffTimeAccount,
      HELP_TOPICS.traegerStaffRecords,
    ],
  };
}
