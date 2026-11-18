import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/school/elternsprechtag`: Elternsprechtag einer eigenen Klasse (#4801). */
export function teacherParentConferenceTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherParentConference,
    title: "Einen Elternsprechtag anbieten",
    question: "Wie biete ich den Eltern meiner Klasse Gesprächstermine an?",
    summary:
      "Du legst einen Tag mit Zeitfenstern an. Die Eltern buchen in der Eltern-App ein Zeitfenster je Kind.",
    group: "nachrichten",
    audience: "teacher",
    icon: "CalendarCheck",
    requirements: ["Dir ist die Klasse zugeordnet."],
    steps: [
      "Öffne `Kalender`.",
      "Wähle `Elternsprechtag`.",
      "Wähle `Neuer Elternsprechtag`.",
      "Wähle die Klasse und den Tag.",
      "Gib `Beginn`, `Ende` und die `Dauer je Gespräch` an. Eine Pause und den Raum kannst du dazuschreiben.",
      "Wähle `Speichern`.",
    ],
    result:
      "Die Eltern der Klasse sehen die freien Zeitfenster in der Eltern-App und buchen eines je Kind. Jede Buchung steht in deinem Kalender und im Kalender der Eltern.",
    notes: [
      "Wähle den Tag in der Liste. Dort siehst du, welches Kind wann kommt. Mit `Drucken` druckst du die Liste.",
      "Eltern buchen, verschieben oder sagen ab, bis 24 Stunden vor dem Termin. Danach melden sie sich bei dir.",
      "Unter `Einstellungen` schaltest du `Buchungen am Elternsprechtag` ein. Dann bekommst du einen Hinweis, wenn Eltern buchen, verschieben oder absagen.",
    ],
    differences: [
      "Du änderst den Tag mit `Ändern`. Eltern mit Buchung bekommen eine Nachricht. Fällt ein gebuchtes Zeitfenster weg, ist diese Buchung abgesagt.",
      "Wählst du eine andere Klasse, werden alle bisherigen Buchungen abgesagt. Die Eltern bekommen eine Nachricht.",
      "Du löschst den Tag mit `Löschen`. Alle Buchungen sind dann abgesagt, und die Eltern bekommen eine Nachricht.",
      "`Neuer Elternsprechtag` ist grau? Dir ist keine Klasse zugeordnet.",
    ],
    troubleshootingDetails: [
      "Eltern finden keinen Termin? Die Eltern sehen den Tag nur, wenn ihr Kind in der Klasse ist und sie Zugang zur Eltern-App haben.",
      "Am Ende des Schuljahres löscht moto die Elternsprechtage und ihre Buchungen.",
    ],
    related: [
      HELP_TOPICS.teacherCalendar,
      HELP_TOPICS.teacherParentLetters,
      HELP_TOPICS.teacherNoClasses,
    ],
  };
}
