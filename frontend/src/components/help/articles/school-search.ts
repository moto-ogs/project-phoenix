import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

// Die Suche über die ganze Schul-App (#6954, ADR 0231; Notizen #7012, ADR 0234). Was jemand findet,
// entscheidet der Server nach den Rechten des Kontos; der Artikel nennt nur,
// was die Person dann anders sieht.
export function schoolSearchTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.schoolSearch,
    title: "Mit der Suche finden",
    question:
      "Wie finde ich schnell ein Kind, eine Familie, eine Seite oder eine Einstellung?",
    summary:
      "Eine Suche findet Kinder, Familien, Team, Räume, Gruppen, Seiten, Einstellungen und Hilfe.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "ListSearch",
    steps: [],
    instructionGroups: [
      {
        title: "Die Suche öffnen",
        ordered: false,
        steps: [
          "Am Computer: Wähle oben `Überall suchen`. Oder drücke Strg und K. Am Mac drücke ⌘ und K. Das geht auch am Tablet mit Tastatur.",
          "Am Tablet: Wähle oben neben dem Fragezeichen die Lupe.",
          "Am Handy: Wähle unten `Mehr` und dann ganz oben `Überall suchen`. Der Reiter `Suchen` unten öffnet dagegen `Alle Kinder`.",
        ],
      },
      {
        title: "Suchen und öffnen",
        steps: [
          "Gib mindestens zwei Zeichen ein.",
          "Du kannst einen Namen, eine Klasse, eine Gruppe, eine Telefonnummer oder eine E-Mail-Adresse eingeben.",
          "Die Treffer stehen nach Art sortiert: `Kinder`, `Sorgeberechtigte und Kontakte`, `Mitarbeitende`, `Räume`, `Gruppen`, `Seiten`, `Einstellungen` und `Hilfe`.",
          "Wähle einen Treffer. Oder wähle ihn mit den Pfeiltasten und drücke Enter.",
        ],
      },
      {
        title: "Seiten, Einstellungen und Hilfe finden",
        steps: [
          "Gib den Namen einer Seite ein, zum Beispiel `Dienstplan`. Die Suche findet auch Seiten in den Bereichen der Seitenleiste, etwa in `Datenverwaltung` oder `Planung`. Unter dem Treffer steht der Bereich.",
          "Gib den Namen einer Einstellung ein, zum Beispiel `Passwort`. Wähle den Treffer. moto öffnet die Seite mit dieser Einstellung.",
          "Unter `Hilfe` stehen passende Anleitungen. Sie öffnen sich in einem neuen Tab.",
        ],
      },
      {
        // Der Anlass aus #6954: verpasste Anrufe im Büro.
        title: "Eine Telefonnummer suchen",
        steps: [
          "Gib die Nummer so ein, wie du sie siehst, oder füge sie aus einer E-Mail ein. Leerzeichen, Striche, +49 oder eine 0 am Anfang sind egal.",
          "Steht hinter der Nummer eine Durchwahl, findet moto die Nummer auch ohne sie.",
          "Auch die letzten Ziffern reichen, mindestens vier ohne Vorwahl 0 oder +49.",
          "Der Treffer zeigt die Person und das Kind, zu dem sie gehört.",
          "Wähle den Treffer. moto öffnet beim Kind den Reiter `Erziehungsberechtigte`.",
        ],
      },
      {
        title: "In Notizen suchen",
        steps: [
          "Gib ein Wort aus einer Notiz ein, zum Beispiel `Ausflug`.",
          "Du siehst die Kinder mit einer passenden Notiz. Darunter steht der Teil der Notiz mit deinem Wort.",
          "Wähle den Treffer. moto öffnet beim Kind den Reiter `Notizen`.",
        ],
      },
      {
        title: "Nach Angaben aus der Anmeldung suchen",
        steps: [
          "Gib einen Begriff aus dem Anmeldeformular ein, zum Beispiel `schwimmen`.",
          "Du siehst die Kinder, bei denen die Eltern dazu etwas angegeben haben. Darunter steht die Frage und die Antwort.",
          "Eine ganze Liste brauchst du? Öffne `Alle Kinder` und wähle das Filtersymbol. Unter `Anmeldung` wählst du eine Antwort aus `Angabe aus der Anmeldung`.",
          "Bei Fragen mit freiem Text, Zahl oder Datum wählst du dort `Angabe vorhanden`. Was genau drinsteht, findest du hier in der Suche.",
        ],
      },
    ],
    result:
      "Du landest direkt beim Kind, bei der Person, im Raum, auf der Seite oder bei der Einstellung.",
    differences: [
      "Du findest nur, was du auch ohne Suche sehen darfst. Telefonnummern, E-Mail-Adressen, Elternnotizen, Einträge aus dem Reiter `Notizen` und Angaben aus der Anmeldung finden nur Konten, die Kontaktdaten sehen dürfen.",
      "Eine Notiz findest du nur, wenn du sie auch im Reiter `Notizen` siehst. Eine Notiz für das Betreuungsteam findet nur, wer das Kind betreut. Eine Notiz für die Leitung findet nur die Leitung der genannten Gruppe.",
      "Die Einstellungen der Schule findet nur, wer sie öffnen darf. Die Einstellungen im eigenen Profil findet jede Person.",
      "Ein Gruppen-Treffer öffnet `Alle Kinder` mit den Kindern dieser Gruppe.",
      "Gesundheitsangaben durchsucht die Suche nicht. Öffne dafür das Kind.",
    ],
    notes: [
      "Ohne Eingabe zeigt die Suche die Hauptseiten, die du öffnen darfst.",
      "Brauchst du alle Kinder mit einem Namen? Öffne `Alle Kinder` und suche dort.",
    ],
    related: [HELP_TOPICS.studentSearch, HELP_TOPICS.appOverview],
  };
}
