import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Abwesenheit melden (i18n `parentChildCare.sick`). Krank geht meist sofort
 * durch, andere Gruende sind eine Anfrage -- je nach Einstellung der OGS.
 */
export function parentReportAbsenceTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentReportAbsence,
    title: "Eine Abwesenheit melden",
    question: "Wie melde ich mein Kind krank oder ab?",
    summary: "Du meldest der OGS, an welchen Tagen dein Kind nicht kommt.",
    group: "mein-kind",
    audience: "parent",
    icon: "BellRing",
    steps: [
      "Tippe unten auf `Mein Kind`.",
      "Tippe unter `Heute` auf den Knopf mit dem Namen deines Kindes und `abmelden`.",
      "Wähle im Fenster `Abwesenheit melden` bei `Grund der Abwesenheit` `Krank melden` oder `Entschuldigen`.",
      "Wähle bei `Tage der Abwesenheit` den `Erster Tag` und den `Letzter Tag`.",
      "Trage bei `Grund / Hinweis an die OGS` kurz ein, worum es geht. Das ist ein Pflichtfeld.",
      "Tippe auf `Krankmeldung an die OGS senden` oder `Entschuldigung an die OGS senden`.",
    ],
    result:
      "Die Abmeldung steht am Kind. Die Anmeldung bei der OGS bleibt unverändert.",
    notes: [
      "`Krank melden` ist für Krankheitstage. Die OGS sieht die Meldung sofort.",
      "`Entschuldigen` ist für Termine und geplante Abwesenheiten.",
      "Für einen einzelnen Tag wählst du denselben Tag zweimal.",
    ],
    differences: [
      "Manche OGS bestätigen jede Meldung erst. Dann steht `Freigabe ausstehend`, und dein Kind gilt bis dahin als erwartet.",
      "Am Kind steht danach `Krank` oder `Entschuldigt` mit den Tagen.",
      "Wurde eine Anfrage abgelehnt, steht dort `Abgelehnt`.",
      // #4803: die Meldung für ein Kind ohne OGS-Platz geht an die Schule.
      "Dein Kind hat keinen Platz in der OGS? Dann heißen das Feld `Grund / Hinweis` und der Knopf `Krankmeldung senden` oder `Entschuldigung senden`. Die Schule sieht die Meldung.",
      // #5698: Schuleinträge überschreibt keine Elternmeldung.
      "Hat die OGS einen Tag schon eingetragen, etwa ab einer Uhrzeit entschuldigt? Dann geht für diesen Tag eine Anfrage an die OGS. Sie entscheidet. Bis dahin gilt ihr Eintrag. Die anderen Tage meldet moto direkt.",
    ],
    troubleshootingDetails: [
      "moto meldet, für einen Tag liege schon eine Abmeldung vor? Prüfe die bestehende Meldung mit `Anfrage bearbeiten`.",
      "Bei deiner offenen Anfrage fehlt `Anfrage bearbeiten`? Dann darfst du für dieses Kind keine Abwesenheit melden. Frage die OGS.",
      "Dein Kind kommt nur später? Ändere stattdessen die Abholzeit oder schreibe der OGS.",
    ],
    related: [
      HELP_TOPICS.parentPickupChange,
      HELP_TOPICS.parentChildOverview,
      HELP_TOPICS.parentMessages,
    ],
  };
}
