import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Der Link eines veröffentlichten Ferienzeitraums (#4661). */
export function traegerHolidayRegistrationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerHolidayRegistration,
    title: "Link zur Ferienanmeldung teilen",
    question: "Wie melden Eltern ihre Kinder für die Ferien an?",
    summary:
      "Jeder veröffentlichte Ferienzeitraum hat einen Link für Eltern. Er gilt für alle Wochen und Schulen.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Megaphone",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
      "Der Ferienzeitraum ist veröffentlicht.",
    ],
    steps: [
      "Wähle in der Navigation `Ferienbetreuung`.",
      "Öffne den Ferienzeitraum.",
      "Unter `Link für Eltern` steht der Link. Wähle daneben `Link kopieren`.",
      "Gib den Link an die Eltern weiter, zum Beispiel in einem Elternbrief der Schulen.",
    ],
    result:
      "Eltern melden ihre Kinder über den Link an. Unter dem Link steht, wie viele Anmeldungen es bisher gibt.",
    notes: [
      "Für einen Aushang gibt es den Link auch als QR-Code. Wähle neben dem Link `QR-Code`, dann `Bild speichern`. In der Mitte steht dein Logo aus dem Briefkopf, sonst das moto-Logo.",
      "Unter `Hinweise und Einwilligungen` öffnest du die PDFs. Setze die nötigen Häkchen. Die Zusammenfassung zeigt deine Bestätigungen.",
      "Eltern brauchen kein Elternkonto.",
      "Eltern können eine `Zweite sorgeberechtigte Person` angeben. Die Bestätigung geht nur an die anmeldende Person.",
      "Ein Kind ohne Schule deines Trägers melden Eltern als Feriengast an. Es wird dadurch kein Schulkind einer OGS.",
      "Eltern bestätigen bei jeder Anmeldung das Sorgerecht. Mit ihrem Vor- und Nachnamen geben sie die Erklärungen ab.",
      "Eltern bekommen eine Bestätigung per E-Mail. Sie ist noch keine Zusage. Sie enthält die Erklärung der Eltern mit dem genauen Text, auch deine bestätigten Hinweise.",
      "Gesundheitsangaben stehen nur in der Anmeldung. Die Bestätigung nennt sie nicht.",
      "Ein Jahr nach der letzten Woche löscht moto die Anmeldungen. Die Frist änderst du in den Einstellungen unter `Ferienbetreuung`. Sie steht im Einwilligungstext für die Eltern.",
      "Eine Anmeldung behält die Frist, die bei ihrer Abgabe im Einwilligungstext stand. Ältere Anmeldungen mit dem Text „drei Monate“ löscht moto nach drei Monaten.",
      "Gesundheitsangaben löscht moto immer schon 92 Tage nach der letzten Woche. Ausgestellte Rechnungen und Bestätigungsschreiben bleiben.",
    ],
    differences: [
      "Du siehst keinen Link? Dann ist der Ferienzeitraum noch ein Entwurf. Veröffentliche ihn zuerst.",
    ],
    troubleshootingDetails: [
      "Eine Woche oder ein Zeitmodell lässt sich nicht entfernen? Dafür gibt es schon Anmeldungen. Ein gebuchtes Zeitmodell kannst du `Archivieren`.",
      "Eltern sagen, die Anmeldung sei nicht offen? Prüfe `Anmeldebeginn` und `Anmeldeschluss`.",
    ],
    related: [HELP_TOPICS.traegerHolidayPeriod],
  };
}
