import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/documents` (#4671, #4678, #4679, #4692): Schreiben und Verträge
 * des Trägers, den Betreuungsvertrag unterschreiben, und Dokumente, die der
 * Träger für Eltern freigegeben hat; die Kündigung eines Vertrags (#4682);
 * die Nachricht `Neues Dokument vom Träger` für alle drei Arten (#5941); das
 * Lastschrift-Mandat erteilen und widerrufen (#4696).
 */
export function parentDocumentsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentDocuments,
    title: "Dokumente vom Träger finden",
    question: "Wo finde ich Schreiben vom Träger?",
    summary:
      "Unter `Dokumente` liegen die Schreiben und Verträge, die dir der Träger geschickt hat. Dort findest du auch Dokumente, die der Träger für Eltern freigegeben hat, etwa eine Hausordnung.",
    group: "nachrichten",
    audience: "parent",
    icon: "FileText",
    instructionGroups: [
      {
        title: "Ein Schreiben laden",
        steps: [
          "Tippe unten auf `Mehr`.",
          "Wähle `Dokumente`.",
          "Wähle beim Schreiben `Als PDF laden`. Bei einem freigegebenen Dokument wählst du `Herunterladen`.",
        ],
      },
      {
        title: "Den Betreuungsvertrag unterschreiben",
        description:
          "Ein Vertrag mit `Wartet auf deine Unterschrift` braucht deine Unterschrift. Das geht auch über den Link in der Mail, ohne Konto.",
        steps: [
          "Wähle beim Vertrag `Lesen und unterschreiben`.",
          "Lies die gebuchte Betreuung und den Vertrag als PDF.",
          "Lies die Widerrufsbelehrung. Setze den Haken bei `Ich habe die Widerrufsbelehrung gelesen.`",
          "Soll die Betreuung schon vor dem Ende der Widerrufsfrist beginnen? Setze auch diesen Haken.",
          "Unterschreibe mit dem Finger oder tippe deinen Namen. Wähle `Unterschrift bestätigen`.",
          "Wähle `Vertrag verbindlich unterschreiben`.",
        ],
      },
      {
        title: "Eine geänderte Fassung unterschreiben",
        description:
          "Hat die OGS oder der Träger die Betreuung geändert? Dann steht beim Vertrag `Änderung wartet auf deine Unterschrift`. Bis du unterschreibst, gilt dein Vertrag wie bisher.",
        steps: [
          "Wähle beim Vertrag `Änderung ansehen und unterschreiben`. Das geht auch über den Link in der Mail, ohne Konto.",
          "Lies die Karte `Das ändert sich`. Durchgestrichen ist die Betreuung bisher. Daneben steht die neue. `Geändert`, `Neu` und `Entfällt` zeigen die Tage, die anders sind.",
          "Lies die neue Fassung als PDF und die Widerrufsbelehrung. Setze den Haken bei `Ich habe die Widerrufsbelehrung gelesen.`",
          "Unterschreibe mit dem Finger oder tippe deinen Namen. Wähle `Unterschrift bestätigen`.",
          "Wähle `Neue Fassung verbindlich unterschreiben`.",
        ],
      },
      {
        title: "Kinder in der Familie angeben",
        description:
          "Für die Geschwisterermäßigung zählt der Träger alle Kinder deiner Familie. Auch Kinder ohne Betreuungsvertrag zählen mit.",
        steps: [
          "Wähle beim Vertrag `Lesen und unterschreiben` oder `Kinder in der Familie angeben`. Ohne Konto öffnest du den Link aus der Vertragsmail.",
          "Gehe zur Karte `Kinder in deiner Familie`.",
          "Stelle mit Minus und Plus ein, wie viele Kinder deine Familie hat.",
          "Wähle `Angabe senden`.",
        ],
      },
      {
        title: "Lastschrift-Mandat erteilen",
        description:
          "Mit dem Mandat erlaubst du deinem Träger, Beiträge abzubuchen. Wie du bezahlst, steht auf deiner Rechnung. Das geht nur, wenn dein Träger es in der App anbietet. Sonst fehlt der Knopf `Lastschrift`.",
        steps: [
          "Wähle beim Vertrag `Lastschrift`.",
          "Prüfe den `Kontoinhaber`. Trage die `IBAN` und deine Anschrift ein.",
          "Wähle `Weiter`.",
          "Lies den Text des Mandats.",
          "Setze den Haken bei `Ich bin Inhaberin oder Inhaber dieses Kontos.`",
          "Wähle `Mandat erteilen`.",
        ],
      },
    ],
    steps: [],
    result:
      "Du bekommst das Dokument auf dein Gerät. Du kannst es speichern oder drucken. Nach der Unterschrift steht beim Vertrag `Unterschrieben`, und du bekommst eine Bestätigung mit dem Vertrag per Mail.",
    notes: [
      "Das sind die Bestätigungsschreiben der Ferienbetreuung und die Betreuungsverträge. Das Bestätigungsschreiben ist auch deine Rechnung.",
      "Hat dein Träger dir einen Gebührenbescheid für das Jahr geschickt, liegt er hier mit demselben PDF wie in der Mail. Ändert sich dein Vertrag, kommt ein Änderungsbescheid dazu. Der alte Bescheid bleibt hier stehen.",
      "Beim Betreuungsvertrag stehen die gebuchte Betreuung und der Beginn auf der Karte. Prüfe im PDF jeden Wochentag und den Beitrag. Stimmt etwas nicht, melde dich beim Träger.",
      "Steht beim Vertrag `Abgeschlossen` statt `Unterschrieben`? Dann gilt er seit der Annahme deiner Anmeldung. Du musst nichts unterschreiben. Hebe ihn gut auf.",
      "Du möchtest den Vertrag beenden? Wähle beim Vertrag `Verträge hier kündigen`. Wähle den Termin und dann `Jetzt kündigen`. Solange du den Vertrag widerrufen kannst, steht beim Vertrag auch `Vertrag widerrufen`. Wähle dann `Widerruf bestätigen`. Du bekommst sofort eine Bestätigung per Mail und auf dem Bildschirm, mit Datum und Uhrzeit des Eingangs. Ändern sich die Termine nach Mitternacht? Wähle dann erneut.",
      "Hast du einen wichtigen Grund, den Vertrag früher zu beenden? Wähle `Außerordentlich kündigen` und schreibe deinen Grund auf. Der Träger prüft ihn. Erkennt er ihn an, legt er das Vertragsende fest. Erkennt er ihn nicht an, gilt deine Kündigung als ordentliche Kündigung zum nächsten möglichen Termin. Die Entscheidung bekommst du per Mail. Sie steht auch beim Vertrag unter `Mitteilung des Trägers zum Vertragsende`. Bis dahin findet die Betreuung wie gebucht statt.",
      "Bei einem gekündigten Vertrag steht `Gekündigt zum` und das Datum. Bis dahin findet die Betreuung wie gebucht statt. Mit `Bestätigung ansehen` öffnest du deine Bestätigung.",
      "Du möchtest andere Tage oder Zeiten? Beantrage das bei deinem Kind mit `Betreuung ändern`. Bestätigt die Schule, bekommt dein Vertrag eine neue Version.",
      "Du darfst Anmeldungen nur ansehen? Wähle beim Vertrag `Kinder in deiner Familie`. Dort siehst du die Angabe und die bestätigte Zahl. Du kannst die Zahl nicht ändern.",
      "Über den Link aus der Vertragsmail änderst du die Kinderzahl bis zur Unterschrift. Danach geht das in der Eltern-App unter `Dokumente`.",
      "Deine Angabe zur Kinderzahl prüft der Träger. Bis dahin steht `Wird geprüft`. Hat er sie bestätigt, steht `Bestätigt`. Erst dann zählt sie für die Ermäßigung.",
      "Nach dem Mandat steht beim Vertrag `Lastschrift erteilt`. Unter `Lastschrift` siehst du dein Konto, die Mandatsreferenz und den Text. Mit `Als Datei speichern` legst du den Text bei deinen Unterlagen ab.",
      "Du möchtest ein anderes Konto nutzen oder keine Lastschrift mehr? Wähle unter `Lastschrift` den Knopf `Mandat widerrufen`. Ab der nächsten Rechnung bucht dein Träger nichts mehr ab. Danach kannst du ein neues Mandat erteilen.",
      "Jedes Schreiben bekommst du auch per Mail.",
      "Bei einem freigegebenen Dokument steht `Vom Träger für Eltern freigegeben`. Es gilt für alle Eltern, für die der Träger es freigegeben hat, zum Beispiel für eine Gruppe. Diese Dokumente kommen nicht per Mail.",
      "Du möchtest eine Nachricht auf dem Handy bekommen, wenn ein neues Dokument da ist? Schalte unter `Einstellungen` den Punkt `Neues Dokument vom Träger` ein. Das gilt für Schreiben, Verträge und freigegebene Dokumente.",
      "Die Nachricht nennt kein Kind und keinen Betrag. Was gekommen ist, siehst du unter `Dokumente`.",
    ],
    troubleshootingDetails: [
      "Ein Schreiben fehlt? Hier liegt es nur, wenn es an die Mail-Adresse deines Kontos ging. Hast du bei der Anmeldung eine andere Adresse angegeben, bekommst du es nur per Mail.",
      "Statt der Liste steht, dass dir die Berechtigung fehlt? Bitte frage die Schule.",
      "Der Link in der Mail gilt nicht mehr? Er gilt nur einmal und 30 Tage. Unterschreibe in der Eltern-App unter `Dokumente`. Oder frage beim Träger nach einem neuen Link.",
      "Beim Vertrag fehlt `Lesen und unterschreiben`? Dann darf dein Konto für dieses Kind nicht unterschreiben. Bitte frage die Schule.",
      "Ein freigegebenes Dokument ist verschwunden? Der Träger hat die Freigabe zurückgenommen oder das Dokument gelöscht.",
      "Das Dokument ist da, aber es kam keine Nachricht? Prüfe unter `Einstellungen` den Punkt `Neues Dokument vom Träger`. Schickt der Träger dasselbe Dokument noch einmal, kommt keine zweite Nachricht.",
      "Unter `Lastschrift` steht `Lastschrift hier nicht möglich`? Dein Träger nimmt das Mandat nicht in der App an. Frage ihn nach einem Formular auf Papier.",
      "Unter `Lastschrift` steht `Neues Mandat nötig`? Mit diesem Mandat ist keine weitere Abbuchung möglich. Widerrufe es und erteile ein neues. Ohne dieses Recht frage die Schule.",
      "Du siehst das Mandat, aber `Mandat widerrufen` fehlt? Das Mandat erteilen und widerrufen nur Eltern, die das Kind auch anmelden dürfen. Das Recht vergibt die Schule.",
      "`Verträge hier kündigen` fehlt? Der Vertrag gilt noch nicht, oder er ist schon beendet. Oder dir fehlt das Recht: Kündigen dürfen nur Eltern, die das Kind auch anmelden dürfen. Dann steht beim Vertrag ein Hinweis. Das Recht vergibt die Schule.",
    ],
    related: [
      HELP_TOPICS.parentCareChange,
      HELP_TOPICS.parentHolidayRegistration,
      HELP_TOPICS.parentNotifications,
    ],
  };
}
