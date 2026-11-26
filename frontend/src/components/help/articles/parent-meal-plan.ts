import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function parentMealPlanTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentMealPlan,
    title: "Das Mittagessen ansehen",
    question: "Wo sehe ich, was es zu essen gibt?",
    summary: "Unter `Mittagessen` steht der Plan der Woche.",
    group: "nachrichten",
    audience: "parent",
    icon: "UtensilsCrossed",
    steps: [],
    instructionGroups: [
      {
        title: "Plan ansehen",
        steps: [
          "Tippe unten auf `Mehr`.",
          "Wähle `Mittagessen`.",
          "Wechsle bei Bedarf mit den Pfeilen die Woche.",
        ],
      },
      {
        title: "Einen Tag an- oder abmelden",
        description:
          "Das geht nur, wenn deine OGS die Anmeldung zum Mittagessen nutzt.",
        steps: [
          "Wähle beim Tag `Ändern`.",
          "Wähle `Anmelden` oder `Abmelden`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine ganze Woche abmelden",
        steps: [
          "Wähle mit den Pfeilen die Woche.",
          "Wähle `Woche abmelden`.",
          "Bestätige mit `Abmelden`.",
        ],
      },
    ],
    result: "Du siehst pro Tag das Gericht und ob dein Kind mitisst.",
    notes: [
      "Steht am Gericht zum Beispiel `Allergene: A, G`, enthält es diese Allergene. Unter dem Plan steht, was die Buchstaben bedeuten.",
      "Die Angaben kommen von der Schule oder vom Caterer. Ein Gericht ohne Buchstaben ist nicht sicher frei von Allergenen. Frage im Zweifel die OGS.",
      "Über dem Plan steht die Kalenderwoche, zum Beispiel `KW 38 · Diese Woche`.",
      "Bei jedem Tag steht, bis wann du ändern kannst, zum Beispiel `Abmelden bis Do., 17.09., 12:00`.",
      "Mit `Woche anmelden` oder `Woche abmelden` änderst du alle Tage der Woche auf einmal, die du noch ändern kannst.",
      "Die Anmeldung siehst du bis zu vier Wochen im Voraus. Den Speiseplan gibt es für diese und nächste Woche.",
    ],
    differences: [
      "Steht an einem Tag `Kein Essen eingetragen`, hat die OGS dafür nichts hinterlegt.",
      "Die Seite zeigt gleich `Nächste Woche`? Dann kannst du in dieser Woche nichts mehr ändern, zum Beispiel am Wochenende. Mit dem Pfeil nach links siehst du diese Woche.",
      "Fehlt `Ändern` bei den festen Tagen? Dann ist die Anmeldung für das Schuljahr abgeschlossen. Die festen Tage ändert jetzt die Schule.",
      "Nach `Woche abmelden` bleiben Tage angemeldet, deren Frist schon vorbei ist. moto nennt sie.",
      "Nach `Woche anmelden` bleiben Tage abgemeldet, deren Anmeldefrist schon vorbei ist. moto nennt sie.",
      "Steht `An diesem Tag ist die OGS zu`, gibt es an diesem Tag kein Essen.",
      "In den Ferien gelten die festen Tage nicht. Für die Ferienbetreuung meldest du einzelne Tage an.",
    ],
    troubleshootingDetails: [
      "moto sagt, der Speiseplan sei nicht freigeschaltet? Dann nutzt deine OGS diese Funktion nicht.",
      "Die Woche ist leer? Dann hat die OGS den Plan noch nicht eingetragen.",
    ],
    related: [
      HELP_TOPICS.parentCalendar,
      HELP_TOPICS.parentReportAbsence,
      HELP_TOPICS.parentFeatureMissing,
    ],
  };
}
