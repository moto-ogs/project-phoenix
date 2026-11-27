import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function teacherParentLettersTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherParentLetters,
    title: "Einen Elternbrief schreiben",
    question: "Wie schreibe ich den Eltern meiner Klasse einen Brief?",
    summary:
      "Du schreibst den Eltern deiner Klasse. Die Eltern lesen den Brief in moto und bekommen eine E-Mail.",
    group: "nachrichten",
    audience: "teacher",
    icon: "EnvelopeOpen",
    requirements: [
      "Dir ist eine Klasse zugeordnet. Sekretariat und Schulleitung schreiben an jede Klasse.",
    ],
    steps: [
      "Öffne `Elternbriefe`.",
      "Wähle `Neuer Elternbrief`.",
      "Wähle die Klasse.",
      "Gib den `Betreff` ein.",
      "Wähle unter `Was sollen die Eltern tun?`: `Nur zur Information`, `Mit Lesebestätigung` oder `Einverständnis mit Unterschrift`.",
      "Schreibe den `Text`.",
      "Wähle `Senden`.",
    ],
    result:
      "Die Eltern der Klasse sehen den Brief sofort. Als Absender sehen sie deinen Namen, die Klasse und die Schule.",
    notes: [
      "Wähle den Brief in der Liste. Dort siehst du, wer gelesen, bestätigt oder zugestimmt hat.",
      "Bei `Mit Lesebestätigung` setzt du unter `Für jedes Kind einsetzen` Angaben wie den Vornamen in den Text. Jede Familie liest dann den Brief mit den Angaben ihres Kindes. Unter `So liest die Familie den Brief` siehst du ihn vorher.",
      "Für Familien ohne moto wählst du im gesendeten Brief `Briefe drucken`. Das PDF hat einen Brief pro Kind.",
      "Ein gesendeter Brief lässt sich nicht mehr ändern. Du kannst ihn über `Zurückziehen` zurücknehmen.",
      "Die OGS sieht deine Briefe in ihrer Übersicht. Ändern kannst nur du sie.",
      "Unter `Empfänger` steht bei jeder Mail, was aus ihr geworden ist. Steht dort `Adresse prüfen`, sage der OGS Bescheid. Sie korrigiert die Adresse.",
    ],
    differences: [
      "Du siehst nur deine eigenen Briefe. Briefe anderer Lehrkräfte stehen nicht in deiner Liste.",
      "`Neuer Elternbrief` ist grau? Warte, bis die Klassen geladen sind. Ohne zugeordnete Klasse kannst du keinen Brief schreiben.",
    ],
    troubleshootingDetails: [
      "Die Klassen laden nicht? Wähle `Wiederholen` bei der Fehlermeldung.",
      "Das Senden ist fehlgeschlagen? Wähle `Senden` oder `Wiederholen`. Dabei wird derselbe gespeicherte Brief verwendet.",
      "Der Brief geht nicht raus? Vielleicht hat die OGS Elternbriefe ausgeschaltet. Frage die OGS-Leitung.",
    ],
    related: [
      HELP_TOPICS.teacherMessages,
      HELP_TOPICS.teacherCalendar,
      HELP_TOPICS.teacherNoClasses,
    ],
  };
}
