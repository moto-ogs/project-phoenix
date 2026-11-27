import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/uebersicht` (#4674), in der Navigation „Dashboard": die Zahlen von jetzt für alle Schulen, „Heute anders“ (#7672, #8146, Vorschau auf morgen #8236) und ihre Auffälligkeiten (#4675). */
export function traegerDashboardTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerDashboard,
    title: "Alle Schulen auf einen Blick",
    question: "Wie steht es gerade an allen Schulen meines Trägers?",
    summary:
      "Das Dashboard zeigt die Zahlen von jetzt für alle Schulen deines Trägers auf einer Seite.",
    group: "einstieg",
    audience: "traeger",
    icon: "BarChart3",
    steps: [
      "Nach der Anmeldung öffnet moto das Dashboard. Sonst wähle in der Navigation `Dashboard`.",
      "Lies oben die Summe für alle Schulen.",
      "Prüfe unter `Heute anders`, an welcher Schule heute etwas anders läuft.",
      "Prüfe unter `Auffälligkeiten`, an welcher Schule etwas deine Grenzen erreicht.",
      "Wähle dort `Zur Schule`, um die Schule anzusehen.",
      "Lies unter `Zahlen pro Schule` die Zahlen jeder Schule.",
      "Wähle eine Schule, um ihre Zahlen und Stammdaten zu sehen.",
      "Öffne das Drei-Punkte-Menü rechts neben der Suche, bei nur einer Schule rechts neben dem Titel. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Hast du bei `Auffälligkeiten` eine Schule gewählt, enthält die Datei nur diese Schule.",
    ],
    result:
      "Du siehst für jede Schule, wie viele Kinder gerade da sind, wie viele heute krank sind, wie viele Betreuungskräfte angemeldet sind und wie viele Anmeldungen offen sind.",
    notes: [
      "Ohne die Pflichtangaben erstellt moto nicht alle Verträge, Rechnungen und Bescheide. Der Hinweis verschwindet, sobald alles eingetragen ist.",
      "Die Zahlen aktualisieren sich jede Minute von selbst.",
      "`Heute anders` zeigt pro Schule die Schließtage von heute, von der Schule oder von dir.",
      "Dazu kommen eine geänderte Öffnungszeit, ein ausfallendes Mittagessen, die Zahl der abgesagten Termine und die Zahl der gesperrten Räume.",
      "Unter `Heute anders` steht kein Name und kein Grund. Nur ein Schließtag zeigt seinen Namen.",
      "Fehlt Personal, steht das unter `Auffälligkeiten` bei `Zu wenig Personal`, nicht unter `Heute anders`.",
      // Vorschau auf morgen (#8236).
      "Oben in `Heute anders` wählst du `Heute` oder `Morgen`. Mit `Morgen` siehst du schon heute, an welcher Schule morgen etwas anders läuft. Du siehst dort dasselbe wie für heute, nur für morgen.",
      "Ist morgen Wochenende oder ein Schließtag, zeigt `Morgen` trotzdem diesen Tag.",
      "Du siehst nur Zahlen, keine Namen.",
      "Ein Kind, das da ist, zählt nicht als krank. Das gilt auch mit Krankmeldung.",
      "Mit einem Klick auf eine Spaltenüberschrift sortierst du die Schulen, zum Beispiel nach `Heute krank`.",
      "Bei vielen Schulen findest du eine Schule schneller über das Suchfeld. Du kannst nach dem Namen oder dem Ort suchen.",
      "`Betreuungsschlüssel` heißt: Eine anwesende Betreuungskraft kommt auf so viele anwesende Kinder. Oben gilt das für alle Schulen zusammen.",
      "`Auffälligkeiten` kennt drei Hinweise: `Zu wenig Personal`, `Viele Krankmeldungen` und `Offene Anmeldungen`. In der Tabelle sind die Zahlen dazu gelb mit einem Warnzeichen.",
      "Mit dem Feld `Alle Schulen` zeigst du nur die Hinweise einer Schule.",
      "Ab wann eine Schule auffällt, legst du selbst fest. Wähle dazu `Grenzen bearbeiten`. Mehr dazu steht im Artikel `Einstellungen für alle Schulen festlegen`.",
      "`Offene Anmeldungen` zählt die Kinder aus der Online-Anmeldung, über die die Schule noch nicht entschieden hat.",
    ],
    differences: [
      "Steht oben `Es fehlen noch Pflichtangaben`? Trage die genannten Angaben nach. Die Knöpfe im Hinweis führen zur passenden Seite.",
      "Eine Angabe darfst du nicht eintragen? Dann nennt der Hinweis die Rolle, die das tut.",
      "`Betreuungskräfte` zählt nur, wer sich in der Zeiterfassung angemeldet hat. Homeoffice zählt nicht. Nutzt eine Schule die Zeiterfassung nicht, steht dort 0 und beim Schlüssel `–`.",
      "Ohne das Recht `In OGS wechseln` fehlt die Aktion `Schul-App öffnen`. Die Zahlen siehst du trotzdem.",
      "Ohne das Recht, Einstellungen zu ändern, steht dort `Grenzen ansehen` statt `Grenzen bearbeiten`.",
      "Steht unter `Auffälligkeiten` „Gerade ist an keiner Schule etwas auffällig.“? Dann erreicht keine Schule deine Grenzen.",
      "Steht unter `Heute anders` „Heute läuft an allen Schulen alles wie geplant.“? Dann läuft heute an keiner Schule etwas anders als geplant. Für morgen steht dort „Morgen läuft an allen Schulen alles wie geplant.“",
    ],
    related: [
      HELP_TOPICS.traegerSchoolView,
      HELP_TOPICS.traegerSchoolSwitch,
      HELP_TOPICS.traegerSettings,
    ],
  };
}
