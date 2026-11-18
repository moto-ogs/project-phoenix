import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/school/login`. Eigenes Portal; ein Konto ohne Rolle wird abgewiesen. */
export function teacherLoginTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherLogin,
    title: "Bei moto schule anmelden",
    question: "Wie melde ich mich bei moto schule an?",
    summary: "moto schule hat eine eigene Adresse und eine eigene Anmeldung.",
    group: "einstieg",
    audience: "teacher",
    icon: "LogIn",
    steps: [
      "Öffne die Adresse von moto schule.",
      "Trage deine `E-Mail-Adresse` ein.",
      "Trage dein `Passwort` ein.",
      "Wähle `Anmelden`.",
      "Fragt moto nach einem Code? Öffne die E-Mail von moto.",
      "Gib den sechsstelligen Code ein.",
      "Ist es dein eigenes Gerät? Wähle `Ja, merken und anmelden`. Dort fragt moto dann vorerst keinen Code mehr ab.",
      "Nutzen mehrere Personen das Gerät, zum Beispiel ein Rechner im Lehrerzimmer? Wähle `Nein, nur anmelden`.",
    ],
    result: "moto öffnet die `Klassenansicht` mit dem heutigen Tag.",
    notes: [
      "Lege dir die Adresse als Lesezeichen an.",
      "Passwort vergessen? Wähle `Passwort vergessen?` auf der Anmeldeseite.",
      "Gemerkte Geräte stehen unter `Einstellungen` im Bereich `Vertraute Geräte`. Dort entfernst du ein Gerät wieder.",
    ],
    differences: [
      "Oben steht `Willkommen im Schulportal`. So erkennst du, dass du richtig bist.",
      "Auf dem Knopf steht eine andere Zahl als 90? Deine Schule legt fest, wie viele Tage moto ein Gerät merkt.",
      "Du siehst keine zwei Knöpfe? Dann merkt deine Schule keine Geräte. moto prüft den Code, sobald er vollständig ist.",
      "Für Verwaltung ist ein zweiter Nachweis immer Pflicht. Ebenso für Personalstammdaten, Personaldokumente und Personalfinanzen. Das gilt auch für Einkommensnachweise der Eltern. Ebenso für Gesundheitsdokumente und das Verwalten fremder Arbeitszeiten. Ebenso, wenn du Urlaub genehmigen darfst. Gesundheitshinweise der Kinder allein lösen diese Pflicht nicht aus.",
    ],
    troubleshootingDetails: [
      "moto sagt, das Konto habe keinen Zugang zum Schul-Portal? Dann fehlt dir die Rolle. Wende dich an die OGS-Verwaltung.",
      "moto sagt, deine Schule nutze moto schule zurzeit nicht? Dann bietet deine Schule moto schule nicht an. Wende dich an die OGS-Verwaltung.",
      "moto sagt `Die E-Mail-Adresse oder das Passwort stimmt nicht.`? Prüfe beides und versuche es erneut.",
    ],
    related: [
      HELP_TOPICS.teacherAccess,
      HELP_TOPICS.teacherClassDay,
      HELP_TOPICS.teacherLoginProblem,
    ],
  };
}
