import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/school` (`class-day-overview.tsx`): Tagesuebersicht ueber alle Klassen. */
export function teacherClassDayTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherClassDay,
    title: "Meinen Klassentag ansehen",
    question: "Wer aus meinen Klassen bleibt heute in der Betreuung?",
    summary:
      "Die `Klassenansicht` zeigt deine Klassen und die Zahlen des Tages.",
    group: "klasse",
    audience: "teacher",
    icon: "ChalkboardTeacher",
    steps: [
      "Melde dich bei moto schule an.",
      "Du landest in der `Klassenansicht`.",
      "Lies bei jeder Klasse die Zahlen des Tages.",
      "Wähle eine Klasse, um ihre Liste zu öffnen.",
    ],
    result: "Du siehst, wer heute bleibt und wer nach Hause geht.",
    notes: [
      "Ganz oben steht `Heute anders`. Dort siehst du, was heute für deine Klassen und die Schule anders ist. Zum Beispiel ein früherer Unterrichtsschluss oder ein Schließtag.",
      "Übernimmst du heute eine Aufsicht, oder übernimmt jemand deine? Auch das steht unter `Heute anders`. Ein Tipp darauf öffnet `Meine Aufsichten`.",
      "Ist eine deiner Klassen heute auf Ausflug? Dann steht dort, wie viele Kinder mitfahren und wann sie zurückkommen. Ein Tipp darauf öffnet die Klasse.",
      "Fällt einer deiner Termine heute aus oder ist er an einem anderen Ort? Auch das steht unter `Heute anders`. Ein Tipp darauf öffnet den `Kalender`.",
      "Wähle unter `Heute anders` eine Klasse mit Kindern. Dann springst du in der Liste zum ersten Kind, das heute anders ist.",
      "Namen von Kolleginnen und Kollegen und Gründe stehen bei `Heute anders` nicht. Du siehst nur deine Klassen, deine Aufsichten, deine Termine und die ganze Schule.",
      "Hinweise der Leitung liest und bestätigst du unter `Hinweise der Leitung`.",
      "Steht bei einer Klasse `4 Kinder anders als sonst`, weicht dort heute etwas vom üblichen Plan ab.",
      "Mit den Pfeilen siehst du den vorherigen oder nächsten Tag.",
      "Betreut deine OGS am Wochenende? Dann siehst du auch Samstag und Sonntag. Dort gilt der Freitagsplan.",
    ],
    differences: [
      "An einem Wochenende ohne Betreuung steht `Kein Schultag`.",
      "Du hast die Rolle `Schulverwaltung`? Dann steht oben `Ganze Schule` mit den Zahlen aller Klassen. Wähle eine Zahl. Darunter stehen dann die Kinder, nach Klassen sortiert. `Liste schließen` blendet sie wieder aus.",
      "Unter `Fehlen ohne Meldung` stehen die Kinder, die eine Lehrkraft als fehlend eingetragen hat und für die es keine Meldung gibt. Ist die Benachrichtigung `Fehlt ohne Meldung` eingeschaltet, ändert sich die Liste von selbst.",
    ],
    troubleshootingDetails: [
      "Es steht `Keine Klassen zugewiesen`? Dann hat die OGS dir noch keine Klasse zugeordnet.",
    ],
    related: [
      HELP_TOPICS.teacherClassList,
      HELP_TOPICS.teacherChildDetails,
      HELP_TOPICS.teacherArrivalChange,
      HELP_TOPICS.teacherClassTrip,
      HELP_TOPICS.teacherAbsenceReport,
    ],
  };
}
