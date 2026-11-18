import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/einstellungen/mitglieder` (#4650, #5474, #5685, #4693): Personen einladen, Namen und Rollen ändern, entfernen, Verlauf. */
export function traegerAccountsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerAccounts,
    title: "Personen ins Träger-Büro einladen",
    question:
      "Wie lade ich Personen ins Träger-Büro ein und gebe ihnen Rollen?",
    summary:
      "Unter `Mitglieder und Rollen` lädst du Kolleginnen und Kollegen ein. Die Rolle bestimmt, was eine Person darf.",
    group: "einstieg",
    audience: "traeger",
    icon: "UsersThree",
    requirements: ["Du hast die Rolle `Leitung`."],
    instructionGroups: [
      {
        title: "Person einladen",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Mitglieder und Rollen`.",
          "Wähle `Person einladen`.",
          "Trage die `E-Mail-Adresse` ein.",
          "Wähle mindestens eine Rolle.",
          "Wähle `Einladung senden`.",
        ],
      },
      {
        title: "Namen eintragen oder ändern",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Mitglieder und Rollen`.",
          "Öffne bei der Person das Menü mit den drei Punkten.",
          "Wähle `Namen eintragen`. Hat die Person schon einen Namen, heißt der Eintrag `Namen ändern`.",
          "Trage den `Name` ein und wähle `Speichern`.",
        ],
      },
      {
        title: "Rollen ändern",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Mitglieder und Rollen`.",
          "Öffne bei der Person das Menü mit den drei Punkten.",
          "Wähle `Rollen ändern`.",
          "Wähle die Rollen und dann `Speichern`.",
        ],
      },
      {
        title: "Liste herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Mitglieder und Rollen`.",
          "Wähle oben `Herunterladen` und dann `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Personen und offenen Einladungen.",
          "Den Verlauf lädst du mit `Herunterladen` beim `Verlauf` herunter.",
        ],
      },
      {
        title: "Person entfernen",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Mitglieder und Rollen`.",
          "Öffne bei der Person das Menü mit den drei Punkten.",
          "Wähle `Aus dem Träger-Büro entfernen`.",
          "Wähle `Ja, entfernen` und dann `Entfernen`.",
        ],
      },
      {
        title: "Verlauf ansehen",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Mitglieder und Rollen`.",
          "Scrolle nach unten zu `Verlauf`.",
          "Ältere Änderungen siehst du mit `Ältere Einträge laden`.",
        ],
      },
    ],
    steps: [],
    result:
      "Die eingeladene Person steht unter `Offene Einladungen`, bis sie die Einladung annimmt.",
    notes: [
      "`Leitung` darf Personen einladen, ihre Rollen ändern und sie entfernen. `Verwaltung` darf Anmeldungen, Verträge, Einstellungen und das Protokoll verwalten. `Dokumente` darf Dokumente für Eltern und Schulen hochladen, freigeben und löschen. `Schulzugang` darf jede Schule des Trägers öffnen. `Abrechnung` darf abrechnen und Finanzdaten exportieren. `Personal` darf das Personal verwalten. `Nur lesen` darf die Übersicht und die Berichte ansehen.",
      "Nur eine Person mit `Leitung` kann `Leitung` vergeben oder wegnehmen. Deine eigene `Leitung` gibst du erst ab, wenn eine andere Person sie hat.",
      "Eine Person kann mehrere Rollen haben. Wähle alle Rollen auf einmal aus.",
      "Wer bisher `Verwaltung` hatte, hat `Dokumente` dazubekommen. Soll sich eine andere Person um die Dokumente kümmern? Gib ihr `Dokumente` und nimm die Rolle bei der Verwaltung weg.",
      "Unter `Offene Einladungen` stehen auch Einladungen, die das moto-Team verschickt hat.",
      "Der Name steht im Exportprotokoll und im Verlauf jeder Rechnung, die E-Mail-Adresse nie. Steht bei einer Person `Kein Name`, zeigen diese Stellen „von einem Konto ohne Namen“.",
      "Jede Person kann ihren eigenen Namen auch selbst ändern: im Profil-Menü unter `Konto`.",
      "Unter `Verlauf` steht, wer wann eingeladen, Rollen oder Namen geändert oder entfernt hat. Bei Rollen siehst du, welche vorher galten und welche jetzt gelten.",
      "Änderst du die Rollen einer Person oder entfernst du sie, bekommt die Person eine E-Mail. Darin steht, wer es war und wann. Das gilt auch, wenn du deine eigenen Rollen änderst.",
    ],
    differences: [
      "Du siehst in den Einstellungen kein `Mitglieder und Rollen`? Dann hast du nicht die Rolle `Leitung`.",
      "Neue Rollen gelten nach wenigen Minuten. Nimmst du eine Rolle weg, wird die Person sofort abgemeldet. Sie meldet sich dann neu an. Das gilt auch für deine eigenen Rollen.",
      "Eine entfernte Person wird sofort abgemeldet. Sie kann sich nicht mehr anmelden.",
    ],
    troubleshootingDetails: [
      "Du kannst bei `Leitung` keinen Haken entfernen? Dann hat nur diese Person die Rolle. Gib die Rolle zuerst einer anderen Person.",
      "moto sagt, das Träger-Büro brauche mindestens eine Person mit der Rolle Leitung? Gib die Rolle zuerst einer anderen Person.",
      "Die Einladung ist abgelaufen? Lade die Person noch einmal ein. Die alte Einladung gilt dann nicht mehr.",
      "Eine Einladung soll nicht mehr gelten? Wähle bei der Einladung `Einladung zurücknehmen`.",
    ],
    related: [HELP_TOPICS.traegerInvitation, HELP_TOPICS.traegerProfile],
  };
}
