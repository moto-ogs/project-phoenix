import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/ferien/[id]/plaetze` (#4699): Plätze, Warteliste, Nachrücken. */
export function traegerHolidayPlacesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerHolidayPlaces,
    title: "Plätze und Warteliste in den Ferien",
    question: "Wie lege ich Plätze je Ferienwoche fest?",
    summary:
      "Du legst je Woche fest, wie viele Kinder mitmachen können. Plätze gehen in der Reihenfolge der Anmeldung. Ist eine Woche voll, kommt das Kind auf die Warteliste und rückt automatisch nach.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Hourglass",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
      "Der Ferienzeitraum hat Wochen. Die legst du im Reiter `Planung` an.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Plätze festlegen",
        steps: [
          "Wähle in der Navigation `Ferienbetreuung`.",
          "Öffne den Ferienzeitraum.",
          "Wähle den Reiter `Plätze`.",
          "Wähle bei der Woche `Plätze bearbeiten`.",
          "Schalte `Plätze begrenzen` ein und stelle die Zahl ein.",
          "Wähle `Plätze speichern`.",
        ],
      },
      {
        title: "Warteliste ansehen",
        steps: [
          "Unter jeder Woche steht `Warteliste` mit allen Kindern, die auf einen Platz warten.",
          "Die Zahl vorne ist der Rang. Das Kind mit der 1 bekommt den nächsten freien Platz.",
          "Berücksichtigt der Ferienzeitraum den Ferienwunsch, stehen Kinder mit `Ohne Ferienwunsch` hinter den anderen.",
          "Wähle ein Kind, um seine Anmeldung zu öffnen.",
        ],
      },
      {
        title: "Plätze herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Öffne den Ferienzeitraum und wähle den Reiter `Plätze`.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält je Woche die Plätze und die Kinder auf der Warteliste.",
        ],
      },
      {
        title: "Wann ein Kind nachrückt",
        steps: [
          "Du stornierst eine Anmeldung mit Platz.",
          "Du buchst ein Kind aus der Woche heraus.",
          "Du gibst der Woche mehr Plätze oder hebst die Grenze auf.",
        ],
        ordered: false,
      },
    ],
    result:
      "Das nächste Kind der Warteliste hat sofort einen Platz. Die Anmeldung gilt dann auch für diese Woche. Ist die Anmeldung verbindlich, ist es der Platz auch. Die Eltern bekommen eine E-Mail. Ist die Anmeldung bestätigt, rechnet moto den Ferienbeitrag mit der neuen Woche neu.",
    notes: [
      "Die Plätze gelten für alle Zeitmodelle einer Woche zusammen.",
      "Bei einer Woche mit einzelnen Tagen gelten die Plätze an jedem Tag. Unter `Plätze je Tag` siehst du, wie voll jeder Tag ist. Ein Kind bekommt seinen Platz, wenn alle seine Tage frei sind. Sonst wartet es mit allen Tagen dieser Woche. Ein Kind mit anderen Tagen kann dann vor ihm einen Platz bekommen. Ein Feiertag oder Schließtag ist grau und nennt den Grund. An diesem Tag gibt es keine Plätze.",
      "Eingegangene und bestätigte Anmeldungen zählen. Stornierte zählen nicht.",
      "Geschwister bekommen ihre Plätze einzeln. Ein Kind kann einen Platz haben und das andere auf der Warteliste stehen.",
      "Weniger Plätze nehmen niemandem den Platz weg. Neue Anmeldungen kommen dann auf die Warteliste.",
      "Kinder auf der Warteliste zahlen nichts. Sie stehen auch nicht auf der Teilnehmerliste der ausrichtenden OGS.",
      "Eltern sehen nach dem Absenden und in der E-Mail, in welchen Wochen ihr Kind einen Platz hat und wo es auf der Warteliste steht.",
      "Ohne Grenze bekommt jedes angemeldete Kind einen Platz. So ist jede neue Woche eingestellt.",
    ],
    differences: [
      "Vergibt der Ferienzeitraum die Plätze nach Kriterien? Dann bekommt beim Anmelden niemand sofort einen Platz. Bei der Woche steht dann zum Beispiel `3 offen`. Die Plätze vergibt dein Büro im Reiter `Vergabe`. Danach gelten Warteliste und Nachrücken wie hier beschrieben.",
      "Bei einer Woche steht `Voll`? Alle Plätze sind vergeben. Neue Anmeldungen für diese Woche kommen auf die Warteliste.",
      "Bei einer Woche steht `2 Tage voll` oder `Alle Tage voll`? Die Woche wird tageweise gebucht. An diesen Tagen sind alle Plätze vergeben.",
      "Bei einer Woche steht `Ohne Grenze`? Für die Woche gibt es keine Grenze.",
    ],
    troubleshootingDetails: [
      "Die Warteliste rückt nicht nach, obwohl du mehr Plätze eingetragen hast? Lade die Seite neu. Steht das Kind noch auf der Warteliste, ist die Zahl nicht höher als die vergebenen Plätze.",
    ],
    related: [
      HELP_TOPICS.traegerHolidayRegistrationReview,
      HELP_TOPICS.traegerHolidayPeriod,
      HELP_TOPICS.traegerHolidayContribution,
      HELP_TOPICS.traegerHolidayWish,
      HELP_TOPICS.traegerHolidayAllocation,
    ],
  };
}
