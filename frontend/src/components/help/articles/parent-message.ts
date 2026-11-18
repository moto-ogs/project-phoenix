import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function parentMessageTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentMessage,
    title: "Eltern eine Nachricht schreiben",
    question: "Wie schreibe ich Eltern eine Nachricht?",
    summary:
      "Starte eine Unterhaltung mit einer Bezugsperson oder antworte auf eine Nachricht.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "MessageSquareText",
    steps: [],
    instructionGroups: [
      {
        title: "Eine neue Unterhaltung beginnen",
        steps: [
          "Öffne unter `Eltern` den Bereich `Nachrichten`.",
          "Wähle `Neue Nachricht`.",
          "Wähle das Kind aus der Liste. Über das Suchfeld findest du es schneller.",
          "Wähle `Weiter` und dann die passende Bezugsperson.",
          "Schreibe deine Nachricht in das Textfeld.",
          "Wähle `Senden`.",
        ],
      },
      {
        title: "Eine Unterhaltung nur für die Leitung beginnen",
        description:
          "Das geht nur mit dem Recht `Vertrauliche Elternnachrichten lesen` und wenn die Schule `Nachrichten nur an die Leitung (Eltern)` eingeschaltet hat.",
        steps: [
          "Wähle unter `Nachrichten` den Knopf `Neue Nachricht`.",
          "Wähle das Kind und dann `Weiter`.",
          "Wähle bei `Wer liest auf deiner Seite mit?` den Punkt `Nur Leitung`.",
          "Wähle die Bezugsperson.",
        ],
      },
      {
        title: "Auf eine Nachricht antworten",
        steps: [
          "Öffne die Unterhaltung im Posteingang.",
          "Lies den bisherigen Verlauf.",
          "Schreibe deine Antwort in `Nachricht an die Eltern schreiben…`.",
          "Wähle `Senden`.",
        ],
      },
      {
        title: "Neues von den Eltern direkt an der Kinderkachel bearbeiten",
        description:
          "Das geht nur, wenn die Schule unter `Einstellungen` den Schalter `Neue Elternnachrichten auf der Kinderkachel` eingeschaltet hat. Die blaue Zahl oben rechts an der Kachel zählt neue Nachrichten und offene Anfragen der Eltern.",
        steps: [
          "Tippe auf die blaue Zahl an der Kinderkachel, zum Beispiel in deiner Gruppe.",
          "Lies die Elternnachrichten. Auch frühere Nachrichten sind sichtbar.",
          "Wähle `Als gelesen bestätigen`. Dann sieht das ganze Team die Nachricht nicht mehr als neu.",
          "Oder wähle `Antworten`. moto öffnet dann die Unterhaltung.",
          "Eine offene Anfrage gibst du unten im selben Fenster frei oder lehnst sie ab.",
        ],
      },
      {
        title: "Eine Unterhaltung wieder als ungelesen markieren",
        description:
          "So sieht das ganze Team: Hier ist noch etwas offen. Die Eltern merken davon nichts.",
        steps: [
          "Öffne die Unterhaltung im Posteingang.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Als ungelesen markieren`.",
          "moto bringt dich zurück zum Posteingang.",
        ],
      },
      {
        title: "Alle Nachrichten für sich als gelesen markieren",
        description:
          "Deine Zahl bei `Nachrichten` kann bleiben. Vom Team als ungelesen markierte Unterhaltungen bleiben ungelesen. Für dein Team und die Eltern ändert sich nichts.",
        steps: [
          "Öffne den Posteingang unter `Nachrichten`.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Alle als gelesen markieren`.",
        ],
      },
      {
        title: "Festlegen, was deine Zahl bei Nachrichten zählt",
        description:
          "Beantworten andere die Elternnachrichten? Dann kannst du die Zahl für sich ändern. Für dein Team ändert sich nichts.",
        steps: [
          "Öffne oben rechts dein `Profil`.",
          "Gehe zu `Zahl bei Nachrichten`.",
          "Wähle `Alle Nachrichten`, `Nur Kinder aus meinen Gruppen` oder `Keine Zahl anzeigen`.",
          "moto speichert deine Wahl sofort.",
        ],
      },
    ],
    result:
      "Die Bezugsperson sieht die Nachricht in der Eltern-App. Sie wird dort im Namen der OGS angezeigt.",
    differences: [
      "Siehst du `Nachrichten` nicht? Vielleicht ist die Funktion ausgeschaltet.",
      "Schaltet die Schule Eltern-Nachrichten während einer offenen Unterhaltung aus? Der Verlauf bleibt lesbar. Statt des Schreibfelds erscheint ein Hinweis. Du kannst nicht mehr antworten.",
      "Möglicherweise fehlt dir auch der Zugriff auf die betroffenen Kinder.",
      "Zählt die blaue Zahl an der Kinderkachel keine Anfragen? Dann darfst du Anfragen für dieses Kind nicht entscheiden. Du siehst dort nur die Nachrichten.",
      "Fehlen bei einer Anfrage `Anfrage ansehen` oder `Anfrage bearbeiten`? Dann darfst du die Anfrage für dieses Kind nicht prüfen.",
      "Steht beim Kind `Kein Eltern-Zugang`? Dann kann niemand die Nachricht in der Eltern-App lesen. Den Zugang der Eltern legst du beim Kind fest.",
      "Steht bei einer Unterhaltung `Nur Leitung`? Dann lesen sie nur die Bezugsperson und die Leitung. Begonnen hat sie die Bezugsperson oder jemand aus der Leitung. Ohne das Recht `Vertrauliche Elternnachrichten lesen` siehst du solche Unterhaltungen nicht.",
      "Eltern können nur an die Leitung schreiben, wenn unter `Einstellungen` der Schalter `Nachrichten nur an die Leitung (Eltern)` an ist und jemand das Recht `Vertrauliche Elternnachrichten lesen` hat. Das Recht vergibst du unter `Rollen`.",
    ],
    notes: [
      "Mit `Foto oder Datei anhängen` (Büroklammer neben dem Textfeld) hängst du bis zu 5 Dateien an eine Nachricht: Fotos, PDF, Word, Excel oder PowerPoint, je höchstens 10 MB. Ein Foto öffnest du mit einem Tipp groß. Die Eltern sehen die Dateien in der Eltern-App.",
      "Über dem Schreibfeld steht, wer die Unterhaltung lesen kann: die eine Bezugsperson und alle Mitarbeitenden oder nur die Leitung. Andere Bezugspersonen des Kindes lesen nicht mit.",
      "Schreibe persönliche Angaben nur in die Unterhaltung der richtigen Bezugsperson.",
      "Mit `Nur ungelesen` siehst du nur neue Unterhaltungen.",
      "Eine als ungelesen markierte Unterhaltung bleibt für alle ungelesen, bis jemand aus dem Team sie öffnet oder antwortet.",
      "Unter deiner Nachricht steht hinter `E-Mail`, was aus der Mail an die Eltern wurde, zum Beispiel `Zugestellt` oder `Nicht zustellbar`. Kam sie nicht an, steht darunter, was du tun kannst.",
      "Die Eltern sehen `Gelesen` erst, wenn jemand aus dem Team die Unterhaltung öffnet.",
      "Die Nachrichten stehen immer im Posteingang, auch wenn deine Zahl sie nicht zählt.",
      "Über `Zum Kinderprofil` wechselst du direkt zu den Angaben des Kindes.",
    ],
    related: [
      HELP_TOPICS.parentRequests,
      HELP_TOPICS.studentSearch,
      HELP_TOPICS.leadEmailDelivery,
    ],
  };
}
