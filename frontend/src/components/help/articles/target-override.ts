import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/staff/[id]`, Reiter `Arbeitszeitmodell`, Abschnitt `Sonderarbeitszeiten`
 * (#3259). Der Fall aus der Praxis: die Herbstferien sind ein Schließtag,
 * einige arbeiten trotzdem in der Ferienbetreuung. Ohne Sonderarbeitszeit
 * bekämen sie Plusstunden. Teilzeitkräfte mit ungleich verteilten Stunden
 * tragen sie je Wochentag ein (#3745).
 */
export function targetOverrideTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadTargetOverride,
    title: "Eine Sonderarbeitszeit eintragen",
    question: "Wie trage ich andere Stunden für die Ferienbetreuung ein?",
    summary:
      "Für Personen, die in den Ferien andere Stunden arbeiten, zum Beispiel in den Herbstferien.",
    group: "personal",
    audience: "lead",
    icon: "CalendarPlus",
    requirements: [
      "Du darfst die Zeiterfassung aller Mitarbeitenden verwalten.",
    ],
    steps: [
      "Klappe in der Seitenleiste `Team` auf.",
      "Öffne `Mitarbeitende`.",
      "Wähle die Person.",
      "Wähle oben `Arbeitszeitmodell`.",
      "Wähle `Sonderarbeitszeit anlegen`.",
      "Trage `Erster Tag` und `Letzter Tag` ein.",
      "Trage bei `Stunden pro Tag` die Stunden ein, zum Beispiel `8,5`.",
      "Wähle `Je Wochentag`, wenn die Stunden unterschiedlich sind.",
      "Trage die Stunden für Montag bis Freitag ein.",
      "Wähle `Speichern`.",
    ],
    result:
      "In diesem Zeitraum gelten die neuen Stunden. Danach gilt wieder das Arbeitszeitmodell.",
    notes: [
      "Die Stunden gelten Montag bis Freitag, auch an Schließtagen. Gesetzliche Feiertage bleiben frei.",
      "Mit `0` Stunden muss die Person an diesen Tagen nicht arbeiten.",
      "Bei `Je Wochentag` zeigt moto unter den Feldern die Summe für die Woche.",
      "Ändern geht nicht. Lösche den Eintrag über die drei Punkte und lege ihn neu an.",
    ],
    troubleshootingDetails: [
      "Es gibt in dem Zeitraum schon eine Sonderarbeitszeit? Lösche diese zuerst.",
      "Der Monat ist abgeschlossen? Öffne ihn zuerst wieder im Reiter `Zeiterfassung`.",
      "`Sonderarbeitszeit anlegen` fehlt und eine Zeile zeigt „vom Träger“? Der Träger führt das Soll dieser Person, auch in den Ferien. Wende dich an die Personalverwaltung des Trägers.",
    ],
    related: [
      HELP_TOPICS.leadStaffRecord,
      HELP_TOPICS.leadCalendarPeriods,
      HELP_TOPICS.leadWorkTimeReview,
    ],
  };
}
