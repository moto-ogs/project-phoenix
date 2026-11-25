import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Abschnitt `So geht ... nach Hause` im Reiter `Betreuung` (Komponente
 * `DepartureSection` in components/parent/child-master-data.tsx). Je
 * Wochentag ein Kaestchen pro Weg; `accompanied` steht nur lesend da, weil
 * ein begleitetes Kind ein zweites Kind betrifft. Geaendert wird immer per
 * Anfrage (`requestButton`), nie direkt.
 */
export function parentDepartureTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentDeparture,
    title: "Den Weg nach Hause ändern",
    question: "Wie ändere ich, wie mein Kind nach Hause geht?",
    summary: "Du siehst den Weg pro Wochentag und fragst eine Änderung an.",
    group: "mein-kind",
    audience: "parent",
    icon: "Repeat",
    steps: [
      "Tippe unten auf `Mein Kind`.",
      "Wähle den Reiter `Betreuung`.",
      "Gehe ganz nach unten zum Abschnitt `So geht ... nach Hause`. Dort steht der Name deines Kindes. Du siehst für jeden Wochentag, wie dein Kind nach Hause geht.",
      "Tippe auf `Bearbeiten`.",
      "Setze pro Wochentag einen Haken bei `Geht allein`, `Bus` oder `Wird abgeholt`.",
      "Tippe auf `Änderung anfragen`.",
    ],
    result:
      "Die OGS prüft deine Anfrage. Bis zur Bestätigung gilt der bisherige Weg. Deine Anfrage steht darunter bei `Beantragte Änderung`.",
    notes: [
      "Pro Tag sind mehrere Wege möglich. Dann darf dein Kind jeden davon nehmen.",
      "Die Tage sind `Mo` bis `Fr`. Jeder Tag hat eine eigene Auswahl.",
      "Mit `Abbrechen` verwirfst du deine Auswahl. Der bisherige Weg bleibt.",
      "Gibt es weitere Sorgeberechtigte mit App-Zugang, wähle unter `Anfrage teilen (optional)`, wer mitlesen darf.",
    ],
    differences: [
      "Steht dort `Beantragte Änderung` mit `In Prüfung`, wartet schon eine Änderung auf die OGS. Bis dahin gibt es kein `Bearbeiten`.",
      "Geht dein Kind mit einem anderen Kind, steht beim Tag `Geht mit anderem Kind`. Dann gibt es kein `Bearbeiten`.",
      "Steht dort `Es gibt keine weiteren Sorgeberechtigten mit Zugang zur Eltern-App`? Dann gibt es niemanden zum Mitlesen.",
    ],
    troubleshootingDetails: [
      "Es gibt kein `Bearbeiten`? Geht dein Kind an einem Tag mit einem anderen Kind, änderst du den Weg nicht selbst. Schreibe der OGS.",
      "moto sagt, Änderungsanfragen seien deaktiviert? Dann nimmt deine OGS keine Änderungen über die App an.",
    ],
    related: [
      HELP_TOPICS.parentCareChange,
      HELP_TOPICS.parentGuardians,
      HELP_TOPICS.parentPickupChange,
    ],
  };
}
