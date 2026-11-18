import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/school/einstellungen`: Auswahl der Arten, danach das Geraet einrichten. */
export function teacherSettingsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherSettings,
    title: "Benachrichtigungen einstellen",
    question: "Wie werde ich über Neues informiert?",
    summary:
      "Erst wählen, worüber du informiert wirst, dann das Gerät einrichten.",
    group: "einstieg",
    audience: "teacher",
    icon: "Settings",
    steps: [
      "Öffne `Einstellungen`.",
      "Bleibe im Bereich `Benachrichtigungen`. Wähle die Arten aus.",
      "Erlaube danach die Benachrichtigungen auf deinem Gerät.",
    ],
    result: "moto meldet sich, sobald etwas Neues für dich ansteht.",
    notes: [
      "`Krankmeldungen meiner Klassen`: moto meldet sich, wenn ein Kind aus deinen Klassen für heute krank oder entschuldigt ist. Name und Grund stehen nicht im Hinweis.",
      "Tippe auf den Hinweis. Dann öffnet sich die Liste der Klasse.",
      "Die Schulverwaltung bekommt diesen Hinweis für alle Klassen der Schule.",
      "`Fehlt ohne Meldung`: nur für die Schulverwaltung. moto meldet sich, wenn eine Lehrkraft ein Kind als fehlend einträgt und keine Meldung da ist. Im Hinweis steht nur die Zahl der Kinder. Diese Benachrichtigung ist von Anfang an eingeschaltet.",
      "`Nachrichten von Kolleginnen und Kollegen`: neue Nachrichten im Team-Chat der OGS.",
      "`Absage eines Termins`: moto meldet sich, wenn ein Termin ausfällt, bei dem du eingeplant bist. Das gilt für Absagen von heute bis in 14 Tagen. Diese Benachrichtigung ist von Anfang an eingeschaltet. Den Hinweis in der Glocke bekommst du auch, wenn du sie ausschaltest.",
      "Benachrichtigungen kommen erst an, wenn moto schule auf dem Startbildschirm liegt.",
      "Im Bereich `Vertraute Geräte` stehen die Geräte, die du dir beim Anmelden gemerkt hast. Öffne das Menü am Gerät und wähle `Entfernen`. Dort fragt moto beim nächsten Anmelden wieder nach dem Code.",
    ],
    differences: [
      "Nutzt du Samsung Internet? Öffne moto schule stattdessen in Chrome.",
    ],
    troubleshootingDetails: [
      "Es kommt nichts an? Prüfe, ob du moto auf dem Gerät erlaubt hast, Benachrichtigungen zu senden.",
    ],
    related: [
      HELP_TOPICS.teacherNotificationFeed,
      HELP_TOPICS.teacherMessages,
      HELP_TOPICS.teacherNotices,
      HELP_TOPICS.teacherLogin,
    ],
  };
}
