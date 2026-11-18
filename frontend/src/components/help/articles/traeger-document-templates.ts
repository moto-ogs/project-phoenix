import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/einstellungen/briefkopf/vorlagen` (#4677): Text der Briefe mit
 * Platzhaltern; bei Bestätigung und Rechnung auch die Rechnungstabelle und
 * die Vorschau des ganzen Briefs (#5691).
 */
export function traegerDocumentTemplatesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerDocumentTemplates,
    title: "Vorlagen für Briefe anpassen",
    question: "Wie ändere ich den Text der Briefe meines Trägers?",
    summary:
      "Für jede Art von Brief legst du Betreff, Anrede, Text und Gruß fest. Bei Schreiben mit Rechnung auch, was die Rechnungstabelle zeigt. Platzhalter wie {{familienname}} füllt moto für jede Familie aus.",
    group: "konfiguration",
    audience: "traeger",
    icon: "Notebook",
    requirements: ["Du darfst im Träger-Büro Einstellungen ändern."],
    instructionGroups: [
      {
        title: "Vorlage ändern",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Briefkopf und Vorlagen`.",
          "Für das Schreiben nach der Ferienanmeldung wählst du `Schreiben anpassen`. Es steht bei `Bestätigung und Rechnung`.",
          "Für andere Schreiben wählst du bei `Weitere Vorlagen` den Knopf `Vorlagen öffnen`. Wähle dann das Schreiben.",
          "Ändere bei `Text der Vorlage` die Felder `Betreff`, `Anrede`, `Brieftext` und `Grußformel`.",
          "Für Angaben der Familie tippst du bei `Platzhalter` auf einen Eintrag, zum Beispiel {{familienname}}. moto setzt ihn im `Brieftext` ein. Er steht dort, wo du zuletzt geschrieben hast.",
          "Bei Schreiben mit Rechnung wählst du unter `Rechnungstabelle`, was die Tabelle zeigt. Es gibt `Nach Kind ordnen` und `Zeitmodell zeigen`.",
          "Wähle `Vorschau zeigen`. Die `Vorschau` zeigt den ganzen Brief mit erfundenen Beispieldaten.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Liste herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Briefkopf und Vorlagen` und dann `Vorlagen`.",
          "Wähle `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
          "Die Datei zeigt für jedes Dokument, ob es die Standardvorlage oder eine eigene Vorlage nutzt.",
        ],
      },
      {
        title: "Frühere Fassung zurückholen",
        steps: [
          "Suche unten bei `Versionen` die Fassung.",
          "Wähle `Text übernehmen`. Der Text steht dann oben im Editor.",
          "Wähle `Speichern`. Daraus wird eine neue Version.",
        ],
      },
    ],
    steps: [],
    result:
      "Jedes Speichern legt eine neue Version an. Neue Schreiben nutzen ab dann diese Version. Schreiben, die schon erstellt sind, ändern sich nicht.",
    notes: [
      "Eine leere Zeile beginnt einen neuen Absatz. Eine Zeile mit # am Anfang wird eine Überschrift. Text zwischen ** und ** wird fett.",
      "Ein Tabellen-Platzhalter wie {{positionen}} druckt eine Tabelle, wenn er allein in einer Zeile steht.",
      "Der Brief hat die Reihenfolge des Brieftexts. Steht {{positionen}} weiter oben, steht auch die Tabelle weiter oben. So ordnest du Text, Tabelle, Hinweise und Notfallnummern selbst.",
      "Einleitung, Kontaktsatz und Unterschrift schreibst du frei. Sie stehen im `Brieftext` und in der `Grußformel`. Statt {{rueckfragen}} geht auch ein eigener Satz.",
      "Woche, Betrag, Ermäßigungen und Gesamtbetrag stehen immer in der Rechnungstabelle. Das sind Pflichtangaben einer Rechnung.",
      "Die `Vorschau` zeigt auch Anschrift, Rechnungsnummer und Debitorennummer. So siehst du Text, Nummern und Tabelle zusammen.",
      "Sind alle Platzhalter eines Absatzes leer, fehlt der Absatz im Brief. So entfallen zum Beispiel die Notfallnummern, wenn keine eingetragen sind.",
      "Mit `Standardtext laden` holst du den Text von moto zurück in den Editor.",
      "Die Vorlage `Gebührenbescheid` hat ein eigenes Feld `Rechtsbehelfsbelehrung`. Ohne diesen Text gibt moto keinen Gebührenbescheid frei. Er steht immer nach dem Brieftext.",
      "moto nutzt die Vorlagen für das Bestätigungsschreiben der Ferien, den Betreuungsvertrag, die Ferienrechnung und den Gebührenbescheid. Welches Schreiben ein Lauf ausstellt, legst du unter `Dokumentarten` fest. Die anderen Dokumente folgen.",
    ],
    differences: [
      "Du kannst die Vorlage nur ansehen? Dir fehlt die Rolle `Verwaltung`. Die Rollen vergibt, wer die Rolle `Leitung` hat.",
    ],
    troubleshootingDetails: [
      "moto nimmt die Vorlage nicht an und nennt Platzhalter? Diese kennt das Dokument nicht. Prüfe die Schreibweise mit der Liste `Platzhalter`.",
      "Die Meldung sagt, dass sich die Vorlage nicht geändert hat? Der Text ist gleich wie die aktuelle Version. Es entsteht keine neue Version.",
    ],
    related: [
      HELP_TOPICS.traegerBriefkopf,
      HELP_TOPICS.traegerBillingRun,
      HELP_TOPICS.traegerDocumentKinds,
      HELP_TOPICS.errorMessages,
    ],
  };
}
