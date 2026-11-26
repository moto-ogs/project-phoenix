import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/ferienwochen` (#4666): Die Leitung wählt die Gruppe für die Feriengäste
 * einer Woche. Die bestätigten Gäste kommen dann in die Gruppe und in den
 * Check-in. Vor der Woche ist die Gruppe leer und sagt, wie viele Kinder
 * dazukommen (#6680). Mit der Wahl plant moto auch die gebuchten Tage der
 * eigenen Kinder ein (#6678).
 */
export function holidayGuestGroupTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadHolidayGuestGroup,
    title: "Die Feriengruppe wählen",
    question: "Wie kommen Feriengäste in eine Gruppe?",
    summary:
      "Wähle für jede Ferienwoche eine Gruppe. Dort sieht dein Team die Feriengäste.",
    group: "auswertung",
    audience: "lead",
    icon: "UsersThree",
    requirements: [
      "Der Träger hat deine OGS für eine Ferienwoche eingetragen.",
      "Es gibt eine Gruppe für die Ferienwoche, zum Beispiel `Feriengruppe`. Eine neue Gruppe legst du unter `Gruppen` an.",
    ],
    steps: [
      "Klappe in der Seitenleiste `Eltern` auf.",
      "Öffne `Ferienwochen`.",
      "Richtet deine OGS mehrere Wochen aus, wähle oben die Woche.",
      "Wähle unter `Feriengruppe` die Gruppe.",
      "Wähle `Feriengäste übernehmen`.",
    ],
    result:
      "Ab dem ersten Tag der Woche stehen die Feriengäste in der Gruppe, im Check-in und unter `Alle Kinder`. Bei jedem steht seine Schule, zum Beispiel `Gast aus Grundschule am See`. Dein Team sieht Betreuung, Notfall, Abholung und die Angaben, die der Träger freigibt.",
    notes: [
      "Feriengäste sind Kinder, die sonst nicht in deine OGS gehen. Kinder deiner OGS bleiben in ihrer Gruppe.",
      "Kinder deiner OGS plant moto von selbst ein, auch ohne Feriengruppe. Der Stand steht unter `Kinder deiner OGS`.",
      "Öffnest du die leere Feriengruppe über einen Link, steht dort, wie viele Kinder dazukommen und ab wann.",
      "Vor der Woche siehst du die Feriengäste nur hier unter `Ferienwochen`.",
      "Eine Gruppe nur für die Ferien steht vor der Woche nicht unter `Gruppen`. In der `Datenverwaltung` unter `Gruppendaten` steht bei ihr `Feriengruppe` mit der Woche. Dort legst du Raum und Gruppenleitung schon vorher fest.",
      "Bestätigt der Träger später weitere Kinder, kommen sie innerhalb einer Stunde in die Gruppe. Storniert er, gehen sie innerhalb einer Stunde.",
      "Jede Übernahme steht im Zugriffsprotokoll deiner OGS.",
    ],
    differences: [
      "Fehlen Auswahl und Knopf? Gruppen wählen darf nur, wer Kinder anlegen darf.",
    ],
    troubleshootingDetails: [
      "Nach dem letzten Tag der Woche stehen die Feriengäste nicht mehr in der Gruppe und nicht mehr im Check-in.",
      "Fehlt die Feriengruppe unter `Gruppen`? Hat sie keine eigenen Kinder, steht sie dort erst ab dem ersten Tag der Woche.",
    ],
    related: [HELP_TOPICS.leadHolidayWeeks, HELP_TOPICS.holidayGuests],
  };
}
