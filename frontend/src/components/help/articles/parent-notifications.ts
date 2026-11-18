import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/settings`, Abschnitt `Benachrichtigungen`. Zwei Stellen
 * entscheiden: oben die Themen je Bereich, darunter der Knopf `Aktivieren`
 * unter `Benachrichtigungen auf diesem Gerät`. Die vier Schritte folgen der
 * Eltern-Anleitung `moto-eltern-push-benachrichtigungen.pdf`.
 *
 * Die `Hinweise` (#7140) stehen ohne Einstellung in moto: am Computer hinter
 * der Glocke oben rechts, auf dem Telefon unter `Mehr`. Dazu gehören die
 * Absage einer Betreuung, Raumänderungen und Schließtage des Kindes sowie ein
 * geänderter Speiseplan an einem Tag mit Essensbuchung (#7141, #7144, #7145).
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
      "Du wählst die Themen aus. Danach erlaubst du die Benachrichtigungen auf deinem Gerät.",
    group: "einstieg",
    audience: "parent",
    icon: "BellRing",
    steps: [
      "Tippe unten auf `Mehr` und dann auf `Einstellungen`.",
      "Du bist jetzt im Bereich `Benachrichtigungen`. Schalte die Themen ein. Oder wähle `Alle aktivieren`.",
      "Wähle darunter bei `Benachrichtigungen auf diesem Gerät` den Knopf `Aktivieren`. Auf breiten Bildschirmen heißt er `Benachrichtigungen einschalten`.",
      "Dein Gerät fragt einmal nach Erlaubnis. Wähle `Erlauben`.",
    ],
    result:
      "moto meldet sich ab jetzt bei den gewählten Themen. Auch wenn die App geschlossen ist.",
    notes: [
      "Jeder Hinweis steht auch in moto unter `Hinweise`, zum Beispiel wenn eine Betreuung deines Kindes ausfällt. Dafür musst du nichts einschalten.",
      "Ändert sich das Essen an einem Tag, an dem dein Kind ein Essen gebucht hat, steht das auch unter `Hinweise`. Der Hinweis öffnet den Speiseplan dieser Woche. Aufs Handy kommt er nur, wenn du `Speiseplan geändert` einschaltest.",
      "Findet ein Termin deines Kindes in einem anderen Raum statt, steht das auch unter `Hinweise`. Für heute und morgen bekommst du dazu eine Benachrichtigung, solange du `Raumänderung heute oder morgen` nicht ausschaltest.",
      "Trägt die OGS einen Schließtag ein, ändert oder löscht ihn, steht das ebenfalls unter `Hinweise`. Das Thema `Schließtage` ist von Anfang an eingeschaltet. Eine Mitteilung aufs Handy kommt nur, wenn der Tag in den nächsten 14 Tagen liegt.",
      "Für spätere Tage schalte `Raumänderung an späteren Tagen` selbst ein. Sie gilt bis 14 Tage im Voraus.",
      "Ändert sich der Unterrichtsschluss in der Klasse deines Kindes, steht in moto `Stundenplan geändert`. Eine Mitteilung aufs Handy kommt dazu, wenn du `Stundenplan der Klasse` einschaltest und die Änderung in den nächsten 14 Tagen gilt.",
      "Ein Hinweis gilt erst als gelesen, wenn du ihn wählst oder `Alle als gelesen markieren` wählst.",
      "Auf dem Sperrbildschirm steht nie der Name deines Kindes. Was genau los ist, liest du nach der Anmeldung in moto.",
      "Die Themen stehen unter `Kinder`, `Mitteilungen` und `Termine`.",
      "Du kannst Themen später jederzeit ein- oder ausschalten.",
      "Du brauchst beide Stellen: die Themen und den Knopf `Aktivieren`.",
      "Mit `Testbenachrichtigung senden` prüfst du danach, ob etwas ankommt.",
    ],
    differences: [
      "Am Computer steht `Einstellungen` in der Navigation statt hinter `Mehr`.",
      "Die `Hinweise` findest du am Computer hinter der Glocke oben rechts. Auf dem Telefon tippst du unten auf `Mehr` und dann auf `Hinweise`. Die Zahl daran zählt neue Hinweise.",
      "Du siehst nur Hinweise zu Kindern, für die du moto nutzen darfst. Nimmt die Schule dir dieses Recht, verschwinden auch ältere Hinweise zu diesem Kind.",
      "Ein Thema trägt `Von deiner Schule derzeit deaktiviert`? Dann nutzt deine OGS es nicht.",
      "Hat deine Schule alle Benachrichtigungen abgeschaltet, bleibt deine Auswahl gespeichert und gilt später wieder.",
      "Auf Android sind die Schritte gleich. Die Frage deines Geräts kann anders aussehen.",
    ],
    troubleshootingDetails: [
      "Es kommt nichts an? Öffne moto über das Symbol auf deinem Startbildschirm. Nur so kommen die Hinweise an.",
      "Du findest `Benachrichtigungen auf diesem Gerät` nicht? Dann liegt moto noch nicht auf deinem Startbildschirm.",
      "Du hast die Frage deines Geräts abgelehnt? Erlaube moto die Hinweise in den Einstellungen deines Geräts.",
    ],
    related: [
      HELP_TOPICS.parentInstallApp,
      HELP_TOPICS.parentMessages,
      HELP_TOPICS.parentNews,
    ],
  };
}
