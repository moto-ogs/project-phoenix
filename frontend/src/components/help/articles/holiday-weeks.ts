import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/ferienwochen` (#4665): die bestätigten Kinder der Ferienwochen, die die
 * OGS für ihren Träger ausrichtet, nur bis zum letzten Tag der Woche. Dazu
 * die freigegebenen Antworten und die zweite sorgeberechtigte Person (#5202)
 * und die Gesundheitsangaben, wenn die Eltern zugestimmt haben (#4722).
 * Kinder der eigenen OGS bleiben in ihrer Gruppe; die Karte `Kinder deiner
 * OGS` zeigt, ob moto ihre Anmeldung einem Kind zugeordnet hat (#6678).
 */
export function holidayWeeksTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadHolidayWeeks,
    title: "Die Kinder einer Ferienwoche ansehen",
    question: "Welche Kinder kommen in unsere Ferienwoche?",
    summary:
      "Richtet deine OGS eine Ferienwoche für den Träger aus, siehst du die bestätigten Kinder.",
    group: "auswertung",
    audience: "lead",
    icon: "SunHorizon",
    image: "/help/screens/ferienwochen-freigegebene-antworten.webp",
    imageAlt:
      "Zahlen pro Zeitmodell, Heimatschule und Tag. Darunter steht die Kinderliste mit den freigegebenen Antworten.",
    requirements: [
      "Der Träger hat deine OGS für eine Ferienwoche eingetragen.",
      "Der Träger hat Anmeldungen für diese Woche bestätigt.",
    ],
    steps: [
      "Klappe in der Seitenleiste `Eltern` auf.",
      "Öffne `Ferienwochen`.",
      "Richtet deine OGS mehrere Wochen aus, wähle oben die Woche.",
      "Lies unter `Pro Zeitmodell` und `Pro Heimatschule` die Zahlen.",
      "Gibt es in der Woche Mittagessen, steht unter `Mittagessen pro Tag`, wie viele Essen für jeden Tag gebucht sind. Tage ohne Betreuung stehen nicht in der Liste, zum Beispiel ein Schließtag.",
      "Kommen Kinder deiner OGS? Dann steht unter `Kinder deiner OGS`, ob sie eingeplant sind.",
      "Unter `Kinder` steht jedes Kind mit Geburtsdatum, Heimatschule und Zeitmodell.",
      "Bei einem Kind deiner OGS öffnest du mit `Akte öffnen` seine Kinderakte.",
      "Gibt der Träger Fragen frei, steht jede in einer eigenen Spalte. Zum Beispiel `Darf allein nach Hause gehen`.",
      "Unter `Zweite sorgeberechtigte Person` stehen Name und Telefon, wenn die Eltern eine zweite Person angegeben haben.",
      "Unter `Gesundheit` stehen Allergien, Medikamente und weitere Hinweise. Dort stehen auch Antworten auf Gesundheitsfragen, die der Träger freigibt.",
      "Fragt der Träger im Formular Einwilligungen ab, steht jede in einer eigenen Spalte. Zum Beispiel `Fotos in der Ferienbetreuung` mit `Ja`, `Nein` oder `Widerrufen`.",
    ],
    result:
      "Du weißt, wie viele Kinder in welcher Zeit kommen und woher sie kommen.",
    notes: [
      "Die Woche steht auch im `Betreuungsplan` und im `Dienstplan`: im Kopf jedes Tages mit `Ferienbetreuung`, der Zahl der Kinder und der Betreuungszeit. Ein Klick darauf öffnet diese Seite.",
      "Über das Menü mit den drei Punkten lädst du die Liste `Als Excel herunterladen` oder `Als CSV herunterladen`.",
      "Bei Tagesbuchung nennt die Spalte `Tage` die gebuchten Tage. Das gilt auch für Excel und CSV.",
      "Bietet der Träger Mittagessen an, steht in der Spalte `Mittagessen` bei jedem Kind `Ja` oder `Nein`. Ein Kind mit `Ja` isst an jedem seiner gebuchten Tage. Die Spalte steht auch in Excel und CSV. Das Essen rechnet der Träger mit den Eltern ab.",
      "Ein `Feriengast` geht auf keine Schule deines Trägers. In Klammern steht die Schule, die die Eltern genannt haben.",
      "Steht in einer Spalte `–`, haben die Eltern die Frage nicht beantwortet.",
      "Gesundheitsangaben siehst du nur, wenn die Eltern zugestimmt haben. Sie stehen nur in der Liste, nicht in der Excel- oder CSV-Datei.",
      "Die Einwilligungen zeigen immer den Stand von jetzt. Widerrufen die Eltern in der Eltern-App, steht sofort `Widerrufen`. In Excel und CSV heißt die Spalte `Einwilligung:` mit dem Titel. Eine Datei zeigt den Stand beim Herunterladen.",
      "Kinder deiner OGS bleiben in ihrer Gruppe. moto trägt für die gebuchten Tage Ankunft und Abholung ein. Der Check-in erwartet das Kind dann an diesen Tagen. Neu bestätigte Kinder plant moto innerhalb einer Stunde ein.",
      "In der Kinderakte steht unter `Angaben aus der Ferienanmeldung`, was die Eltern angegeben haben: Betreuung, Notfall, Abholung und Gesundheit. Die Stammdaten des Kindes ändern sich nicht.",
      "Änderst du an einem eingeplanten Tag die Abholzeit, bleibt deine Zeit stehen.",
      "E-Mail-Adressen siehst du nicht. Sie bleiben beim Träger.",
      "Kinder deiner OGS, die in den Ferien eine andere OGS betreut, stehen im Reiter `Kinder bei anderen OGS`.",
      "Jeder Abruf und jede Datei wird im Zugriffsprotokoll deiner OGS vermerkt.",
    ],
    differences: [
      "Nach dem letzten Tag der Woche ist die Woche nicht mehr zu sehen. Die Gesundheitsangaben auch nicht.",
      "Storniert der Träger eine Anmeldung, verschwindet das Kind sofort. Die eingeplanten Tage eines Kindes deiner OGS entfernt moto innerhalb einer Stunde.",
    ],
    troubleshootingDetails: [
      "Fehlt ein Kind? Anmeldungen prüft und bestätigt der Träger. Frage dort nach.",
      "Steht ein Kind unter `Noch nicht zugeordnet`? Dann passen Vorname, Nachname oder Geburtsdatum der Anmeldung zu keinem Kind in moto oder zu mehreren. Ändere die Kinderakte oder frag den Träger, ob er die Anmeldung ändert. Vorher plant moto für dieses Kind nichts ein.",
      "Steht bei einem Kind unter `Gesundheit` nichts? Dann haben die Eltern nichts angegeben oder nicht zugestimmt. Ältere Anmeldungen geben keine Gesundheitsangaben weiter.",
      "Fehlt `Ferienwochen` in der Seitenleiste? Der Bereich ist der Leitung vorbehalten.",
    ],
    related: [
      HELP_TOPICS.leadHolidayGuestGroup,
      HELP_TOPICS.leadHolidayHomeSchoolChildren,
      HELP_TOPICS.leadStatistics,
      HELP_TOPICS.leadExports,
    ],
  };
}
