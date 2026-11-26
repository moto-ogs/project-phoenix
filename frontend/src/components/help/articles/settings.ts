import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/settings`. Die Bereiche kommen aus dem Schema des Servers und sind je Schule
 * verschieden (settings/page.tsx:32) -- deshalb nennt der Artikel keine feste
 * Liste, sondern den Weg und die Regeln. Die wichtigsten Einstellungen stehen
 * in `settingsGuideTopic`.
 */
export function settingsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.settings,
    title: "Den Betrieb der OGS einstellen",
    question: "Wo stelle ich ein, wie unsere OGS arbeitet?",
    summary: "Die Einstellungen steuern Anwesenheit, Funktionen und Abläufe.",
    group: "konfiguration",
    audience: "lead",
    icon: "Settings",
    steps: [
      "Wähle unten in der Seitenleiste `Einstellungen`.",
      "Die Seitenleiste zeigt jetzt die Bereiche. Wähle einen Bereich. Am Handy stehen sie unten, ein Teil davon hinter `Mehr`.",
      "Ändere die gewünschte Einstellung.",
      "Mit `Zurück zur App` kommst du wieder zur Seite, auf der du vorher warst.",
    ],
    result: "Die Änderung gilt sofort für alle in deiner OGS.",
    notes: [
      "Oben steht, wie viele Einstellungen dieses Bereichs von der Vorgabe abweichen.",
      "Jede Einstellung hat einen Satz darunter, der sagt, was sie bewirkt.",
      "Unter `Datenschutz` kannst du die `Nutzungsanalyse` ausschalten. Dann erhält moto keine Nutzungsstatistiken deiner Schule mehr.",
      "Damit enden auch Sitzungsaufzeichnungen. Die Fehlerdiagnose bleibt davon getrennt.",
      "Unter `Datenschutz` siehst du die Löschfristen. Sie zeigen, wie lange moto Daten aufbewahrt.",
      "moto legt die Löschfristen mit deiner Schule fest. Du kannst sie nur lesen.",
      "Eine Ausnahme ist `Erziehungsberechtigte ohne Kind aufbewahren (Tage)`. Diese Frist stellst du selbst ein, zwischen 30 und 365 Tagen. Sie beginnt erst, wenn das letzte Kind der Person gelöscht ist.",
      "Unter `Betrieb` trägst du das `Bundesland` deiner Schule ein. Danach richten sich die gesetzlichen Feiertage.",
      "Ohne Bundesland fehlen die Feiertage. Dann zeigt moto einen Hinweis mit dem Knopf `Bundesland eintragen`.",
      "Wer Blöcke starten oder beenden darf, legst du unter `Betrieb` fest: bei `Wer darf Blöcke starten?` und `Wer darf Blöcke beenden?`.",
      "`Das ganze Team` geht dort nur, wenn das Team alle Gruppen und Blöcke sieht.",
      "Ganz unten in der Seitenleiste stehen unter `Vom Träger` die Bereiche, die dein Träger für alle Schulen festlegt, zum Beispiel `Monatsbeitrag` oder `Briefkopf`.",
      "Manche Werte legt dein Träger für alle Schulen fest. Dort steht `Vom Träger festgelegt`.",
      "Du kannst davon abweichen. `Zurücksetzen` übernimmt wieder den Wert des Trägers.",
    ],
    differences: [
      "Welche Bereiche du siehst, hängt von deinen Rechten und den Funktionen deiner OGS ab.",
    ],
    troubleshootingDetails: [
      "Bei einer Einstellung steht `Legt der Träger fest`? Diesen Wert ändert nur dein Träger.",
      "Eine Einstellung ist gesperrt? moto legt sie mit deiner Schule fest. Du kannst sie nur lesen.",
      "Fehlt `Alte Daten automatisch löschen`? Das ist die Notbremse. Das moto-Team nutzt sie nur bei einem Vorfall.",
      "Der Wechsel des Anwesenheitsmodus wird abgelehnt? Das geht nicht, solange Kinder eingecheckt sind.",
    ],
    related: [
      HELP_TOPICS.settingsGuide,
      HELP_TOPICS.leadParentVisibility,
      HELP_TOPICS.leadDevices,
      HELP_TOPICS.leadMissingMenu,
    ],
  };
}
