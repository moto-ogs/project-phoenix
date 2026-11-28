import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import {
  OWN_STAFF_PROFILE_TROUBLESHOOTING,
  SIMPLE_NAV_DIFFERENCE,
} from "../help-article-shared";

export function trackWorkTimeTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.trackWorkTime,
    title: "Arbeitszeit und Pausen erfassen",
    question: "Wie erfasse ich meine Arbeitszeit und Pausen?",
    summary:
      "Stemple dich zu Arbeitsbeginn ein. Erfasse Pausen und das Arbeitsende.",
    group: "arbeitszeit",
    audience: ["caregiver", "lead"],
    icon: "Timer",
    steps: [],
    instructionGroups: [
      {
        title: "Arbeitszeit starten",
        steps: [
          "Klappe in der Seitenleiste `Team` auf und öffne `Zeiterfassung`.",
          "Wähle unter `Stempeluhr` den Arbeitsort `In der OGS` oder `Unterwegs`. `Unterwegs` heißt zum Beispiel Ausflug, Fortbildung oder zu Hause.",
          "Wähle `Einstempeln`.",
        ],
      },
      {
        title: "Eine Pause erfassen",
        steps: [
          "Wähle `Pause starten`.",
          "Wähle die geplante Pausenlänge.",
          "Wähle `Starten`.",
          "Wähle `Pause beenden`, wenn du früher weiterarbeitest.",
        ],
      },
      {
        title: "Arbeitszeit beenden",
        steps: ["Beende zuerst eine laufende Pause.", "Wähle `Ausstempeln`."],
      },
      {
        // App-Oberfläche unter 40rem (#8070, ADR 0323): Die Knöpfe stehen
        // in der Leiste über der unteren Leiste, der Arbeitsort im Blatt.
        title: "Auf dem Handy",
        steps: [
          "Öffne `Zeiterfassung`. Steht sie nicht in der Leiste unten, findest du sie unter `Mehr`.",
          "Wähle unten `Einstempeln`.",
          "Wähle `In der OGS einstempeln` oder `Unterwegs einstempeln`.",
          "Für eine Pause wähle unten `Pause`. Wähle die Pausenlänge und dann `Pause starten`.",
          "`Pause beenden` und `Ausstempeln` stehen dann ebenfalls unten.",
        ],
      },
    ],
    result:
      "Deine Arbeitszeit erscheint in der Wochenübersicht und in der Tabelle `Zeiterfassung`.",
    notes: [
      "Nach dem Stempeln steht oben in der `Stempeluhr` kurz `Wird gespeichert`. Danach meldet moto, ob es geklappt hat.",
      // Live geprueft: `Einstempeln` ist ein runder Knopf mit dem Wort
      // darunter. Ohne gewaehlten Arbeitsort steht dort `Bitte Status wählen`.
      "`Einstempeln` steht unter dem runden Knopf in der Mitte.",
      "Oben steht dein Stand: `Ist`, `Soll` und `Saldo`.",
    ],
    differences: [
      "Steht dort `Bitte Status wählen`? Dann fehlt noch der Arbeitsort. Wähle zuerst `In der OGS` oder `Unterwegs`.",
      "Steht in der `Stempeluhr` `Du stempelst am NFC-Tablet`? Dann stempelst du an deiner Schule nur mit deinem Armband am Tablet. Deine Zeiten siehst du weiter hier. Eine falsche Zeit korrigiert die Leitung.",
      "Eine geplante Schicht steht oberhalb der Stempeluhr. Sie startet die Zeiterfassung nicht automatisch.",
      "Bei einer deutlichen Abweichung von deiner geplanten Schicht kann moto nach einem Grund fragen.",
      "Deine Schule kann das Einstempeln erst kurz vor deiner Schicht erlauben. Dann zeigt moto, ab wann es geht.",
      "Nach der gewählten Pausenlänge läuft die Arbeitszeit automatisch weiter.",
      "Dein `Ist` ist etwas länger oder kürzer als die gestempelten Zeiten? Dann zählt deine OGS eine Wegpackzeit dazu oder rundet. Der Hinweis steht in der Zeile, zum Beispiel `+5 Min. Wegpackzeit`.",
      "Steht unten `Kein Soll hinterlegt`? Dann zählen Krankheit und Urlaub 0 Stunden. Die Monatskarte zeigt diese Tage mit `ohne Soll`. Das Soll trägt die Leitung ein.",
      SIMPLE_NAV_DIFFERENCE,
    ],
    troubleshootingDetails: [OWN_STAFF_PROFILE_TROUBLESHOOTING],
    related: [HELP_TOPICS.correctWorkTime, HELP_TOPICS.nfcWorkTime],
  };
}
