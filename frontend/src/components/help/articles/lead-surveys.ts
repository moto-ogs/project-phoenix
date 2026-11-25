import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/umfragen` mit `surveys:manage`: Umfragen mit Fragebogen an Eltern oder
 * das Team (#4781). Anonym nach Variante A: Teilnahme und Antwort getrennt,
 * Auswertung erst nach dem Ende und ab 5 Antworten. Die kurze Frage je Kind bleibt die
 * Elternumfrage unter `Mitteilungen` (`parentSurveyTopic`).
 */
export function leadSurveysTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadSurveys,
    title: "Eine Umfrage mit Fragebogen erstellen",
    question: "Wie befrage ich Eltern oder das Team, auch anonym?",
    summary:
      "Unter `Umfragen` stellst du mehrere Fragen, auf Wunsch anonym. Die Auswertung zeigt Stärken und Verbesserungsbedarf.",
    group: "elternarbeit",
    audience: "lead",
    icon: "ChartPieSlice",
    requirements: ["Du hast die Berechtigung `Umfragen: Verwalten`."],
    steps: [],
    instructionGroups: [
      {
        title: "Eine Umfrage anlegen",
        steps: [
          "Klappe in der Seitenleiste `Team` auf und öffne `Umfragen`.",
          "Wähle `Umfrage anlegen`.",
          "Gib einen `Titel` ein, bei Bedarf auch eine `Einleitung (optional)`.",
          "Wähle unter `Wer soll antworten?` `Eltern` oder `Mitarbeitende`.",
          "Bei Eltern: Wähle unter `Welche Eltern sollen antworten?` die ganze Schule, Klassen, Gruppen, AGs oder einzelne Kinder. Bei Bedarf wählst du `Zusätzlich per E-Mail benachrichtigen`.",
          "Lass `Anonym` an oder schalte es aus.",
          "Wähle bei `Teilnahme bis` das Datum und die `Uhrzeit`.",
          "Gib jede Frage ein und wähle die Art: `Einfachauswahl`, `Mehrfachauswahl`, `Skala 1 bis 5` oder `Freitext`.",
          "Weitere Fragen legst du mit `Frage hinzufügen` an. Mit `Pflichtfrage` muss jede Person die Frage beantworten.",
          "Wähle `Als Entwurf speichern`.",
        ],
      },
      {
        title: "Die Umfrage veröffentlichen",
        description:
          "Danach lässt sich nichts mehr ändern, auch nicht, ob die Umfrage anonym ist.",
        steps: [
          "Öffne die Umfrage in der Liste.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Veröffentlichen` und prüfe die Angaben.",
          "Wähle `Jetzt veröffentlichen`.",
        ],
      },
      {
        title: "Die Auswertung ansehen",
        steps: [
          "Öffne die Umfrage in der Liste.",
          "Bei einer anonymen Umfrage erscheint die Auswertung, sobald die Umfrage beendet ist.",
          "Im Reiter `Auswertung` siehst du pro Frage die Verteilung: bei der Skala den Durchschnitt, den höchsten und den niedrigsten Wert, bei Auswahlfragen die am häufigsten und am seltensten gewählte Antwort, dazu die Freitexte.",
          "Oben stehen `Stärken und Verbesserungsbedarf`: die Skalenfragen mit dem höchsten und dem niedrigsten Durchschnitt.",
          "Für eine Datei öffnest du das Menü mit den drei Punkten und wählst `Auswertung als PDF`.",
        ],
      },
      {
        title: "Erinnern, beenden oder löschen",
        steps: [
          "Öffne die Umfrage und oben das Menü mit den drei Punkten.",
          "`Erinnern` schickt allen eine Erinnerung, die noch nicht teilgenommen haben und Benachrichtigungen bekommen. Du siehst nur die Zahl.",
          "`Beenden` schließt die Teilnahme sofort. Die Auswertung bleibt.",
          "`Löschen` entfernt die Umfrage mit allen Antworten.",
        ],
      },
    ],
    result:
      "Die Eltern finden die Umfrage unter `Elternbriefe`, das Team unter `Umfragen`. Jede Person antwortet einmal, Eltern einmal pro Elternkonto, nicht pro Kind.",
    notes: [
      "Anonym heißt: Du siehst nicht, wer was geantwortet hat. Du siehst auch nicht, wer noch nicht teilgenommen hat. Die Auswertung zeigt nur Summen.",
      "Die Auswertung einer anonymen Umfrage erscheint erst nach dem Ende und ab 5 Antworten. So ist niemand an seinen Antworten erkennbar. Bis dahin siehst du nur, wie viele teilgenommen haben.",
      "Auch einzelne Fragen einer anonymen Umfrage zeigen ihr Ergebnis erst ab 5 Antworten. Bei weniger steht dort nur die Zahl.",
      "Freitexte stehen ohne Namen und ohne Uhrzeit, in zufälliger Reihenfolge. Die PDF-Datei enthält dieselben Summen wie der Bildschirm.",
      "Bei einer Umfrage, die nicht anonym ist, siehst du im Reiter `Antworten pro Person` jede Antwort mit Namen.",
      "Befragst du Mitarbeitende? Ein Fragebogen an Beschäftigte kann mitbestimmungspflichtig sein. Kläre das vorher mit deinem Betriebsrat oder Personalrat. moto prüft das nicht.",
      "Nur eine kurze Frage zu jedem Kind, zum Beispiel zum Sommerfest? Dafür gibt es die Umfrage unter `Eltern` › `Mitteilungen`.",
    ],
    differences: [
      "Siehst du `Umfrage anlegen` nicht? Dann fehlt dir die Berechtigung `Umfragen: Verwalten`. Die Leitung vergibt sie über die Rollen.",
      "Steht im Reiter `Auswertung` `Noch keine Auswertung`? Dann läuft die anonyme Umfrage noch, oder es haben weniger als 5 Personen geantwortet. Mit `Beenden` endet die Teilnahme sofort.",
    ],
    image: "/help/screens/umfrage-auswertung.webp",
    imageAlt:
      "Auswertung einer beendeten anonymen Umfrage mit Stärken, Verbesserungsbedarf und der Verteilung pro Frage.",
    related: [
      HELP_TOPICS.leadParentSurvey,
      HELP_TOPICS.staffSurveys,
      HELP_TOPICS.leadStaffPermissions,
    ],
  };
}
