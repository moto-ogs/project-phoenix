import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/school/fehlzeiten` (#4793): Fehltage je Kind einer Klasse in einem
 * Zeitraum, mit Export als PDF oder Excel.
 */
export function teacherAbsenceListTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherAbsenceList,
    title: "Fehlzeiten einer Klasse ansehen",
    question: "Wie viele Tage hat ein Kind gefehlt?",
    summary:
      "Unter `Fehlzeiten` stehen die Fehltage pro Kind, für Klassenbuch und Zeugnis.",
    group: "klasse",
    audience: "teacher",
    icon: "ClipboardList",
    steps: [
      "Öffne `Fehlzeiten`.",
      "Wähle die Klasse.",
      "Prüfe `Von` und `Bis`. Vorgewählt ist das laufende Halbjahr.",
      "Lies pro Kind die Fehltage, davon entschuldigt und unentschuldigt.",
      "Wähle bei Bedarf `Exportieren`. Wähle `PDF` oder `Excel`.",
    ],
    result: "Du siehst die Fehltage jedes Kindes im gewählten Zeitraum.",
    notes: [
      "Gezählt werden die Anwesenheit am Vormittag und die Meldungen.",
      "Krank oder entschuldigt gemeldet zählt als entschuldigt. Auch eine Meldung der Schulverwaltung zählt.",
      "Ein Kind war am Vormittag da, ist aber krank gemeldet? Dann zählt der Tag nicht als Fehltag.",
      "Klassenfahrt ist kein Fehltag.",
      "`Nicht erfasst` heißt: An diesem Schultag gibt es keinen Eintrag. Das ist kein Fehltag.",
      "Es gibt nur ganze Tage. Ein halber Tag zählt nicht extra.",
      "Kinder, deren Betreuung im Zeitraum endet, bleiben in der Liste. Gezählt werden nur ihre Betreuungstage.",
      "Jeder Abruf und jeder Export wird protokolliert.",
    ],
    differences: [
      "Die Schulverwaltung sieht alle Klassen. Eine Lehrkraft sieht nur ihre Klassen.",
      "Kinder ohne eigenen Eintrag in moto stehen noch nicht in der Liste.",
    ],
    troubleshootingDetails: [
      "Viele Tage `Nicht erfasst`? Dann fehlt die Anwesenheit am Vormittag. Trage sie jeden Morgen ein.",
      "`Unvollständiger Zeitraum`? Ältere Anwesenheit oder Meldungen können bereits gelöscht sein. Die Liste und der Export zählen erst ab dem angegebenen Datum.",
    ],
    related: [
      HELP_TOPICS.teacherMorningAttendance,
      HELP_TOPICS.teacherAbsenceReport,
      HELP_TOPICS.teacherNoClasses,
    ],
  };
}
