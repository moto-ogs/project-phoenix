import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/personal/abwesenheitsarten` und die Karte `Kontingente` der
 * Personalakte (#4710, ADR 0089 §10 mit Nachtrag): eigene Abwesenheitsarten
 * des Trägers, ein Kontingent je Person über alle Schulen, die Abweichung
 * einer Schule und der Antrag durch Betreuungskräfte.
 */
export function traegerAbsenceTypesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerAbsenceTypes,
    title: "Abwesenheitsarten und Kontingente",
    question:
      "Wie lege ich Abwesenheitsarten und Kontingente für alle Schulen an?",
    summary:
      "Du legst Arten wie Regenerationstag einmal für den Träger an. Jede Person hat je Art ein Kontingent über alle ihre Schulen.",
    group: "personal",
    audience: "traeger",
    icon: "CalendarSlash",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Das moto-Team hat `Personal beim Träger` für deinen Träger freigeschaltet.",
    ],
    instructionGroups: [
      {
        title: "Eine Abwesenheitsart anlegen",
        steps: [
          "Wähle in der Navigation `Abwesenheitsarten`.",
          "Wähle oben `Abwesenheitsart anlegen`.",
          "Gib einen Namen ein, zum Beispiel Regenerationstag.",
          "Lasse `Tage je Person zählen (Kontingent)` an und trage die Tage je Jahr ein.",
          "Wähle bei `Rest verfällt`, wie lange ein Rest ins neue Jahr geht.",
          "Schalte `Betreuungskräfte dürfen beantragen` an, wenn sie die Art selbst beantragen sollen.",
          "Wähle `Anlegen`.",
        ],
      },
      {
        title: "Den Anspruch einer Person ändern",
        description: "Ohne eigenen Wert gilt für jede Person die Zahl der Art.",
        steps: [
          "Öffne unter `Personalakten` die Akte der Person.",
          "Öffne den Reiter `Verträge und Zeit`. Wähle in der Karte `Kontingente` das Jahr.",
          "Wähle bei der Art `Anspruch ändern`.",
          "Trage die Tage und eine Begründung ein. Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine Art ausschalten",
        steps: [
          "Wähle bei der Art das Menü mit den drei Punkten.",
          "Wähle `Ausschalten`.",
        ],
      },
    ],
    steps: [],
    result:
      "moto trägt die Art sofort in alle deine Schulen. Jede Buchung und jeder offene Antrag an jeder Schule zählt für das eine Kontingent der Person. Mehr als das Kontingent lässt sich an keiner Schule eintragen.",
    notes: [
      "Hat eine Schule schon eine eigene Art mit demselben Namen, wird sie Teil deiner Art. Deine Buchungen bleiben.",
      "Eine Schule darf abweichen, nur für ihre eigenen Einsätze: Sie bietet die Art nicht an, oder sie erlaubt weniger Tage. Du siehst das bei jeder Art unter `An den Schulen`.",
      "Den Antrag einer Betreuungskraft entscheidet die Leitung der Schule, an der sie den Antrag stellt.",
      "Urlaub, Krank, Fortbildung, Sonstige und Freizeitausgleich gibt es immer. Den Urlaubsanspruch führst du mit dem Arbeitsvertrag.",
      "Jedes Anzeigen der Kontingente steht im Zugriffsprotokoll jeder Schule der Person.",
    ],
    differences: [
      "Bei einer Schule steht `Noch nicht übernommen`: Die Schule war beim Speichern nicht erreichbar. Speichere die Art noch einmal.",
      "Du kannst den Namen nicht mehr ändern: Eine Schule hat die Art schon gebucht. Gebuchte Tage behalten ihren Namen.",
    ],
    troubleshootingDetails: [
      "„Der Anspruch reicht nicht“: An den Schulen sind schon mehr Tage eingetragen oder beantragt. Die Zahl darf nicht kleiner sein.",
    ],
    related: [HELP_TOPICS.traegerStaffRecords, HELP_TOPICS.traegerAccessLog],
  };
}
