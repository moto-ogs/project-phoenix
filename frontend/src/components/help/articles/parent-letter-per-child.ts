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
          "Klappen Sie in der Seitenleiste `Eltern` auf.",
          "Öffnen Sie `Mitteilungen`.",
          "Wählen Sie oben `Elternbriefe`.",
          "Wählen Sie oben rechts `+ Elternbrief`.",
          "Schreiben Sie bei `Text` den Brief.",
          "Setzen Sie die Schreibmarke an die Stelle für eine Angabe. Wählen Sie unter `Für jedes Kind einsetzen` zum Beispiel `Vorname`.",
          "Prüfen Sie den Brief unter `So liest die Familie den Brief`. Wählen Sie dort ein anderes Kind, wenn Sie möchten.",
          "Wählen Sie unten `Weiter`, dann die Empfänger, dann `Veröffentlichen`.",
        ],
      },
      {
        title: "Alle Briefe drucken",
        description: "Für Familien, die den Brief auf Papier brauchen.",
        steps: [
          "Öffnen Sie den veröffentlichten Elternbrief.",
          "Wählen Sie oben im Kasten `Elternbrief` den Knopf `Briefe drucken`.",
          "Drucken Sie das PDF. Jedes Kind hat einen eigenen Brief mit Name und Logo der Schule.",
        ],
      },
    ],
    result:
      "Jede Familie bekommt einen Brief je Kind, mit den Angaben ihres eigenen Kindes. Geschwister bekommen je Kind einen Brief.",
    notes: [
      "moto schreibt den Brief beim Veröffentlichen fest. Ändern sich danach Gruppe oder Abholzeit, bleibt der Brief, wie er war.",
      "Fehlt bei einem Kind eine Angabe, bleibt die Stelle leer. Steht in einer Zeile nur diese Angabe, zum Beispiel `Abholzeit:`, lässt moto die ganze Zeile weg.",
      "Gesundheitsangaben gibt es als Platzhalter nicht.",
      "Briefe ohne Platzhalter druckt moto genauso, einen je Kind.",
    ],
    troubleshootingDetails: [
      "moto meldet `Diese Platzhalter kennt moto nicht`? Nehmen Sie den Platzhalter heraus. Setzen Sie ihn mit den Knöpfen unter `Für jedes Kind einsetzen` neu ein.",
      "Im Betreff geht kein Platzhalter. Schreiben Sie ihn in den Text.",
    ],
    image: "/help/screens/elternbrief-angaben-jedes-kindes.webp",
    imageAlt:
      "Neuer Elternbrief: unter dem Text die Knöpfe zum Einsetzen von Vorname, Gruppe und Abholzeit, darunter der Brief, wie ihn die Familie von Felix liest.",
    related: [HELP_TOPICS.leadParentLetter, HELP_TOPICS.leadParentAnnouncement],
  };
}
