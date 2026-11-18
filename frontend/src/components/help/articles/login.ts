import type { HelpTopic, HelpPresenceMode, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { loginResult } from "../help-article-shared";

export function loginTopic(
  presenceMode: HelpPresenceMode,
  groupMode: HelpGroupMode,
): HelpTopic {
  return {
    id: HELP_TOPICS.login,
    title: "Bei moto anmelden",
    question: "Wie melde ich mich bei moto an?",
    summary:
      "Melde dich über die moto-Seite deiner OGS mit deinem persönlichen Konto an.",
    group: "einstieg",
    audience: ["caregiver", "lead"],
    icon: "UserCircle",
    requirements: [
      "Den Link zur moto-Seite deiner OGS",
      "Ein moto-Konto. Nimm vorher deine Einladung an.",
      "Deine E-Mail-Adresse und dein Passwort für moto",
      "Zugriff auf dein E-Mail-Postfach, falls moto einen Sicherheitscode abfragt",
    ],
    steps: [
      "Öffne die moto-Seite deiner OGS.",
      "Gib unter `E-Mail-Adresse` deine persönliche E-Mail-Adresse ein.",
      "Gib unter `Passwort` dein Passwort ein.",
      "Wähle `Anmelden`.",
      "Zeigt moto die `Code-Eingabe`? Öffne die E-Mail von moto.",
      "Gib den sechsstelligen Code ein.",
      "Ist es dein eigenes Gerät? Wähle `Ja, merken und anmelden`. Dort fragt moto dann vorerst keinen Code mehr ab.",
      "Nutzen mehrere Personen das Gerät, zum Beispiel ein Tablet im Gruppenraum? Wähle `Nein, nur anmelden`.",
    ],
    result: loginResult(presenceMode, groupMode),
    differences: [
      "Für Verwaltung ist ein zweiter Nachweis immer Pflicht. Ebenso für Personalstammdaten, Personaldokumente und Personalfinanzen. Das gilt auch für Einkommensnachweise der Eltern. Ebenso für Gesundheitsdokumente und das Verwalten fremder Arbeitszeiten. Ebenso, wenn du Urlaub genehmigen darfst. Diese Pflicht gilt auch bei ausgeschalteter Sicherheitsabfrage der Schule. Gesundheitshinweise der Kinder allein lösen diese Pflicht nicht aus.",
      "Richtest du die Sicherheitsabfrage erstmals ein? Wähle `Code an meine E-Mail senden`.",
      "Gib danach den sechsstelligen Code ein.",
      "Wenn du bereits einen Passkey eingerichtet hast, kannst du `Mit Passkey anmelden` wählen.",
      "Auf dem Knopf steht eine andere Zahl als 90? Deine OGS legt fest, wie viele Tage moto ein Gerät merkt.",
      "Du siehst keine zwei Knöpfe? Dann merkt deine OGS keine Geräte. moto prüft den Code, sobald er vollständig ist.",
    ],
    notes: [
      "Nutzen mehrere Personen das Gerät? Melde dich bei moto ab, wenn du fertig bist.",
      "Gemerkte Geräte stehen in deinem `Profil` unter `Meine vertrauten Geräte`. Dort entfernst du ein Gerät wieder.",
      "Ein gemerktes Gerät gilt nur für diese OGS. Arbeitest du an mehreren Schulen? Dann merkst du das Gerät an jeder Schule einmal.",
    ],
    troubleshootingDetails: [
      "Kein Zugriff auf deine E-Mails? Wende dich an deine Schulverwaltung. Der zusätzliche Nachweis bleibt bei besonderen Zugriffsrechten Pflicht.",
      "Beim Schulwechsel fehlt ein zweiter Anmeldenachweis? Wähle `Zur Schulanmeldung`. Du wirst zuerst abgemeldet. Melde dich danach direkt bei der Zielschule neu an. Bestätige dort die Anmeldung.",
    ],
    troubleshooting: HELP_TOPICS.loginProblem,
    related: [
      HELP_TOPICS.acceptInvitation,
      HELP_TOPICS.installApp,
      HELP_TOPICS.loginProblem,
    ],
  };
}
