import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/einstellungen/schulrollen` (#4810, ADR 0317): Rollen des Trägers
 * für das Personal aller seiner Schulen anlegen, ändern und entfernen.
 */
export function traegerSchoolRolesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerSchoolRoles,
    title: "Rollen für alle Schulen",
    question: "Wie lege ich eine Rolle für das Personal aller Schulen an?",
    summary:
      "Du legst eine Rolle einmal an. Jede deiner Schulen bekommt sie und gibt sie ihren Personen.",
    group: "einstieg",
    audience: "traeger",
    icon: "KeyRound",
    requirements: ["Du hast die Rolle `Verwaltung`."],
    instructionGroups: [
      {
        title: "Eine Rolle anlegen",
        steps: [
          "Wähle in der Navigation `Einstellungen`, dann `Rollen für Schulen`.",
          "Wähle oben `Rolle anlegen`.",
          "Gib einen Namen ein, zum Beispiel Springerkraft.",
          "Wähle bei `Gilt als`, ob die Rolle zur Betreuung oder zur Verwaltung zählt. Damit startet sie mit den passenden Rechten.",
          "Wähle `Anlegen`.",
        ],
      },
      {
        title: "Die Rechte einer Rolle ändern",
        steps: [
          "Wähle in der Karte der Rolle `Bearbeiten`.",
          "Kreuze unter `Rechte` an, was die Rolle darf. Mit der Suche findest du ein Recht schneller.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Eine Rolle entfernen",
        steps: [
          "Wähle in der Karte der Rolle das Menü mit den drei Punkten.",
          "Wähle `Entfernen`.",
          "Lies, wer die Rolle an welcher Schule hat.",
          "Wähle `Rolle entfernen`, dann `Endgültig entfernen`.",
        ],
      },
    ],
    steps: [],
    result:
      "moto trägt die Rolle sofort in alle deine Schulen. Dort steht sie unter `Rollen` mit dem Vermerk `Vom Träger`. Die Schule gibt sie ihren Personen wie jede andere Rolle.",
    notes: [
      "Kommt später eine Schule zu deinem Träger, bekommt sie die Rollen von selbst.",
      "Ändern und entfernen kannst nur du. Jede Schule legt weiter eigene Rollen an.",
      "Ein neues Recht haben die Personen kurz nach dem Speichern. Nimmst du ein Recht weg, meldet moto sie ab. Sie melden sich danach wieder an.",
      "Wer im Träger-Büro was darf, stellst du unter `Mitglieder und Rollen` ein. Das sind andere Rollen.",
      "Jede Änderung steht im Protokoll der Schule, mit dem Hinweis, dass sie vom Träger kommt.",
    ],
    differences: [
      "Bei einer Schule steht `Name vergeben`: Die Schule hat schon eine eigene Rolle mit diesem Namen. Gib deiner Rolle einen anderen Namen, oder die Schule benennt ihre um.",
      "Bei einer Schule steht `Nicht übertragen`: Wähle `Bearbeiten` und `Speichern`. Dann trägt moto die Rolle auch dorthin.",
      "Beim Entfernen steht bei einer Schule, dass die Rolle bleibt: Eine Einladung dieser Schule nennt die Rolle. Sie gehört danach der Schule.",
    ],
    troubleshootingDetails: [
      "Du siehst `Rollen für Schulen` nicht: Dir fehlt die Rolle `Verwaltung`. Bitte die Leitung deines Trägers darum.",
      "Nach dem Entfernen darf eine Person nichts mehr: Die Schule gibt ihr unter `Personal` eine andere Rolle.",
    ],
    related: [HELP_TOPICS.traegerAccounts, HELP_TOPICS.traegerSchoolSwitch],
  };
}
