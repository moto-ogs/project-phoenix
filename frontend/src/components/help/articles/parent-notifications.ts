import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/settings`, Abschnitt `Benachrichtigungen`. Zwei Stellen
 * entscheiden: oben die Themen je Bereich, darunter der Knopf `Aktivieren`
 * unter `Benachrichtigungen auf diesem Gerät`. Die vier Schritte folgen der
 * Eltern-Anleitung `moto-eltern-push-benachrichtigungen.pdf`.
 *
 * Die `Hinweise` (#7140) stehen ohne Einstellung in moto: am Computer hinter
 * der Glocke oben rechts, auf dem Telefon unter `Mehr`. Erster Hinweis ist
 * die Absage einer Betreuung des Kindes, dazu kommt der geänderte Speiseplan
 * an einem Tag mit Essensbuchung (#7145).
 */
export function parentNotificationsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentNotifications,
    title: "Benachrichtigungen einstellen",
    question: "Wie erfahre ich, wenn es Neues zu meinem Kind gibt?",
    // „erlauben moto Ihr Gerät" war kein Deutsch: man erlaubt jemandem etwas,
    // und ein Gerät erlaubt man ohnehin nicht. Erlaubt werden die
    // Benachrichtigungen darauf. Zwei Sätze, weil es zwei Stellen sind --
    // genau darauf weist der Artikel weiter unten noch einmal hin.
    summary:
      "Sie wählen die Themen aus. Danach erlauben Sie die Benachrichtigungen auf Ihrem Gerät.",
    group: "einstieg",
    audience: "parent",
    icon: "BellRing",
    steps: [
      "Tippen Sie unten auf `Mehr` und dann auf `Einstellungen`.",
      "Sie sind jetzt im Bereich `Benachrichtigungen`. Schalten Sie die Themen ein. Oder wählen Sie `Alle aktivieren`.",
      "Wählen Sie darunter bei `Benachrichtigungen auf diesem Gerät` den Knopf `Aktivieren`. Auf breiten Bildschirmen heißt er `Benachrichtigungen einschalten`.",
      "Ihr Gerät fragt einmal nach Erlaubnis. Wählen Sie `Erlauben`.",
    ],
    result:
      "moto meldet sich ab jetzt bei den gewählten Themen. Auch wenn die App geschlossen ist.",
    notes: [
      "Jeder Hinweis steht auch in moto unter `Hinweise`, zum Beispiel wenn eine Betreuung Ihres Kindes ausfällt. Dafür müssen Sie nichts einschalten.",
      "Ändert sich das Essen an einem Tag, an dem Ihr Kind ein Essen gebucht hat, steht das auch unter `Hinweise`. Der Hinweis öffnet den Speiseplan dieser Woche. Aufs Handy kommt er nur, wenn Sie `Speiseplan geändert` einschalten.",
      "Ein Hinweis gilt erst als gelesen, wenn Sie ihn wählen oder `Alle als gelesen markieren` wählen.",
      "Auf dem Sperrbildschirm steht nie der Name Ihres Kindes. Was genau los ist, lesen Sie nach der Anmeldung in moto.",
      "Die Themen stehen unter `Kinder`, `Mitteilungen` und `Termine`.",
      "Sie können Themen später jederzeit ein- oder ausschalten.",
      "Sie brauchen beide Stellen: die Themen und den Knopf `Aktivieren`.",
      "Mit `Testbenachrichtigung senden` prüfen Sie danach, ob etwas ankommt.",
    ],
    differences: [
      "Am Computer steht `Einstellungen` in der Navigation statt hinter `Mehr`.",
      "Die `Hinweise` finden Sie am Computer hinter der Glocke oben rechts. Auf dem Telefon tippen Sie unten auf `Mehr` und dann auf `Hinweise`. Die Zahl daran zählt neue Hinweise.",
      "Sie sehen nur Hinweise zu Kindern, für die Sie moto nutzen dürfen. Nimmt die Schule Ihnen dieses Recht, verschwinden auch ältere Hinweise zu diesem Kind.",
      "Ein Thema trägt `Von Ihrer Schule derzeit deaktiviert`? Dann nutzt Ihre OGS es nicht.",
      "Hat Ihre Schule alle Benachrichtigungen abgeschaltet, bleibt Ihre Auswahl gespeichert und gilt später wieder.",
      "Auf Android sind die Schritte gleich. Die Frage Ihres Geräts kann anders aussehen.",
    ],
    troubleshootingDetails: [
      "Es kommt nichts an? Öffnen Sie moto über das Symbol auf Ihrem Startbildschirm. Nur so kommen die Hinweise an.",
      "Sie finden `Benachrichtigungen auf diesem Gerät` nicht? Dann liegt moto noch nicht auf Ihrem Startbildschirm.",
      "Sie haben die Frage Ihres Geräts abgelehnt? Erlauben Sie moto die Hinweise in den Einstellungen Ihres Geräts.",
    ],
    related: [
      HELP_TOPICS.parentInstallApp,
      HELP_TOPICS.parentMessages,
      HELP_TOPICS.parentNews,
    ],
  };
}
