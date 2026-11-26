import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal/lohnexport` (#4712, ADR 0250; #8041, ADR 0320): die
 * DATEV-Lohndatei über alle Schulen mit eigenen Lohnarten je Art des
 * Vertrags, als eine Datei für den ganzen Träger oder als eine Datei je
 * Arbeitgeber, der Zeitexport als CSV mit seinen festen Spalten und die
 * Einrichtung im Reiter `Einrichtung`.
 */
export function traegerPayrollExportTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerPayrollExport,
    title: "Lohnexport und Zeitexport",
    question: "Wie bekomme ich die Lohndatei für DATEV?",
    summary:
      "Du lädst die Lohndatei für alle Schulen herunter. Stellt eine Gemeinde oder ein Schulträger an, wählst du eine Datei oder eine pro Arbeitgeber.",
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
          "Wähle in der Navigation `Lohnexport` und den Reiter `Einrichtung`.",
          "Trage bei `DATEV-Mandant des Trägers` die `Beraternummer` und `Mandantennummer` deines Lohnbüros ein. Lohn und Gehalt braucht sie nur bei einer Datei pro Arbeitgeber.",
          "Trage in der Tabelle pro Art des Vertrags die Nummer der Lohnart aus deinem DATEV ein. Sie gilt für alle Arbeitgeber.",
          "Wähle bei `Krank`, `Urlaub` und `Fortbildung`, ob DATEV Stunden oder Tage erwartet.",
          "Wähle unten `Speichern`.",
        ],
      },
      {
        title: "Fall 1: Eine Datei für den ganzen Träger",
        description:
          "Für Träger, deren Lohnbüro alle Personen unter einem DATEV-Mandanten abrechnet, auch das Personal einer Gemeinde oder eines Schulträgers.",
        steps: [
          "Wähle im Reiter `Einrichtung` bei `Wie viele Lohndateien?` die Form `Eine Datei für den ganzen Träger`.",
          "Stellt an einer Schule eine Gemeinde oder ein Schulträger an, steht sie unter `Andere Arbeitgeber`. Trage dort ihre `Kostenstelle` ein.",
          "Wähle unten `Speichern`.",
          "Wähle den Reiter `Lohndatei`, prüfe die Zahlen und wähle `Herunterladen`.",
        ],
      },
      {
        title: "Fall 2: Eine Datei pro Arbeitgeber",
        description:
          "Für Träger, bei denen jede Gemeinde und jeder Schulträger ein eigener DATEV-Mandant ist.",
        steps: [
          "Wähle im Reiter `Einrichtung` bei `Wie viele Lohndateien?` die Form `Eine Datei pro Arbeitgeber`.",
          "Trage unter `Andere Arbeitgeber` pro Gemeinde und Schulträger die `Beraternummer` und die `Mandantennummer` ein. Die Nummern bekommst du vom Lohnbüro des Arbeitgebers.",
          "Wähle unten `Speichern`.",
          "Hat eine Person bei einer Gemeinde eine andere Personalnummer als beim Träger: Öffne ihre Personalakte, wähle bei `Personalnummer` den Knopf `Bearbeiten` und trage die Nummer bei der Gemeinde ein.",
          "Wähle den Reiter `Lohndatei`. Unter `Dateien pro Arbeitgeber` steht jede Datei mit ihren Schulen. Wähle bei jeder Datei `Herunterladen`.",
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
      "Die Lohndatei enthält jeden Vertrag beim Träger, an allen Schulen zusammengezählt. Arbeitet eine Person bei zwei Arbeitgebern, stehen ihre Stunden getrennt: mit Kostenstelle oder in zwei Dateien. Jeder Download steht im Zugriffsprotokoll jeder Schule.",
    notes: [
      "Wer an einer Schule das Personal anstellt, legst du unter `Einstellungen` > `Zuständigkeiten` fest. Ohne Angaben der Gemeinde oder des Schulträgers stellt der Träger an.",
      "Personen aus dem Vertretungspool stellt immer der Träger an.",
      "Haben zwei Gemeinden dieselbe Berater- und Mandantennummer, stehen sie in einer Datei.",
      "Ohne eigene Nummer bei einer Gemeinde gilt die Personalnummer des Trägers. Die eine Datei für den ganzen Träger nutzt immer die Nummer des Trägers.",
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
      "Unter `Andere Arbeitgeber` steht `An allen Schulen stellt der Träger das Personal an`: Keine Schule hat eine Gemeinde oder einen Schulträger als Arbeitgeber. Dann gibt es nur die Datei des Trägers.",
    ],
    troubleshootingDetails: [
      "`Herunterladen` ist grau: Unter `Das fehlt noch` steht, was zuerst erledigt sein muss.",
      "„… hat noch keine Personalnummer“: Wähle `Akte öffnen` und trage die Nummer ein.",
      "„Für … fehlt die Kostenstelle“ oder „Für … fehlen Berater- und Mandantennummer“: Wähle `Einrichtung öffnen` und trage die Werte unter `Andere Arbeitgeber` ein.",
      "„… haben in der Datei für … dieselbe Personalnummer“: DATEV würde beide Personen als eine buchen. Gib einer von beiden ihre Nummer bei diesem Arbeitgeber.",
      "„… stünde in der Datei für … unter zwei Personalnummern“: Die Person arbeitet an zwei Schulen desselben Arbeitgebers, die Nummer bei ihm steht aber nur an einer. Trag sie in der Personalakte bei beiden ein.",
      "Unter `In mehreren Dateien` steht eine Person: Sie arbeitet bei zwei Arbeitgebern. Prüfe mit beiden Lohnbüros, ob ihre Personalnummer stimmt.",
      "Ein Wert fehlt in der Tabelle `Nach Art des Vertrags`: Für diese Art fehlt die Lohnart. Trage sie im Reiter `Einrichtung` ein.",
      "Eine Person fehlt im Zeitexport: Sie hat keine Personalnummer. Die Seite nennt sie unter `Nicht in der Datei`.",
    ],
    related: [
      HELP_TOPICS.traegerResponsibilities,
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerStaffTimeAccount,
      HELP_TOPICS.traegerStaffRecords,
    ],
  };
}
