import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerSepaMandatesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSepaMandates,
    title: "Lastschrift und SEPA-Mandate",
    question: "Wie buche ich Beiträge per Lastschrift ab?",
    summary:
      "Du trägst deine Gläubiger-ID und die Mandate der Familien ein. Die Rechnung kündigt die Abbuchung an. moto bucht kein Geld ab.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "Repeat",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Der Zahlungsweg der Leistung oder der Familie ist `Lastschrift`.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Gläubiger-ID eintragen",
        description:
          "Die Gläubiger-ID bekommst du von der Bundesbank. Ohne sie gibt es keine Lastschrift und kein Mandat. Ein Mandat gilt nur für die Gläubiger-ID, die beim Erfassen eingetragen war. Änderst du die Gläubiger-ID, brauchen alle Familien ein neues Mandat.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen` und dann `Abrechnungsvorgaben`.",
          "Wähle in der Karte `Lastschrift` den Knopf `Ändern`.",
          "Trage die `Gläubiger-ID` ein.",
          "Bei `Vorabankündigung in Tagen` steht 14. So viele Tage vor der Abbuchung muss die Rechnung bei der Familie sein. Weniger Tage nur, wenn du das mit den Familien vereinbart hast.",
          "Wähle bei `Wenn eine Familie kein gültiges Mandat hat`: `Als Überweisung ausstellen` oder `Freigabe anhalten`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Mandat einer Familie erfassen",
        description:
          "Je Familie gilt ein Mandat. Es gilt auch für Geschwister mit derselben E-Mail-Adresse im Vertrag. Stehen Geschwister mit demselben Konto und derselben Mandatsreferenz in mehreren Zeilen, legt moto das Mandat einmal an. Die Vorschau zeigt die weiteren Zeilen als `Gleiches Mandat`.",
        steps: [
          "Öffne den Vertrag des Kindes unter `Verträge`. Oder öffne im Monatslauf bei der Rechnung das Menü mit den drei Punkten und dann `Empfänger und Zahlung`.",
          "Wähle in der Karte `SEPA-Lastschriftmandat` den Knopf `Mandat erfassen`. Es öffnet sich die Seite des Mandats. Bei einem Entwurf fehlt die Karte: Sende den Vertrag zuerst. Ein verworfener Entwurf würde das Mandat mitlöschen.",
          "Wähle dort `Mandat erfassen`.",
          "Übernimm `Kontoinhaber`, `IBAN` und `Unterschrieben am` aus dem unterschriebenen Mandat. Die `BIC` brauchst du nur bei Konten außerhalb der EU.",
          "Trage die `Mandatsreferenz` ein. Lässt du das Feld leer, vergibt moto eine.",
          "Wähle die `Art`: `Dauermandat` für jeden Monat oder `Einzelmandat` für eine Abbuchung.",
          "Wähle bei `Wurde mit diesem Mandat schon abgebucht?` die passende Antwort. Bei einem Mandat aus einem anderen Programm meistens `Ja, schon einmal`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Mandat in der Eltern-App erlauben",
        description:
          "Eltern können das Mandat dann selbst bei ihrem Vertrag erteilen und widerrufen. Sie bestätigen den Text als Kontoinhaber. Frage vorher deine Bank, ob sie Mandate annimmt, die online bestätigt wurden. Einschalten darf, wer im Träger-Büro das Recht `Einstellungen` hat.",
        steps: [
          "Wähle unten in der Navigation `Einstellungen` und dann `Allgemein`.",
          "Öffne den Bereich `Monatsbeitrag`.",
          "Schalte `Lastschrift-Mandat in der Eltern-App` ein.",
        ],
      },
      {
        title: "Bestehende Mandate importieren",
        description:
          "Hast du die Mandate schon in einem anderen Programm, zum Beispiel OGS Connect? Dann übernimm alle auf einmal aus einer CSV-Datei. Referenz und Datum der Unterschrift bleiben gleich. moto bewahrt die Datei nicht auf.",
        steps: [
          "Speichere die Mandate im anderen Programm als CSV-Datei. Die erste Zeile enthält die Überschriften.",
          "Aus OGS Connect nimm den Export der Stammdaten. Er hat eine Zeile je Kind. moto schlägt dort die Spalte `Debitor-Nr.` als Zahler vor. Dafür muss moto die Debitorennummern schon kennen, zum Beispiel aus `Verträge importieren` oder aus dem Reiter `Familien`.",
          "Öffne unter `Abrechnung` den Reiter `Lastschrift`. Wähle oben rechts das Menü mit den drei Punkten und dann `Mandate importieren`.",
          "Ziehe die Datei in das Feld oder wähle `Datei wählen`.",
          "Prüfe unter `Spalten zuordnen`, aus welcher Spalte jedes Feld kommt. moto schlägt passende Spalten vor.",
          "Wähle bei `Die Spalte „Zahler“ enthält`, ob dort die E-Mail der Familie, die Vertragsnummer oder die Debitorennummer steht. Bei `Debitorennummer` sucht moto die Nummer des Kindes oder des Zahlers, je nach deiner Einstellung.",
          "Hat deine Datei keine Spalte mit der Gläubiger-ID? Dann bestätige, dass alle Mandate zu deiner Gläubiger-ID gehören.",
          "Prüfe die Zeilen unter `Prüfen und übernehmen`. Bei `Bitte klären` wählst du unter `Schon abgebucht?` die Antwort `Ja` oder `Nein`.",
          "Wähle unten `übernehmen`. Der Knopf nennt Mandate und Debitorennummern getrennt.",
        ],
      },
      {
        title: "Mandat widerrufen",
        steps: [
          "Öffne unter `Familien und Zahlung` im Reiter `Lastschrift` die Familie. Oder wähle beim Vertrag `Mandat ansehen`.",
          "Wähle beim Mandat das Menü mit den drei Punkten und dann `Widerrufen`.",
          "Wähle bei `Widerruf erhalten am` den Tag, an dem der Widerruf kam.",
          "Wähle `Widerrufen`.",
        ],
      },
      {
        title: "Mandate herunterladen",
        steps: [
          "Wähle `Familien und Zahlung` und dann den Reiter `Lastschrift`.",
          "Wähle oben rechts das Menü mit den drei Punkten. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Mandate, auch die widerrufenen.",
          "Die Datei enthält personenbezogene Daten. Jeder Download wird protokolliert.",
        ],
      },
    ],
    result:
      "Neue Lastschrift-Rechnungen nennen den Betrag, den Abbuchungstag und den Kontoinhaber. Dort stehen auch die verdeckte IBAN, die Gläubiger-ID und die Mandatsreferenz. Ist der Kontoinhaber jemand anderes? Dann bittet das Schreiben darum, es an diese Person weiterzugeben. Der Betrag enthält nur den Anteil der Familie.",
    notes: [
      "Die Mandate siehst du unter `Familien und Zahlung` im Reiter `Lastschrift`. Die Liste zeigt zuerst die gültigen; mit `Alle` siehst du auch die widerrufenen.",
      "Ein Mandat aus der Eltern-App hat die Herkunft `von den Eltern`. moto speichert dazu den bestätigten Text mit Prüfsumme, das Konto der Eltern und die Uhrzeit. Widerrufen die Eltern in der App, gilt das ab dem nächsten Monatslauf.",
      "Ob die App Mandate annimmt, siehst du unter `Abrechnungsvorgaben` in der Karte `Lastschrift` bei `Mandat in der Eltern-App`. Ohne Gläubiger-ID oder ohne Absender im Briefkopf nimmt die App kein Mandat an.",
      "Die IBAN siehst du nach dem Speichern nur verdeckt. So steht sie auch auf der Rechnung.",
      "`Verlauf ansehen` zeigt, wer das Mandat wann angesehen oder geändert hat. Bei importierten Mandaten stehen dort auch Dateiname und Zeile. Kontodaten stehen dort nicht.",
      "Für Zeilen ohne IBAN und ohne Mandatsreferenz legt moto kein Mandat an. Die Vorschau zählt sie als „ohne Mandat“. Das sind meist Kinder, deren Familie ohne Lastschrift zahlt. Eine fehlende Debitorennummer übernimmt moto trotzdem, solange es keinen Konflikt gibt. Konflikte zeigt die Vorschau mit der Zeilennummer.",
      "Mandate übernimmt moto nur mit dem Stand `Bereit`. Fehlende Debitorennummern kannst du auch bei vorhandenen Mandaten übernehmen. Die Vorschau zählt jede Familie einmal. Unterschiedliche Nummern werden nicht übernommen. Korrigiere die Datei und lade sie noch einmal.",
      "Führt dein Träger die Debitorennummer je Kind, bekommt jedes Kind die Nummer seiner Zeile. Geschwister dürfen verschiedene Nummern haben. Damit moto das Kind erkennt, wähle als Zahler die Vertragsnummer oder die Debitorennummer. Mit der E-Mail erkennt moto das Kind nur, wenn die Familie ein Kind mit Vertrag hat.",
      "Ein Mandat aus der Datei, mit dem schon abgebucht wurde, übernimmt moto als Folgelastschrift. Steht die letzte Abbuchung in der Datei, zählen die 36 Monate bis zum Verfall ab diesem Tag. Fehlt sie, zählen sie ab dem Import.",
      "Weißt du, dass die letzte Abbuchung lange her ist? Dann trage das Datum in der Datei ein oder hole ein neues Mandat ein. Ohne Datum geht moto davon aus, dass das Mandat bis kurz vor dem Import genutzt wurde.",
    ],
    differences: [
      "Die Familie hat kein gültiges Mandat? Mit `Als Überweisung ausstellen` bekommt sie eine Rechnung zum Überweisen. Die Prüfung des Monatslaufs zeigt sie in der Karte `Lastschrift`.",
      "Mit `Freigabe anhalten` lässt sich der Lauf erst freigeben, wenn jede Familie mit Lastschrift ein gültiges Mandat hat.",
      "`Mandat erfassen` fehlt? Die Familie hat schon ein gültiges Mandat. Widerrufe es zuerst.",
    ],
    troubleshootingDetails: [
      "Die Mandate sind übernommen, aber die Liste der Importe fehlt? Wähle dort `Erneut laden`. Die Mandate musst du nicht noch einmal übernehmen.",
      "Die IBAN wird nicht angenommen? Prüfe jedes Zeichen. moto prüft die Prüfziffer.",
      "Beim Import steht `Konflikt`? Das Mandat passt nicht zu dem, was moto schon hat: eine andere Gläubiger-ID, eine schon vergebene Mandatsreferenz oder eine Familie mit einem anderen gültigen Mandat. moto überschreibt nichts. Kläre das Mandat und erfasse es bei Bedarf von Hand.",
      "Beim Import steht `Zu diesem Zahler gibt es bei dir keinen Vertrag`? Prüfe die E-Mail-Adresse, Vertragsnummer oder Debitorennummer in der Datei. Sie muss zu einem Vertrag deines Trägers passen. Eine Debitorennummer muss moto schon kennen.",
      "Die Prüfung meldet `früher als deine Vorabankündigung erlaubt`? Die Abbuchung kommt zu früh nach dem Rechnungsdatum. Ändere die Fälligkeit des Laufs oder das Rechnungsdatum.",
    ],
    related: [
      HELP_TOPICS.traegerSepaDebitFile,
      HELP_TOPICS.traegerBillingTerms,
      HELP_TOPICS.traegerCareMonths,
    ],
  };
}
