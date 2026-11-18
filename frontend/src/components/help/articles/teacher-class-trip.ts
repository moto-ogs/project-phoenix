import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `Ausflug oder Klassenfahrt melden` (`class-day-class.tsx`, #4799). Nur mit
 * Freigabe der OGS; ohne Rückkehrzeit gilt jeder Tag als Klassenfahrt.
 */
export function teacherClassTripTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherClassTrip,
    title: "Einen Ausflug oder eine Klassenfahrt melden",
    question: "Meine Klasse ist unterwegs. Wie sage ich das der OGS?",
    summary: "Du meldest den Zeitraum und welche Kinder mitfahren.",
    group: "klasse",
    audience: "teacher",
    icon: "MapPin",
    steps: [
      "Öffne die Liste deiner Klasse.",
      "Wähle `Ausflug oder Klassenfahrt melden`.",
      "Wähle bei `Von` und `Bis` die Tage.",
      "Alle Kinder der Klasse sind ausgewählt. Öffne `Kinder` und nimm den Haken bei Kindern weg, die nicht mitfahren.",
      "Ist es nur ein Tag und kommt die Klasse am selben Tag zurück? Trage bei `Rückkehrzeit (optional)` die Uhrzeit ein.",
      "Wähle `Für … Kinder melden`.",
    ],
    result:
      "Ohne Rückkehrzeit sieht die OGS die Kinder an jedem dieser Tage als unterwegs. Mit Rückkehrzeit kommen die Kinder um diese Uhrzeit in die OGS.",
    notes: [
      "Bei `Ziel (optional)` kannst du zum Beispiel `Zoo` eintragen. Die OGS sieht das.",
    ],
    differences: [
      "Fehlt `Ausflug oder Klassenfahrt melden`? Dann hat deine OGS das Melden nicht freigegeben.",
      "Kinder mit `Keine Betreuung` stehen nicht in der Auswahl. Die OGS betreut sie nicht.",
    ],
    troubleshootingDetails: [
      "moto sagt, für ein Kind steht an einem Tag schon etwas? Unter der Meldung stehen das Kind und der Tag. Das Kind ist dann zum Beispiel krank gemeldet. Es wurde nichts gespeichert. Sprich mit der OGS.",
      "moto sagt, die OGS hat schon eine andere Ankunftszeit eingetragen? Auch dann wurde nichts gespeichert. Sprich mit der OGS.",
    ],
    related: [
      HELP_TOPICS.teacherClassDay,
      HELP_TOPICS.teacherArrivalChange,
      HELP_TOPICS.teacherMessages,
    ],
  };
}
