import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/einstellungen/briefkopf` (#4653, #5685, #5624): Logo, Absender, Fußzeile und QR-Code zum Überweisen; dazu Ansprechperson und Bankverbindungen. */
export function traegerBriefkopfTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerBriefkopf,
    title: "Briefkopf und Bankverbindungen hinterlegen",
    question: "Wie sehen die Briefe meines Trägers aus?",
    summary:
      "Logo, Absender, Farbe, Fußzeile, Ansprechperson und Bankverbindungen stehen auf allen Briefen und Rechnungen deines Trägers.",
    group: "konfiguration",
    audience: "traeger",
    icon: "FileText",
    requirements: ["Du darfst im Träger-Büro Einstellungen ändern."],
    instructionGroups: [
      {
        title: "Logo hochladen",
        steps: [
          "Wähle unten in der Navigation `Einstellungen`.",
          "Wähle `Briefkopf und Vorlagen`.",
          "Wähle bei `Logo` den Knopf `Logo hochladen`.",
          "Wähle ein Bild im Format PNG oder JPG, bis 1 MB.",
        ],
      },
      {
        title: "Absender, Farbe und Fußzeile eintragen",
        steps: [
          "Wähle in den Einstellungen `Briefkopf und Vorlagen`.",
          "Trage bei `Absender im Briefkopf` Name und Anschrift ein. Jede Zeile im Feld ist eine Zeile im Brief. Die erste Zeile steht fett und in deiner Farbe.",
          "Klicke bei `Farbe für Briefe und Rechnungen` auf eine der Farben.",
          "Passt keine Farbe, wähle `Eigene Farbe`. Klicke dann auf den farbigen Kreis und wähle deine Farbe. Steht im Logo-Entwurf ein Farbcode, trage ihn in das Feld daneben ein: eine Raute und sechs Zeichen.",
          "Trage bei `Fußzeile` zum Beispiel Vorstand, Amtsgericht und Steuernummer ein, jede Angabe in eine eigene Zeile.",
          "moto speichert jedes Feld von selbst.",
        ],
      },
      {
        title: "QR-Code zum Überweisen ein- oder ausschalten",
        description:
          "Der QR-Code steht auf Rechnung, Gebührenbescheid und Bestätigungsschreiben, wenn die Familie überweist. Er ist von Anfang an eingeschaltet.",
        steps: [
          "Wähle in den Einstellungen `Briefkopf und Vorlagen`.",
          "Schalte bei `GiroCode drucken` den Schalter aus oder ein. Der GiroCode ist der QR-Code zum Überweisen.",
          "moto speichert die Änderung sofort. Sie gilt für alle Schreiben, die du danach erstellst.",
        ],
      },
      {
        title: "Ansprechperson eintragen",
        steps: [
          "Wähle in den Einstellungen `Allgemein` und dann den Bereich `Kontakt`.",
          "Trage bei `Ansprechperson` Name, Telefon und E-Mail-Adresse ein.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Bankverbindung hinzufügen",
        steps: [
          "Wähle in den Einstellungen `Abrechnungsvorgaben`.",
          "Wähle bei `Bankverbindungen` den Knopf `Bankverbindung hinzufügen`.",
          "Gib eine Bezeichnung ein, zum Beispiel Elternbeiträge.",
          "Gib Kontoinhaber und IBAN ein. BIC und Bank sind freiwillig.",
          "Wähle `Speichern`.",
        ],
      },
    ],
    steps: [],
    result:
      "Die `Vorschau` oben auf der Seite `Briefkopf und Vorlagen` zeigt, wie Kopf und Fuß eines Briefs aussehen.",
    notes: [
      "Ein leeres Feld für Absender oder Fußzeile zeigt ein graues Beispiel. Das Beispiel steht nie im Brief.",
      "Eine Bankverbindung ist der `Standard`. Sie steht auf allen Briefen und Rechnungen. Auch der QR-Code zum Überweisen nimmt diese Bankverbindung.",
      "Eine andere Bankverbindung machst du im Menü der Zeile mit `Als Standard festlegen` zum Standard.",
      "Löschst du den Standard, wird die älteste andere Bankverbindung der Standard.",
      "Schreiben, die schon erstellt sind, ändern sich nicht. Sie behalten ihren QR-Code oder bleiben ohne.",
      "Jedes Ansehen und jede Änderung von Ansprechperson und Bankverbindungen steht im Protokoll des Trägers.",
    ],
    differences: [
      "Auf dem Handy öffnest du in der Leiste unten `Mehr` und dann `Einstellungen`. `Abrechnungsvorgaben` steht dort wieder unter `Mehr`.",
      "Du kannst die Angaben nur ansehen? Dir fehlt die Rolle `Verwaltung`. Die Rollen vergibt, wer die Rolle `Leitung` hat.",
    ],
    troubleshootingDetails: [
      "Das Logo wird nicht übernommen? Es muss ein PNG- oder JPG-Bild sein, höchstens 1 MB groß und höchstens 2000 Pixel breit und hoch.",
      "Die IBAN wird abgelehnt? Prüfe jede Ziffer. moto prüft die Prüfziffern der IBAN.",
    ],
    related: [HELP_TOPICS.traegerSettings, HELP_TOPICS.errorMessages],
  };
}
