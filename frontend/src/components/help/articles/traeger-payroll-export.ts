import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal/lohnexport` (#4712, ADR 0250): die DATEV-Lohndatei über
 * alle Schulen mit eigenen Lohnarten je Art des Vertrags, der Zeitexport als
 * CSV mit seinen festen Spalten und die Lohnarten im Reiter `Lohnarten`.
 */
export function traegerPayrollExportTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerPayrollExport,
    title: "Lohnexport und Zeitexport",
    question: "Wie bekomme ich die Lohndatei für DATEV?",
    summary:
      "Du lädst eine Lohndatei für alle Schulen herunter. Minijob, Übungsleiter und Ehrenamt bekommen eigene Lohnarten.",
    group: "personal",
    audience: "traeger",
    icon: "Download",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Die Personen haben einen Arbeitsvertrag beim Träger und eine Personalnummer.",
    ],
    instructionGroups: [
      {
        title: "Einmal: Lohnarten eintragen",
        steps: [
          "Wähle in der Navigation `Lohnexport` und den Reiter `Lohnarten`.",
          "Trage `Beraternummer` und `Mandantennummer` deines Lohnbüros ein. Lohn und Gehalt braucht sie nicht.",
          "Trage in der Tabelle je Art des Vertrags die Nummer der Lohnart aus deinem DATEV ein.",
          "Wähle bei `Krank`, `Urlaub` und `Fortbildung`, ob DATEV Stunden oder Tage erwartet.",
          "Wähle unten `Speichern`.",
        ],
      },
      {
        title: "Jeden Monat: Lohndatei herunterladen",
        steps: [
          "Wähle den Reiter `Lohndatei`. moto zeigt den letzten Monat.",
          "Wähle das Format: `LODAS` oder `Lohn und Gehalt`.",
          "Prüfe die Zahlen. Steht `Das fehlt noch` da, erledige jeden Punkt.",
          "Wähle `Herunterladen` und gib die Datei an dein Lohnbüro.",
        ],
      },
      {
        title: "Zeiten für dein eigenes System",
        steps: [
          "Wähle den Reiter `Zeitexport` und den Monat.",
          "Wähle `CSV herunterladen`.",
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
      "Ist ein Monat an einer Schule noch offen, warnt moto. Die Werte können sich dann noch ändern. Schließe den Monat vorher im Stundenkonto ab.",
      "Die Spalten des Zeitexports sind fest: Personalnummer, Nachname, Vorname, Datum, Einsatzort, Beginn, Ende, Pause_Minuten, Ist_Minuten, Abwesenheit, Abwesenheitsart. Eine Zeile steht für eine Person an einem Tag an einer Schule.",
      "Die Lohnarten gelten nur für den Träger. Die eigenen Lohnarten einer Schule zählen hier nicht.",
    ],
    differences: [
      "Statt der Zahlen steht `In diesem Monat gilt kein Arbeitsvertrag des Trägers`: Für den Monat gibt es keine Lohndatei des Trägers.",
      "Die Seite zeigt `Diese Funktion ist nicht eingeschaltet`: Personal beim Träger ist noch nicht freigeschaltet. Das moto-Team schaltet es frei. Bis dahin rechnet jede Schule selbst ab.",
    ],
    troubleshootingDetails: [
      "`Herunterladen` ist grau: Unter `Das fehlt noch` steht, was zuerst erledigt sein muss.",
      "„… hat noch keine Personalnummer“: Wähle `Akte öffnen` und trage die Nummer ein.",
      "Ein Wert fehlt in der Tabelle `Nach Art des Vertrags`: Für diese Art fehlt die Lohnart. Trage sie im Reiter `Lohnarten` ein.",
      "Eine Person fehlt im Zeitexport: Sie hat keine Personalnummer. Die Seite nennt sie unter `Nicht in der Datei`.",
    ],
    related: [
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffTimeAccount,
      HELP_TOPICS.traegerStaffRecords,
    ],
  };
}
