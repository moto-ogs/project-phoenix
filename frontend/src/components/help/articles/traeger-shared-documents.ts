import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/dokumente` (#4692): vorhandene Dokumente hochladen und für
 * Eltern oder Schulen freigeben; eine Freigabe zurücknehmen; ein Dokument
 * löschen (#5993). Schreiben darf die Rolle Dokumente (#5992).
 */
export function traegerSharedDocumentsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSharedDocuments,
    title: "Dokumente für Eltern und Schulen freigeben",
    question: "Wie teile ich ein Dokument mit Eltern oder Schulen?",
    summary:
      "Du lädst eine Datei hoch, die du schon hast, zum Beispiel eine Hausordnung oder eine Liste. Dann gibst du sie für Eltern oder für Schulen frei.",
    group: "elternarbeit",
    audience: "traeger",
    icon: "EnvelopeOpen",
    requirements: [
      "Du hast die Rolle `Dokumente`. Wer bisher `Verwaltung` hatte, hat sie dazubekommen.",
      "Die Datei ist ein PDF, ein Word-, Excel- oder PowerPoint-Dokument oder ein Bild. Sie ist höchstens 10 MB groß.",
    ],
    instructionGroups: [
      {
        title: "Dokument hochladen",
        steps: [
          "Wähle in der Navigation `Dokumente`.",
          "Wähle oben `Dokument hochladen`.",
          "Ziehe die Datei in das Feld. Oder wähle `Datei auswählen`.",
          "Prüfe den `Titel`. Eltern und Schulen sehen diesen Titel.",
          "Wähle `Hochladen`. moto öffnet danach die Seite des Dokuments.",
        ],
      },
      {
        title: "Dokument freigeben",
        steps: [
          "Öffne das Dokument in der Liste `Dokumente`.",
          "Wähle oben `Freigeben`.",
          "Wähle bei `Für wen?` entweder `Eltern` oder `Schulen`.",
          "Wähle bei `An welchen Schulen?`: `Alle Schulen`, `Eine Schule` oder bei Eltern auch `Eine Gruppe`.",
          "Wähle dann die `Schule` und gegebenenfalls die `Gruppe`.",
          "Prüfe den Kasten `Sichtbar für`. Wähle `Freigeben`.",
        ],
      },
      {
        title: "Liste herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Wähle in der Navigation `Dokumente`.",
          "Wähle `Herunterladen` und dann `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Dokumente und für wen sie freigegeben sind.",
        ],
      },
      {
        title: "Freigabe zurücknehmen",
        steps: [
          "Öffne das Dokument.",
          "Wähle bei der Freigabe `Zurücknehmen`.",
          "Bestätige mit `Ja, zurücknehmen` und dann `Zurücknehmen`.",
        ],
      },
      {
        title: "Dokument löschen",
        description:
          "Alle Freigaben enden dabei. Die Datei ist danach weg, auch für dich.",
        steps: [
          "Öffne das Dokument.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle `Dokument löschen`.",
          "Prüfe, welche Freigaben enden.",
          "Tippe `LÖSCHEN` ein. Wähle `Endgültig löschen`.",
        ],
      },
    ],
    steps: [],
    result:
      "Eltern finden das Dokument in der Eltern-App unter `Dokumente`. Die OGS-Leitung findet es in moto unter `Dateien` bei `Vom Träger`. Nach dem Zurücknehmen sehen sie es sofort nicht mehr, außer eine andere Freigabe des Dokuments gilt auch für sie. Nach dem Löschen sieht es niemand mehr, auch nicht über einen gespeicherten Link. Eltern mit eingeschalteter Nachricht `Neues Dokument vom Träger` bekommen bei der Freigabe eine Nachricht aufs Handy. Sie nennt keinen Titel und kein Kind.",
    notes: [
      "Ein Dokument kann mehrere Freigaben haben. Zum Beispiel für die Eltern einer Gruppe und für alle Schulen.",
      "Eltern, die ein Dokument schon sehen, bekommen bei einer weiteren Freigabe keine zweite Nachricht. Nimmst du die Freigabe zurück, kommt auch keine Nachricht mehr.",
      "Eine Freigabe für Eltern sieht auch die OGS-Leitung der Schule. So weiß sie, was die Eltern bekommen haben.",
      "Bei `Geöffnet` siehst du, wie oft Eltern und Schulen das Dokument geöffnet haben.",
      "Auch nach dem Löschen bleibt im Nachweis, wer das Dokument wann freigegeben, geöffnet und gelöscht hat.",
    ],
    differences: [
      "Du siehst `Dokument hochladen`, `Freigeben` und das Menü zum Löschen nicht? Dir fehlt die Rolle `Dokumente`. Du kannst die Dokumente nur ansehen und herunterladen. Die Rolle gibt dir eine Person mit der Rolle `Leitung` unter `Einstellungen` bei `Mitglieder und Rollen`.",
    ],
    troubleshootingDetails: [
      "moto nimmt die Datei nicht an? Prüfe Art und Größe. Eine umbenannte Datei erkennt moto am Inhalt.",
      "Bei `Eine Gruppe` steht keine Gruppe? Die Schule hat in moto noch keine Gruppen angelegt.",
      "Die Meldung sagt, das Dokument ist schon freigegeben? Für diese Menschen gibt es schon eine Freigabe.",
    ],
    related: [
      HELP_TOPICS.traegerDocumentTemplates,
      HELP_TOPICS.traegerAccounts,
      HELP_TOPICS.errorMessages,
    ],
  };
}
