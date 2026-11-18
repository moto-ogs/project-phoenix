import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerSepaDebitFileTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSepaDebitFile,
    title: "Lastschriftdatei bei der Bank einreichen",
    question: "Wie reiche ich die Lastschriftdatei bei meiner Bank ein?",
    summary:
      "Für jeden freigegebenen Lauf lädst du eine Datei für deine Bank herunter. Du lädst die Datei in deinem Online-Banking hoch. Danach bestätigst du es in moto. moto bucht kein Geld ab, das macht deine Bank.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "ArrowUpRight",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Der Monatslauf, Ferienlauf oder Jahresbescheid ist freigegeben.",
      "Die Familien haben ein gültiges SEPA-Mandat.",
      "Unter `Einstellungen` → `Abrechnung` gibt es eine Bankverbindung als Standard. Auf dieses Konto gehen die Beiträge.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Datei herunterladen",
        steps: [
          "Öffne unter `Abrechnung` den freigegebenen Lauf.",
          "Prüfe in der Karte `Lastschrift` Zahl, Summe und Tag der Abbuchung.",
          "Wähle `Datei herunterladen`. Du bekommst eine XML-Datei.",
          "Lasse diese Seite offen, bis du das Einreichen bestätigt hast.",
        ],
      },
      {
        title: "Raten aus dem Jahresbescheid",
        description:
          "Für Raten aus dem Jahresbescheid gibt es eine Datei je Monat.",
        steps: [
          "Wähle `Abrechnung`, dann den Reiter `Jahresbescheide`, und öffne den freigegebenen Lauf.",
          "Wähle oben rechts `Lastschrift der Raten`.",
          "Wähle bei `Raten fällig im` den Monat.",
          "Lade die Datei herunter und reiche sie ein wie oben.",
        ],
      },
      {
        title: "Datei bei der Bank einreichen",
        description:
          "So geht es in den meisten Online-Bankings. Die Wörter können bei deiner Bank etwas anders heißen.",
        steps: [
          "Melde dich im Online-Banking deines Vereins an.",
          "Suche `Datei hochladen`, `Sammellastschrift` oder `SEPA-Datei einreichen`.",
          "Wähle die heruntergeladene Datei aus.",
          "Prüfe Zahl und Summe. Sie müssen zur Karte `Lastschrift` passen.",
          "Gib den Auftrag frei, zum Beispiel mit TAN.",
        ],
      },
      {
        title: "In moto bestätigen",
        description:
          "Bestätige erst, wenn deine Bank die Datei angenommen hat.",
        steps: [
          "Wähle in der Karte `Lastschrift` den Knopf `Bei der Bank eingereicht`.",
          "Wähle `Ja, eingereicht`.",
        ],
      },
    ],
    result:
      "Die Karte zeigt `Bei der Bank eingereicht`. Bei einem neuen Mandat ist die nächste Abbuchung eine Folgelastschrift. Auf der Seite des Mandats steht jede Abbuchung unter `Abbuchungen`.",
    notes: [
      "Du kannst die Datei mehrmals herunterladen. Ohne Änderungen am selben Tag bleibt ihr Inhalt gleich. Reiche dieselbe Datei aber nur einmal ein.",
      "Jeder Download bekommt eine neue Dateinummer im Namen und steht unter `Abrechnung` → `Exporte` im `Exportprotokoll`.",
      "Eine Lastschrift, die schon fällig war, bucht die Datei am nächsten Tag ab.",
      "Ein Einmalmandat darf nur eine Rechnung einziehen. Bei mehreren Rechnungen klärst du mit der Familie, wie sie zahlt.",
      "Ein Mandat gilt 36 Monate nach der letzten Abbuchung. Danach braucht die Familie ein neues Mandat.",
    ],
    differences: [
      "Die Karte `Lastschrift` fehlt? In diesem Lauf zahlt keine Familie per Lastschrift.",
      "Die Karte `Nicht in der Datei` zeigt Familien? Für sie darf die Bank nicht abbuchen. Der Grund steht dabei. Prüfe das Mandat mit `Mandat prüfen`.",
    ],
    troubleshootingDetails: [
      "`Datei herunterladen` geht nicht? Es fehlt die Bankverbindung als Standard. Wer das Recht `Einstellungen` hat, legt sie fest.",
      "moto meldet, die Datei hat sich geändert? Seit dem Herunterladen wurde eine Rechnung storniert oder ein Mandat geändert. Lade die Datei neu herunter und reiche die neue ein.",
      "Deine Bank lehnt die Datei ab? Bestätige in moto nichts. Frage deine Bank nach dem Grund.",
    ],
    related: [HELP_TOPICS.traegerSepaMandates, HELP_TOPICS.traegerCareMonths],
  };
}
