import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/messages/groups`: Gruppennachrichten (#4784). Die OGS schreibt an eine
 * Gruppe, Klasse oder AG; Eltern antworten nur der OGS.
 */
export function parentGroupMessageTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentGroupMessage,
    title: "Einer Gruppe eine Nachricht schreiben",
    question: "Wie schreibe ich allen Eltern einer Gruppe?",
    summary:
      "Schreibe allen Eltern einer Gruppe, Klasse oder AG. Jede Familie antwortet nur der OGS.",
    group: "team",
    audience: ["caregiver", "lead"],
    icon: "UsersThree",
    steps: [],
    instructionGroups: [
      {
        title: "Eine Gruppennachricht beginnen",
        steps: [
          "Öffne unter `Eltern` den Bereich `Nachrichten`.",
          "Wähle den Reiter `Gruppennachrichten`.",
          "Wähle `Neue Gruppennachricht`.",
          "Wähle `Gruppe`, `Klasse` oder `AG` und dann den Namen.",
          "Prüfe, wie viele Familien die Nachricht bekommen.",
          "Gib einen Titel und deine Nachricht ein.",
          "Wähle `Senden`.",
        ],
      },
      {
        title: "Eine weitere Nachricht schreiben",
        steps: [
          "Öffne die Gruppennachricht in der Liste.",
          "Schreibe unten deine Nachricht.",
          "Wähle `Senden`.",
        ],
      },
      {
        title: "Eine Gruppennachricht schließen",
        description: "Danach können die Eltern nicht mehr antworten.",
        steps: [
          "Öffne die Gruppennachricht.",
          "Öffne oben das Menü mit den drei Punkten.",
          "Wähle `Schließen` und bestätige.",
        ],
      },
    ],
    result:
      "Jede Familie liest die Nachricht in der Eltern-App unter `Nachrichten`. Antworten erscheinen in der Unterhaltung mit der Familie, mit dem Hinweis `Antwort auf Gruppennachricht`.",
    differences: [
      "Siehst du den Reiter `Gruppennachrichten` nicht? Dann ist der Nachrichtenaustausch mit den Eltern ausgeschaltet, oder dir fehlt der Zugriff auf alle Kinder.",
      "Steht bei einem Kind `Kein Eltern-Zugang`? Dann bekommt diese Familie die Nachricht nicht.",
    ],
    notes: [
      "Mit `Foto oder Datei anhängen` (Büroklammer neben dem Textfeld) hängst du an eine weitere Nachricht bis zu 5 Dateien an. Pro Datei sind höchstens 10 MB erlaubt. Alle Eltern der Gruppennachricht sehen die Datei.",
      "Keine Familie sieht, wer die Nachricht noch bekommt oder wer geantwortet hat.",
      "moto ermittelt die Empfänger bei jeder Nachricht neu. Wer später in die Gruppe kommt, liest nur die neuen Nachrichten.",
      "Benennst du eine Gruppe oder AG um, trägt ihre Gruppennachricht sofort den neuen Namen. Das sehen das Team und die Eltern.",
      "Beim Schuljahreswechsel geht eine Klassen-Nachricht mit den Kindern in die neue Klasse. Dann steht dort zum Beispiel `Klasse wurde versetzt: jetzt 4a`. Geht eine Klasse ab, wird ihre Nachricht geschlossen.",
      "Unter `Gelesen` siehst du für jedes Kind, ob die Eltern die neueste Nachricht gelesen haben.",
      "Unter jeder Nachricht steht hinter `E-Mails`, was aus den Mails an die Familien wurde, zum Beispiel `10 zugestellt` und `1 nicht zustellbar`. Welche Adresse betroffen ist, siehst du beim Kind unter `Erziehungsberechtigte`.",
      "Über dem Schreibfeld steht bei `Ging an:`, an wen die Nachricht ging und wie viele Familien sie bekommen haben.",
    ],
    related: [
      HELP_TOPICS.parentMessage,
      HELP_TOPICS.leadParentAnnouncement,
      HELP_TOPICS.leadEmailDelivery,
    ],
  };
}
