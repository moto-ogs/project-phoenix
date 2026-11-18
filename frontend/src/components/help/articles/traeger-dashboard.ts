import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/uebersicht` (#4674), in der Navigation „Dashboard": die Zahlen von jetzt für alle Schulen und ihre Auffälligkeiten (#4675). */
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
      "Wähle in der Navigation `Dashboard`.",
      "Lies oben die Summe für alle Schulen.",
      "Prüfe unter `Auffälligkeiten`, an welcher Schule etwas deine Grenzen erreicht.",
      "Wähle dort `Zur Schule`, um die Schule anzusehen.",
      "Lies unter `Zahlen je Schule` die Zahlen jeder Schule.",
      "Wähle eine Schule, um ihre Zahlen und Stammdaten zu sehen.",
      "Wähle `Herunterladen` und dann `PDF`, `Excel` oder `CSV`. Hast du bei `Auffälligkeiten` eine Schule gewählt, enthält die Datei nur diese Schule.",
    ],
    result:
      "Du siehst für jede Schule, wie viele Kinder gerade da sind, wie viele heute krank sind, wie viele Betreuungskräfte angemeldet sind und wie viele Anmeldungen offen sind.",
    notes: [
      "Die Zahlen aktualisieren sich jede Minute von selbst.",
      "Du siehst nur Zahlen, keine Namen.",
      "Ein Kind, das da ist, zählt nicht als krank. Das gilt auch mit Krankmeldung.",
      "Mit einem Klick auf eine Spaltenüberschrift sortierst du die Schulen, zum Beispiel nach `Heute krank`.",
      "Bei vielen Schulen findest du eine Schule schneller über das Suchfeld. Du kannst nach dem Namen oder dem Ort suchen.",
      "`Betreuungsschlüssel` heißt: Eine anwesende Betreuungskraft kommt auf so viele anwesende Kinder. Oben gilt das für alle Schulen zusammen.",
      "`Auffälligkeiten` kennt drei Hinweise: `Zu wenig Personal`, `Viele Krankmeldungen` und `Offene Anmeldungen`. In der Tabelle sind die Zahlen dazu gelb mit einem Warnzeichen.",
      "Mit dem Feld `Alle Schulen` zeigst du nur die Hinweise einer Schule.",
      "Ab wann eine Schule auffällt, legst du selbst fest. Wähle dazu `Grenzen ändern`. Mehr dazu steht im Artikel `Einstellungen für alle Schulen festlegen`.",
      "`Offene Anmeldungen` zählt die Kinder aus der Online-Anmeldung, über die die Schule noch nicht entschieden hat.",
    ],
    differences: [
      "`Betreuungskräfte` zählt nur, wer sich in der Zeiterfassung angemeldet hat. Homeoffice zählt nicht. Nutzt eine Schule die Zeiterfassung nicht, steht dort 0 und beim Schlüssel `–`.",
      "Ohne das Recht `In OGS wechseln` fehlt die Aktion `Schul-App öffnen`. Die Zahlen siehst du trotzdem.",
      "Ohne das Recht, Einstellungen zu ändern, steht dort `Grenzen ansehen` statt `Grenzen ändern`.",
      "Steht unter `Auffälligkeiten` „Gerade ist an keiner Schule etwas auffällig.“? Dann erreicht keine Schule deine Grenzen.",
    ],
    related: [
      HELP_TOPICS.traegerSchoolView,
      HELP_TOPICS.traegerSchoolSwitch,
      HELP_TOPICS.traegerSettings,
    ],
  };
}
