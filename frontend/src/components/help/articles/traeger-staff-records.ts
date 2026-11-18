import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal` (#4705, ADR 0089): eine Personalakte über alle
 * Schulen. Vorschläge prüfen und verknüpfen, Personalnummer und Bank- und
 * Steuerdaten pflegen, Personal aus einer Datei importieren (#4724), eine
 * neue Person einstellen (#7206), eine Akte auflösen. Nur mit der Rolle Personal und
 * nach der Freigabe „Personal beim Träger“.
 */
export function traegerStaffRecordsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffRecords,
    title: "Personalakten über alle Schulen",
    question: "Wie führe ich eine Person mit einer Akte über alle Schulen?",
    summary:
      "Arbeitet eine Person an mehreren Schulen, führe sie mit einer Akte. Die Akte hat eine Personalnummer und die Bank- und Steuerdaten.",
    group: "personal",
    audience: "traeger",
    icon: "UsersThree",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Das moto-Team hat `Personal beim Träger` für deinen Träger freigeschaltet. Dafür bestätigt dein Träger: Es gibt eine Vereinbarung mit Betriebsrat oder Mitarbeitervertretung, oder es gibt keine Vertretung.",
    ],
    instructionGroups: [
      {
        title: "Einen Vorschlag verknüpfen",
        description:
          "moto schlägt vor, welche Beschäftigungen dieselbe Person sind: zuerst gleiches Konto, dann gleiche Personalnummer, dann gleicher Name und Geburtstag.",
        steps: [
          "Wähle in der Navigation `Personalakten`.",
          "Öffne den Reiter `Vorschläge`.",
          "Wähle einen Vorschlag.",
          "Prüfe, ob es wirklich dieselbe Person ist.",
          "Wähle bei `Welcher Wert gilt?` für jedes Feld den richtigen Wert.",
          "Wähle `Akte anlegen`.",
        ],
      },
      {
        title: "Eine Akte für eine Person anlegen",
        steps: [
          "Öffne den Reiter `Ohne Akte`.",
          "Wähle die Person.",
          "Prüfe die Werte. Wähle `Akte anlegen`.",
        ],
      },
      {
        title: "Eine neue Person einstellen",
        description:
          "Für eine Person, die noch an keiner deiner Schulen arbeitet. moto legt die Akte, den Arbeitsvertrag und an jeder Schule die Person an.",
        steps: [
          "Wähle in der Navigation `Personalakten` und oben `Person einstellen`.",
          "Trage bei `Person` Vorname, Nachname und Geburtsdatum ein. Personalnummer, E-Mail und Telefon kannst du dazu eintragen. Wähle `Weiter`.",
          "Wähle bei `Arbeitsvertrag` die Art und den ersten Tag. Wähle `Weiter`.",
          "Wähle bei `Einsatzorte` jede Schule, an der die Person arbeitet. Trage die Stunden pro Tag ein. Wähle `Weiter`.",
          "Prüfe bei `Prüfen` alle Angaben. Wähle `Person einstellen`.",
          "Die Schule richtet danach Zugang, Transponder und Rolle ein.",
        ],
      },
      {
        title: "Personal aus einer Datei importieren",
        description:
          "Für den Start mit moto: du übernimmst dein Personal aus dem Lohnprogramm oder aus einer Liste. moto erkennt jede Person an der Personalnummer.",
        steps: [
          "Speichere dein Personal als CSV-Datei. Eine Zeile je Person, Überschriften in der ersten Zeile. Pflicht sind Personalnummer, Vorname und Nachname. Eine Vorlage bekommst du mit `Beispieldatei`.",
          "Wähle in der Navigation `Personalakten` und oben `Personal importieren`.",
          "Wähle bei `Datei wählen` deine Datei.",
          "Prüfe bei `Spalten zuordnen`, aus welcher Spalte jedes Feld kommt.",
          "Prüfe bei `Prüfen und übernehmen` jede Zeile. `Zu prüfen` zeigt, warum eine Zeile draußen bleibt.",
          "Wähle unten den grünen Knopf, zum Beispiel `7 Zeilen übernehmen`.",
          "Öffne danach den Reiter `Vorschläge`. Verknüpfe jede neue Akte mit dem Personal der Schulen.",
        ],
      },
      {
        title: "Die Liste der Akten herunterladen",
        steps: [
          "Wähle in der Navigation `Personalakten`.",
          "Wähle oben rechts `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Akten mit Personalnummer und Einsatzorten. Bank- und Steuerdaten stehen nicht darin.",
        ],
      },
      {
        title: "Personalnummer eintragen",
        steps: [
          "Öffne die Akte im Reiter `Akten`.",
          "Wähle bei `Personalnummer` den Knopf `Ändern`.",
          "Trage die Nummer aus deinem Lohnsystem ein. Wähle `Speichern`.",
        ],
      },
      {
        title: "Bank- und Steuerdaten ändern",
        steps: [
          "Öffne die Akte.",
          "Wähle bei `Bank und Steuer` den Knopf `Ändern`.",
          "Trage IBAN, Steuer-ID oder Sozialversicherungsnummer ein. Wähle `Speichern`.",
        ],
      },
      {
        title: "Akte auflösen",
        description:
          "Zum Beispiel, wenn zwei verschiedene Personen verknüpft wurden.",
        steps: [
          "Öffne die Akte.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle `Akte auflösen`.",
          "Bestätige zweimal.",
        ],
      },
    ],
    steps: [],
    result:
      "Die Akte gilt für alle Schulen der Person. Jede Schule sieht die Personalnummer des Trägers und kann sie nicht mehr ändern. Die Bank- und Steuerdaten ziehen von den Schulen in die Akte. Die Schulen sehen nur noch: „führt der Träger“. Planung, Zeiten und Abwesenheiten bleiben an jeder Schule wie bisher. Vertrag und Soll trägst du danach in der Akte ein.",
    notes: [
      "Du kannst dieselbe Datei noch einmal laden. Eine neue Personalnummer wird eine neue Akte. Bei einer bekannten Nummer trägt moto nur fehlende IBAN, Steuer-ID oder SV-Nummer ein. Bestehende Werte ändert der Import nie. Führende Nullen zählen nicht: 00123 und 123 sind dieselbe Nummer.",
      "Eine eingestellte Person hat an der Schule noch keinen Zugang. Die Schule lädt sie ein und gibt ihr eine Rolle. Die E-Mail-Adresse aus dem Formular steht dafür in den Stammdaten der Schule.",
      "Der Import verknüpft keine Akte von selbst mit einer Schule. Das bestätigst du unter `Vorschläge`.",
      "moto bewahrt die Datei nicht auf. Im `Verlauf` jeder Akte stehen Dateiname und Zeile. `Bisherige Importe` zeigt, wer wann welche Datei übernommen hat.",
      "Ein Wert, den du beim Verknüpfen nicht wählst, bleibt mit seiner Schule im `Verlauf` der Akte.",
      "Jede Schule sieht weiter nur ihr eigenes Personal. Sie sieht keine Akte und keine anderen Schulen.",
      "Jedes Anzeigen der Bank- und Steuerdaten steht im Zugriffsprotokoll jeder Schule der Person.",
      "Jeder Download der Liste steht im Zugriffsprotokoll jeder Schule.",
      "Lehrkräfte des Landes und Kräfte anderer Träger bekommen keine Akte. Verknüpfe nur Personen, die dein Träger beschäftigt.",
      "Die Verarbeitung stützt sich auf Art. 6 Abs. 1 lit. b und c DSGVO: dein Träger ist der Arbeitgeber.",
    ],
    differences: [
      "Du siehst nur einen Hinweis, dass Personal beim Träger noch nicht freigeschaltet ist: Frag das moto-Team nach der Freigabe.",
      "Du siehst `Personalakten` nicht in der Navigation: dir fehlt die Rolle `Personal`.",
    ],
    troubleshootingDetails: [
      "Eine Zeile steht bei `Zu prüfen` mit „Passt nicht“: Name, Geburtsdatum oder ein Bankwert weicht von der Akte mit dieser Personalnummer ab. Prüfe die Nummer in der Datei. moto übernimmt die Zeile nicht, damit keine Daten bei der falschen Person landen.",
      "„Die Personalnummer steht mehrmals in der Datei“: Lass jede Nummer nur einmal stehen und lade die Datei noch einmal.",
      "„Seit der Vorschau hat sich etwas an den Personalakten geändert“: Jemand hat gerade eine Akte geändert. Prüfe die Vorschau und übernimm noch einmal.",
      "„Diese Personalnummer ist schon vergeben“: Eine andere Akte oder eine andere Person an einer der Schulen hat die Nummer. Ändere zuerst die andere Nummer.",
      "Nach dem Einstellen steht da „ist nur zum Teil angelegt“: Stelle die Person nicht noch einmal ein. Öffne `Personalakten` und den Reiter `Ohne Akte`. Lege dort die Akte an und trage in der Akte den Vertrag ein.",
      "Beim Einstellen fragt moto `Gibt es diese Person schon?`. Das passiert bei gleichem Namen und Geburtsdatum und bei gleichem Namen ohne Geburtsdatum. Es passiert auch, wenn eine Schule die Person unter derselben E-Mail-Adresse kennt. moto zeigt für jede Person den Grund. Ist es dieselbe Person, wähle bei ihr `Akte anlegen` oder `Akte öffnen`. Sind es zwei Personen, wähle `Trotzdem einstellen`.",
      "„Eine dieser Personen hat schon eine Personalakte“: Lade die Seite neu. Vielleicht hat jemand den Vorschlag gerade verknüpft.",
    ],
    related: [
      HELP_TOPICS.traegerStaffContracts,
      HELP_TOPICS.traegerAccounts,
      HELP_TOPICS.traegerAccessLog,
    ],
  };
}
