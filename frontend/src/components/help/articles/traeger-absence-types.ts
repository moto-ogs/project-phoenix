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
      "Sie legen Arten wie Regenerationstag einmal für den Träger an. Jede Person hat je Art ein Kontingent über alle ihre Schulen.",
    group: "personal",
    audience: "traeger",
    icon: "CalendarSlash",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Das moto-Team hat `Personal beim Träger` für Ihren Träger freigeschaltet.",
    ],
    instructionGroups: [
      {
        title: "Eine Abwesenheitsart anlegen",
        steps: [
          "Wählen Sie in der Navigation `Abwesenheitsarten`.",
          "Wählen Sie oben `Abwesenheitsart`.",
          "Geben Sie einen Namen ein, zum Beispiel Regenerationstag.",
          "Lassen Sie `Tage je Person zählen (Kontingent)` an und tragen Sie die Tage je Jahr ein.",
          "Wählen Sie bei `Rest verfällt`, wie lange ein Rest ins neue Jahr geht.",
          "Schalten Sie `Betreuungskräfte dürfen beantragen` an, wenn sie die Art selbst beantragen sollen.",
          "Wählen Sie `Anlegen`.",
        ],
      },
      {
        title: "Den Anspruch einer Person ändern",
        description: "Ohne eigenen Wert gilt für jede Person die Zahl der Art.",
        steps: [
          "Öffnen Sie unter `Personalakten` die Akte der Person.",
          "Wählen Sie in der Karte `Kontingente` das Jahr.",
          "Wählen Sie bei der Art `Anspruch ändern`.",
          "Tragen Sie die Tage und eine Begründung ein. Wählen Sie `Speichern`.",
        ],
      },
      {
        title: "Eine Art ausschalten",
        steps: [
          "Wählen Sie bei der Art das Menü mit den drei Punkten.",
          "Wählen Sie `Ausschalten`.",
        ],
      },
    ],
    steps: [],
    result:
      "moto trägt die Art sofort in alle Ihre Schulen. Jede Buchung und jeder offene Antrag an jeder Schule zählt für das eine Kontingent der Person. Mehr als das Kontingent lässt sich an keiner Schule eintragen.",
    notes: [
      "Hat eine Schule schon eine eigene Art mit demselben Namen, wird sie Teil Ihrer Art. Ihre Buchungen bleiben.",
      "Eine Schule darf abweichen, nur für ihre eigenen Einsätze: Sie bietet die Art nicht an, oder sie erlaubt weniger Tage. Sie sehen das bei jeder Art unter `An den Schulen`.",
      "Den Antrag einer Betreuungskraft entscheidet die Leitung der Schule, an der sie den Antrag stellt.",
      "Urlaub, Krank, Fortbildung, Sonstige und Freizeitausgleich gibt es immer. Den Urlaubsanspruch führen Sie mit dem Arbeitsvertrag.",
      "Jedes Anzeigen der Kontingente steht im Zugriffsprotokoll jeder Schule der Person.",
    ],
    differences: [
      "Bei einer Schule steht `Noch nicht übernommen`: Die Schule war beim Speichern nicht erreichbar. Speichern Sie die Art noch einmal.",
      "Sie können den Namen nicht mehr ändern: Eine Schule hat die Art schon gebucht. Gebuchte Tage behalten ihren Namen.",
    ],
    troubleshootingDetails: [
      "„Der Anspruch reicht nicht“: An den Schulen sind schon mehr Tage eingetragen oder beantragt. Die Zahl darf nicht kleiner sein.",
    ],
    related: [HELP_TOPICS.traegerStaffRecords, HELP_TOPICS.traegerAccessLog],
  };
}
