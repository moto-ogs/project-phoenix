import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/news`: Elternbriefe, Mitteilungen und Umfragen. Manche verlangen
 * eine Lesebestaetigung, Umfragen eine Antwort.
 */
export function parentNewsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentNews,
    title: "Elternbriefe lesen und beantworten",
    question: "Wo finde ich Post von der OGS?",
    summary:
      "Unter `Elternbriefe` stehen Mitteilungen, Umfragen und Anfragen zum Einverständnis.",
    group: "nachrichten",
    audience: "parent",
    icon: "Megaphone",
    steps: [],
    instructionGroups: [
      {
        title: "Einen Elternbrief bestätigen",
        steps: [
          "Tippe unten auf `Mehr`.",
          "Wähle `Elternbriefe`.",
          "Tippe auf den Eintrag unter `Offen`.",
          "Lies den Text.",
          "Tippe auf `Gelesen bestätigen`.",
        ],
      },
      {
        title: "Eine Umfrage beantworten",
        steps: [
          "Öffne die Umfrage unter `Offen`.",
          "Wähle deine Antwort.",
          "Tippe auf `Antwort speichern`.",
        ],
      },
      {
        title: "Auf ein Einverständnis antworten",
        steps: [
          "Öffne den Eintrag `Einverständnis` unter `Offen`.",
          "Lies den Text und die Dateien.",
          "Tippe beim Kind auf `Zustimmen` oder `Ablehnen`.",
          "Prüfe im Fenster das Kind und deine Antwort.",
          "Verlangt die Schule eine Unterschrift? Unterschreibe im Feld mit dem Finger oder der Maus. Tippe dann auf `Unterschrift bestätigen`.",
          "Bestätige im Fenster mit demselben Knopf.",
        ],
      },
      {
        title: "Eine Zustimmung widerrufen",
        steps: [
          "Öffne den Eintrag `Einverständnis` unter `Erledigt`. Hat die Schule den Text geändert und fragt neu, steht er unter `Offen`.",
          "Tippe beim Kind auf `Zustimmung widerrufen`.",
          "Bestätige im Fenster mit `Widerrufen`.",
        ],
      },
    ],
    result: "Erledigte Einträge wandern von `Offen` zu `Erledigt`.",
    notes: [
      "Hast du mehrere Kinder an der Schule? Manche Elternbriefe gibt es für jedes Kind einzeln. Oben im Brief wählst du dann den Namen des Kindes.",
      "Die Bestätigung heißt `Lesebestätigung`. Damit bestätigst du nur, dass du den Brief gelesen hast.",
      "Bei mehreren Kindern zeigt moto, wie viele Antworten noch fehlen.",
      "Angehängte Dateien öffnest du, indem du auf den Namen tippst.",
      "Nach deiner Antwort öffnest du mit `Nachweis ansehen` deinen Nachweis. Mit `Als PDF herunterladen` speicherst du ihn.",
    ],
    differences: [
      "Umfragen tragen über dem Titel `Umfrage`, Einverständnisse `Einverständnis`, abgesagte Betreuung trägt `Betreuung fällt aus`.",
      "Unten am Eintrag steht, ob er `Wichtig` ist, ob du eine `Erinnerung` bekommen hast und ob eine `Bestätigung erforderlich` ist.",
      "Fragt moto nach deinem Passwort? Dann möchte die Schule das vor jeder Antwort.",
      "Bei einer Umfrage steht `Antwort bis` mit dem letzten Tag.",
      "Ist die Frist vorbei, steht dort `Umfrage geschlossen`.",
      "Steht bei einem Einverständnis `Einverständnis beendet`? Dann fragt die Schule nicht mehr nach. Deine Zustimmung kannst du dort weiter widerrufen.",
      "Hat die Schule die Elternbriefe ausgeschaltet? Dann stehen unter `Erledigt` nur noch deine Zustimmungen. Du kannst sie dort weiter widerrufen.",
      "Hat die Schule den Text geändert, nachdem du zugestimmt hast? Dann fragt sie neu. Darunter steht deine Zustimmung zum alten Text mit diesem Text. Sie gilt, bis du sie mit `Zustimmung widerrufen` zurücknimmst.",
      "Steht beim Kind, dass du nicht mehr neu antworten kannst? Dann hat die OGS das für dich geändert. Deine Zustimmung kannst du trotzdem widerrufen.",
    ],
    troubleshootingDetails: [
      "moto sagt, der Elternbrief sei nicht mehr aktuell? Lade die Seite neu.",
      "moto sagt, die Schule habe den Text geändert? Lies ihn noch einmal und antworte neu.",
      "Fehlt `Elternbriefe` ganz? Dann nutzt deine OGS diese Funktion nicht.",
      "Fehlt `Zustimmung widerrufen` oder das ganze Einverständnis? Dann hast du für das Kind vielleicht keinen Zugang mehr. Frage die OGS.",
    ],
    related: [
      HELP_TOPICS.parentSurveys,
      HELP_TOPICS.parentMessages,
      HELP_TOPICS.parentNotifications,
      HELP_TOPICS.parentFeatureMissing,
    ],
  };
}
