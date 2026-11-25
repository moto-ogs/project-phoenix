import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Serienbriefe (#4813): ein Elternbrief, der jedes Kind mit seinen eigenen
 * Angaben nennt, und alle Briefe eines Versands als PDF zum Drucken.
 */
export function parentLetterPerChildTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadParentLetterPerChild,
    title: "Einen Elternbrief mit den Angaben jedes Kindes schreiben",
    question: "Wie nenne ich in einem Elternbrief jedes Kind mit Namen?",
    summary:
      "moto setzt für jedes Kind Name, Klasse, Gruppe, Betreuungstage und Abholzeit in den Brief. Alle Briefe gibt es auch als PDF zum Drucken.",
    group: "elternarbeit",
    audience: "lead",
    icon: "NotePencil",
    steps: [],
    instructionGroups: [
      {
        title: "Den Brief schreiben",
        steps: [
          "Klappe in der Seitenleiste `Eltern` auf.",
          "Öffne `Mitteilungen`.",
          "Wähle oben `Elternbriefe`.",
          "Wähle oben rechts `+ Elternbrief`.",
          "Schreibe bei `Text` den Brief.",
          "Setze die Schreibmarke an die Stelle für eine Angabe. Wähle unter `Für jedes Kind einsetzen` zum Beispiel `Vorname`.",
          "Prüfe den Brief unter `So liest die Familie den Brief`. Wähle dort ein anderes Kind, wenn du möchtest.",
          "Wähle unten `Weiter`, dann die Empfänger, dann `Veröffentlichen`.",
        ],
      },
      {
        title: "Alle Briefe drucken",
        description: "Für Familien, die den Brief auf Papier brauchen.",
        steps: [
          "Öffne den veröffentlichten Elternbrief.",
          "Wähle oben im Kasten `Elternbrief` den Knopf `Briefe drucken`.",
          "Drucke das PDF. Jedes Kind hat einen eigenen Brief mit Name und Logo der Schule.",
        ],
      },
    ],
    result:
      "Jede Familie bekommt einen Brief pro Kind, mit den Angaben ihres eigenen Kindes. Geschwister bekommen pro Kind einen Brief.",
    notes: [
      "moto schreibt den Brief beim Veröffentlichen fest. Ändern sich danach Gruppe oder Abholzeit, bleibt der Brief, wie er war.",
      "Fehlt bei einem Kind eine Angabe, bleibt die Stelle leer. Steht in einer Zeile nur diese Angabe, zum Beispiel `Abholzeit:`, lässt moto die ganze Zeile weg.",
      "Gesundheitsangaben gibt es als Platzhalter nicht.",
      "Briefe ohne Platzhalter druckt moto genauso, einen pro Kind.",
    ],
    troubleshootingDetails: [
      "Fehlt die Auswahl der Kinder für die Vorschau? Klicke bei der Fehlermeldung auf `Wiederholen`.",
      "Die Knöpfe unter `Für jedes Kind einsetzen` fehlen? Klicke bei der Fehlermeldung auf `Wiederholen`.",
      "moto meldet `Diese Platzhalter kennt moto nicht`? Nimm den Platzhalter heraus. Setze ihn mit den Knöpfen unter `Für jedes Kind einsetzen` neu ein.",
      "Im Betreff geht kein Platzhalter. Schreibe ihn in den Text.",
    ],
    image: "/help/screens/elternbrief-angaben-jedes-kindes.webp",
    imageAlt:
      "Neuer Elternbrief: unter dem Text die Knöpfe zum Einsetzen von Vorname, Gruppe und Abholzeit, darunter der Brief, wie ihn die Familie von Felix liest.",
    related: [HELP_TOPICS.leadParentLetter, HELP_TOPICS.leadParentAnnouncement],
  };
}
