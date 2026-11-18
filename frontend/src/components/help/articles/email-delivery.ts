import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Die Zustellhinweise (#5934). Sie stehen dort, wo eine Mail entsteht (#7058):
 * Einladung der Eltern, Elternbrief, Nachricht und Gruppennachricht, Termin,
 * Einladung ins Personal und des Caterers (#5960), Anmeldung, Versand an das
 * Lohnbüro, Abwesenheitsanträge und, für den Träger, der Versand der Schreiben.
 * Hier steht, was jedes Wort bedeutet und wer als Nächstes handelt.
 * `Versendet` heißt nur: Die Mail ist raus. `Zugestellt` meldet erst der
 * Mail-Dienst, und ohne ihn (reines SMTP, Notweg) bleibt es bei `Versendet`.
 */
export function emailDeliveryTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadEmailDelivery,
    title: "Wenn eine E-Mail nicht ankommt",
    question: "Was bedeuten Zugestellt, Verzögert und Adresse prüfen?",
    summary:
      "moto zeigt bei jeder Mail, was aus ihr geworden ist und was du tun kannst.",
    group: "elternarbeit",
    audience: "lead",
    icon: "EnvelopeSimple",
    steps: [],
    instructionGroups: [
      {
        title: "Hier siehst du den Stand",
        ordered: false,
        steps: [
          "Elternbrief: im geöffneten Brief bei jeder Person.",
          "Nachricht an Eltern: unter deiner Nachricht hinter `E-Mail`.",
          "Gruppennachricht: unter jeder Nachricht hinter `E-Mails`, gezählt je Ergebnis.",
          "Termin mit Eltern: im Termin unter `E-Mails an die Eltern`. Das sieht, wer den Termin angelegt hat.",
          "Einladung der Eltern: beim Kind unter `Erziehungsberechtigte`.",
          "Einladung ins Personal und des Caterers: unter `Offene Einladungen`.",
          "Anmeldung: in der Anmeldung unter `E-Mails an die Familie`.",
          "Versand an das Lohnbüro: unter `Abrechnung` bei `Letzter Versand`.",
          "Antrag auf Urlaub oder Abwesenheit: am Antrag, für dich und für die Leitung.",
        ],
      },
      {
        title: "Das bedeuten die Hinweise",
        ordered: false,
        steps: [
          "`Wird gesendet`: Die Mail wartet noch.",
          "`Versendet`: Die Mail ist raus. Ob sie im Postfach ankam, ist nicht bekannt.",
          "`Zugestellt`: Die Mail ist angekommen.",
          "`Verzögert`: Die Mail kommt später an. Es wird weiter versucht. Bitte sende sie nicht noch einmal.",
          "`Überfällig`: Die Mail ist seit Tagen verzögert. Du kannst sie noch einmal senden.",
          "`Nicht zustellbar`: Die Mail kam nicht an.",
          "`Als unerwünscht gemeldet`: Die Mail kam an. Die Person hat sie danach als unerwünscht gemeldet. Sprich sie direkt an.",
          "`Nicht gesendet`: Die Mail ging nicht raus. Der Hinweis nennt den Grund. Besteht er nicht mehr, kannst du neu senden.",
          "`Gesperrt`: Diese Adresse ist gesperrt. Eine neue Mail hilft nicht. Der moto-Support muss das klären.",
          "`Stand unklar`: Ob die Adresse gesperrt ist, lässt sich gerade nicht prüfen. Versuche es später noch einmal.",
          "`Nicht versendet`: Es gab keine Mail, zum Beispiel weil die Adresse fehlt.",
          "`Fehlgeschlagen`: Das Senden hat nicht geklappt. Besteht keine aktuelle Sperre, kannst du neu senden.",
          "`Ergebnis unbekannt`: Ob die Mail rausging, ist nicht bekannt.",
          "`Abgebrochen`: Die Mail wurde nicht mehr gesendet.",
          "`Abgemeldet`: Die Person hat sich von den Mails abgemeldet. Sprich sie direkt an.",
          "`Alte Adresse abgemeldet` oder `Alte Adresse gesperrt`: Die Person hat inzwischen eine neue Adresse. Eine neue Mail an diese Adresse ist möglich.",
          "`Adresse prüfen`: An diese Adresse geht keine Mail mehr raus, weil sie gesperrt ist.",
          "`Versand gestoppt`: Deine Schule hat die Mails an diese Person gestoppt. Nutzt noch jemand diese Adresse, gehen Mails an die Adresse weiter raus.",
          "`Kein Kind in Betreuung`: Die Familie bekommt keine Elternbriefe, Nachrichten, Termine und Einladungen mehr. Das frühere Versandergebnis bleibt daneben stehen.",
        ],
      },
      {
        title: "Einen Elternbrief neu senden",
        description:
          "Das geht für Mails, die nicht ankamen. Gesperrte Adressen, gestoppte Personen und Familien ohne Kind in Betreuung bekommen keine neue Mail.",
        steps: [
          "Öffne den Elternbrief und sieh dir den Status an.",
          "Steht bei einer Person `Adresse prüfen`? Prüfe zuerst die Adresse wie unten beschrieben.",
          "Wähle `Fehlgeschlagene erneut senden`. moto sendet an die aktuelle Adresse der Person.",
        ],
      },
      {
        title: "Eine gesperrte Adresse prüfen",
        description:
          "Die Sperre gilt, bis jemand an deiner Schule die Adresse geprüft hat.",
        steps: [
          "Öffne das Kind und den Reiter `Erziehungsberechtigte`.",
          "Frage die Familie nach der richtigen Adresse.",
          "Ist die Adresse falsch: Wähle im Menü der Person `Bearbeiten` und trage die richtige ein.",
          "Ist die Adresse richtig: Wähle im Menü der Person `Sperre aufheben` und bestätige.",
          "Sende danach neu, zum Beispiel mit `Erneut einladen`.",
        ],
      },
      {
        title: "Mails an eine Person stoppen",
        description:
          "Zum Beispiel, wenn eine Person keine Mails der Schule mehr bekommen möchte. Der Stopp bleibt, auch wenn sich die Adresse ändert.",
        steps: [
          "Öffne das Kind und den Reiter `Erziehungsberechtigte`.",
          "Wähle im Menü der Person `Mails stoppen` und bestätige mit `Stoppen`.",
          "Später hebst du das im selben Menü mit `Mails wieder senden` auf.",
        ],
      },
    ],
    notes: [
      "Anmeldecodes und Mails zum Passwort kommen auch an eine gesperrte Adresse.",
      "Abrechnungsbriefe des Trägers gehen auch an gesperrte Adressen und gestoppte Personen.",
      "Wird kein Kind einer Person mehr betreut, bekommt sie keine Elternbriefe, Nachrichten, Termine und Einladungen mehr. Im Briefstatus steht die aktuelle Sperre getrennt vom früheren Versandergebnis. Verträge, Abrechnungsbriefe und Mails zu einer neuen Anmeldung kommen weiter an.",
      "Mails an das Team hält eine Sperre nicht zurück. Die Einladung zeigt den Hinweis trotzdem.",
    ],
    troubleshootingDetails: [
      "Hat die Person eine Mail als unerwünscht gemeldet? Dann kannst du die Sperre nicht aufheben. Sprich die Person direkt an. Eine andere Adresse trägst du unter `Bearbeiten` ein.",
      "`Erneut einladen` fehlt? Dann ist die Adresse gesperrt, die letzte Mail noch unterwegs oder kein Kind mehr in Betreuung. Der Hinweis bei der Person nennt den Grund.",
      "Steht bei der Person `Gesperrt`? Die Schule kann das nicht aufheben. Wende dich an den moto-Support. Die Sperre lässt sich nicht weiter zuordnen.",
      "Hat sich die Person abgemeldet oder eine Mail als unerwünscht gemeldet? An dieselbe Adresse geht kein Elternbrief mehr. Hat sie eine andere Adresse? Trage diese unter `Bearbeiten` ein. Dann kannst du den Brief neu senden.",
      "Ist die Adresse in einem Elternbrief geändert? Die Zeile nennt die Adresse, an die die Mail ging, und darunter die aktuelle Adresse. Das Ergebnis gehört zur ersten.",
      "Kommt nach dem Aufheben wieder eine Mail zurück? Dann sperrt moto die Adresse erneut. Frage die Familie nach einer anderen Adresse.",
    ],
    related: [
      HELP_TOPICS.leadInviteGuardians,
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadManageStudent,
    ],
  };
}
