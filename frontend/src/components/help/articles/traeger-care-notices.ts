import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerCareNoticesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCareNotices,
    title: "Jahresbescheide ausstellen",
    question: "Wie stelle ich einen Gebührenbescheid für das Jahr aus?",
    summary:
      "Ein Jahresbescheid setzt den Beitrag für mehrere Monate eines Jahres fest. Jede Familie bekommt pro Vertrag einen Bescheid mit Monatsraten. Die Raten sind jeweils am 1. des Monats fällig. Für Monate mit Bescheid berechnet der Monatslauf keine Betreuung erneut. Essen rechnet er weiterhin ab.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "CalendarDays",
    requirements: [
      "Deine Rolle im Träger-Büro ist Abrechnung.",
      "Die Preisliste hat Preise für die Monate. Der Bescheid rechnet wie der Monatslauf.",
      "Die Vorlage `Bescheid` hat eine Rechtsbehelfsbelehrung. Ohne sie stellt moto keinen Bescheid aus.",
      "Das Muster der Rechnungsnummern für Monatsbeiträge ist festgelegt. Der Bescheid nimmt seine Nummer daraus.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Lauf starten",
        steps: [
          "Wähle `Abrechnung` und dann den Reiter `Jahresbescheide`.",
          "Wähle `Jahreslauf starten`.",
          "Wähle bei `Ab Monat` den ersten Monat, zum Beispiel September. Der Bescheid gilt bis Dezember.",
          "Wähle bei `Schulen` die Schulen. Alle sind schon gewählt.",
          "Wähle bei `Bescheiddatum` das Datum auf dem Bescheid. Lässt du das Feld leer, gilt der Tag der Ausstellung.",
          "Wähle `Vorschau öffnen`.",
        ],
      },
      {
        title: "Vorschau prüfen",
        description:
          "Vor der Ausstellung ändert sich nichts. Die Vorschau zeigt immer den Stand von heute.",
        steps: [
          "Pro Kind steht eine Zeile mit Zeitraum, Monatsrate und Jahresbetrag.",
          "Wähle eine Zeile. Du siehst Seite 1 des Bescheids so, wie die Familie ihn bekommt.",
          "Unter `I. Berechnung` steht pro Modul der Betrag im Monat und für den Zeitraum.",
          "Unter `II. Abrechnung` stehen die Raten. Ein Monat, der schon begonnen hat, ist sofort fällig.",
        ],
      },
      {
        title: "Bescheide ausstellen",
        steps: [
          "Wähle `Bescheide ausstellen`.",
          "Prüfe Zahl und Summe und wähle `Ausstellen`.",
          "Jeder Bescheid bekommt seine Nummer. Danach ändert er sich nicht mehr.",
          "Hat sich seit deiner Prüfung etwas geändert, stellt moto nichts aus. Die Seite zeigt den neuen Stand. Prüfe ihn und stelle dann aus.",
        ],
      },
      {
        title: "Bescheide an die Familien senden",
        description:
          "moto speichert jeden ausgestellten Bescheid einmal als PDF. Dieses Original bleibt gleich, auch wenn sich später Briefkopf, Vorlage, Adresse oder Vertrag ändern. Die Familie bekommt den Bescheid erst, wenn du sendest.",
        steps: [
          "Öffne den ausgestellten Jahreslauf und wähle `An Familien senden`.",
          "Wähle `Originale speichern`. Gesendet wird dabei noch nichts.",
          "Wähle `An alle senden` und bestätige. Jede Familie mit E-Mail-Adresse bekommt das Original als Anhang.",
          "Hat die Familie mit dieser Adresse ein Konto in der Eltern-App, liegt der Bescheid dort unter `Dokumente`.",
          "Familien ohne E-Mail gibst du den Bescheid auf Papier. Wähle `Drucken` und dann `Nur Familien ohne E-Mail`.",
          "Einen einzelnen Bescheid sendest du über das Menü seiner Zeile mit `Senden` oder `Erneut senden`.",
        ],
      },
      {
        title: "Vertrag geändert: Änderungsbescheid",
        description:
          "Ein ausgestellter Bescheid ändert sich nie. Ändert sich ein Vertrag, gibt es einen Änderungsbescheid.",
        steps: [
          "Starte für dasselbe Jahr einen neuen Jahreslauf, zum Beispiel ab dem Monat der Änderung.",
          "Die Vorschau zeigt nur Kinder, bei denen sich etwas geändert hat. Sie stehen als `Änderungsbescheid`.",
          "Der Änderungsbescheid nennt den alten Bescheid. Pro Zeile steht `bisher`, `neu` und `Zu-/Abgang`.",
          "Stelle die Bescheide aus. Von da an gilt für diese Monate der Änderungsbescheid.",
        ],
      },
      {
        title: "Listen herunterladen",
        description:
          "Die Jahresläufe, die Bescheide eines Laufs und den Versand lädst du als Datei herunter.",
        steps: [
          "Wähle `Abrechnungsläufe` und dann den Reiter `Jahresbescheide`. Für die Bescheide öffnest du einen Jahreslauf, für den Versand dort `An Familien senden`.",
          "In der Liste der Jahresläufe, im Jahreslauf und im Versand wählst du oben rechts das Menü mit den drei Punkten. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Bescheide und der Versand enthalten personenbezogene Daten. Jeder Download wird protokolliert.",
        ],
      },
    ],
    result:
      "Jede Familie hat ihren Bescheid mit den Raten bis Dezember. Für diese Monate berechnet der Monatslauf keine Betreuung erneut. Er zählt die Kinder unter `Schon abgerechnet`.",
    differences: [
      "Hat ein Kind für einen Monat schon eine Monatsrechnung, nimmt der Bescheid diesen Monat nicht auf. Er beginnt mit dem nächsten Monat.",
      "Endet ein Vertrag, setzt der Änderungsbescheid die Monate danach auf 0,00 €. Das ist ein Abgang.",
    ],
    notes: [
      "E-Mail und Eltern-App sind keine förmliche Zustellung. Brauchst du einen Nachweis, dass die Familie den Bescheid bekommen hat? Dann stellst du ihn zusätzlich auf anderem Weg zu.",
      "Ein Änderungsbescheid ist ein eigener Bescheid mit eigenem Original. Sende ihn genauso. Der alte Bescheid bleibt unverändert.",
      "Fehlt ein Preis oder gibt es einen doppelten Vertrag, bleibt die bisherige Bewertung gültig. Prüfe die Hinweise im Monatslauf.",
      "Das Essen steht nicht im Bescheid. Die Mensa rechnet es nach den Essen ab.",
      "Der `Gesamtbetrag aller Bescheide` ist die Forderung vor Zahlungseingang. Zahlungen sieht moto nicht, auch nicht nach der Lastschrift. Ob eine Rate bezahlt ist, prüfe in deiner Buchhaltung.",
      "Ermäßigungen und Anteile von Kostenträgern stehen als eigene Zeilen im Bescheid.",
    ],
    troubleshootingDetails: [
      "Bei `Nicht angekommen`: Wähle im Menü der Zeile `Erneut senden`. Oder gib der Familie den gedruckten Bescheid.",
      "Ein Bescheid geht nicht raus und es steht `Die Person zahlt nicht mehr für diesen Vertrag`: Empfänger oder Zahler haben sich nach dem Ausstellen geändert. Der Bescheid geht nur an die Adresse, die er nennt. Drucke den Bescheid und gib ihn der Familie auf Papier.",
      "Ein Bescheid steht nicht in der Eltern-App: Das Kind hat noch keinen Schülerdatensatz, oder das Konto der Familie hat eine andere E-Mail-Adresse. Die Familie bekommt ihn per E-Mail oder auf Papier.",
      "`Bescheide ausstellen` geht nicht und oben steht `Rechtsbehelfsbelehrung fehlt`: Trage die Belehrung in der Vorlage `Bescheid` ein. Dafür brauchst du das Recht `Einstellungen`.",
      "Ein Jahreslauf lässt sich nicht starten: Für dieses Jahr gibt es schon einen offenen Lauf. Öffne ihn in der Liste. Stelle die Bescheide aus, oder schließe oder verwirf den leeren Lauf.",
      "Die Vorschau ist leer, weil alle Bescheide noch gelten: Es gibt nichts Neues auszustellen. Wähle `Jahreslauf abschließen` und dann `Abschließen`. Danach kannst du einen neuen Jahreslauf für andere Schulen starten.",
      "Der Lauf zeigt `Dieser Lauf hat nichts abzurechnen`: Seine Schulen haben in diesem Jahr keinen Vertrag. Wähle `Leeren Lauf verwerfen` und dann `Verwerfen`. Der Lauf steht danach als `Verworfen` in der Liste, und das Jahr ist frei für einen neuen Jahreslauf.",
      "Im Jahreslauf steht `Preis fehlt – Kind bekommt keinen neuen Bescheid`: Für einen Vertrag des Kindes fehlt ein Preis. Sein bisheriger Bescheid gilt weiter, auch für Tage eines anderen Vertrags. Damit der Jahreslauf keinen Tag doppelt abrechnet, bekommt der andere Vertrag keinen neuen Bescheid. Wähle `Preisliste öffnen` und trage den Preis ein. Öffne danach den Jahreslauf wieder.",
      "Im Monatslauf steht `Durch aufgehobenen Bescheid gesperrt`: Ein Änderungsbescheid hat den Monat auf 0,00 € gesetzt. Der Monat bleibt gesperrt, damit ihn niemand doppelt abrechnet. Willst du ihn abrechnen, stelle mit `Neuen Bescheid ausstellen` einen neuen Bescheid aus.",
    ],
    related: [
      HELP_TOPICS.traegerCareMonths,
      HELP_TOPICS.traegerDocumentTemplates,
      HELP_TOPICS.traegerDocumentKinds,
    ],
  };
}
