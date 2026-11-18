import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { SIMPLE_NAV_DIFFERENCE } from "../help-article-shared";

export function correctWorkTimeTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.correctWorkTime,
    title: "Eigene Arbeitszeit prüfen und korrigieren",
    question: "Wie prüfe oder korrigiere ich meine Arbeitszeit?",
    summary:
      "Prüfe deine erfassten Zeiten und berichtige einen vorhandenen Eintrag.",
    group: "arbeitszeit",
    audience: ["caregiver", "lead"],
    icon: "Clock3",
    steps: [
      "Klappe in der Seitenleiste `Team` auf und öffne `Zeiterfassung`.",
      // Live geprueft: der Umschalter sitzt in der Kopfkarte, nicht an der
      // Tabelle. Die Tabelle heisst selbst `Zeiterfassung`.
      "Wechsle oben rechts zwischen `Woche` und `Monat`.",
      "Suche in der Tabelle `Zeiterfassung` den betroffenen Tag.",
      "Wähle am Ende der Zeile das Stift-Symbol.",
      "Ändere Beginn, Ende oder Pause.",
      "Trage einen Grund für die Änderung ein.",
      "Wähle `Speichern`.",
    ],
    result:
      "Die korrigierte Zeit und der neue Saldo werden angezeigt. Die Änderung bleibt in der Historie nachvollziehbar.",
    differences: [
      "Einen vollständig fehlenden Arbeitstag trägt nur nach, wer die Zeiten des Teams verwalten darf.",
      "Ein abgeschlossener Monat kann nachträgliche Änderungen anzeigen, sein übertragener Saldo bleibt jedoch festgeschrieben.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    troubleshootingDetails: [
      "Der Beginn darf nicht in der Zukunft liegen. Wähle eine Uhrzeit, die schon vorbei ist.",
    ],
    notes: [
      "Klappe einen geänderten Tag auf, um die Änderungshistorie zu sehen.",
      "Öffne für deinen Zeitnachweis oben rechts das Drei-Punkte-Menü. Wähle `Exportieren`, den Zeitraum und das Format. Mit `Herunterladen` bekommst du die Datei.",
    ],
    related: [HELP_TOPICS.trackWorkTime, HELP_TOPICS.vacation],
  };
}
