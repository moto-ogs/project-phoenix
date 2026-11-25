import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/anmeldephasen` (#4704): Anmeldephase mit Angeboten für mehrere Schulen. */
export function traegerCatalogPhasesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerCatalogPhases,
    title: "Anmeldephasen für mehrere Schulen",
    question: "Wie lege ich eine Anmeldephase für mehrere Schulen an?",
    summary:
      "Du legst eine Anmeldephase mit Betreuungsangeboten einmal an. Jede Schule bekommt davon eine eigene Kopie. Erst wenn du überträgst, ändert sich etwas in den Schulen.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "CalendarPlus",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Anmeldephase anlegen",
        steps: [
          "Wähle in der Navigation `Anmeldephasen`.",
          "Wähle `Anmeldephase anlegen`.",
          "Trage `Name`, `Art` und den `Leistungszeitraum` ein.",
          "Soll die Anmeldung nur in einer bestimmten Zeit möglich sein? Trage `Anmeldung ab` und `Anmeldung bis` ein. Sonst lass die Felder leer.",
          "Wähle `Zielgruppe`, `Betreuungsauswahl` und `Verhalten bei voller Betreuung`.",
          "Wähle bei `Schulen` `Alle Schulen (auch neue)` oder `Ausgewählte Schulen`. Bei ausgewählten Schulen setzt du bei jeder Schule einen Haken.",
          "Wähle `Anmeldephase anlegen`.",
        ],
      },
      {
        title: "Betreuungsangebote anlegen",
        steps: [
          "Öffne die Anmeldephase.",
          "Wähle bei `Betreuungsangebote` `Angebot anlegen`.",
          "Trage `Name` und die `Wochentage` ein. Zählt das Angebot als Betreuungstag, trage für jeden Tag eine Gehzeit ein.",
          "Trage die Preise ein. Wähle `Pro Wochentag` oder `Nach Tagen pro Woche`. In der Spalte `Jedes weitere Kind` steht der Preis für Geschwister. Leer heißt: derselbe Preis wie beim 1. Kind.",
          "Soll die Schule auch die Vertragsbedingungen bekommen? Schalte `Vertragsvorlage mitgeben` ein und fülle die Felder aus.",
          "Wähle `Angebot anlegen`.",
        ],
      },
      {
        title: "Liste herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Wähle in der Navigation `Anmeldephasen`.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält alle Anmeldephasen mit Leistungszeitraum, Schulen und Stand.",
        ],
      },
      {
        title: "Vorschau ansehen und übertragen",
        steps: [
          "Öffne die Anmeldephase.",
          "Wähle oben `Vorschau ansehen`.",
          "Prüfe pro Schule, was passiert: `Wird neu angelegt`, `Wird geändert`, `Wird zurückgezogen` oder `Lehnt ab` mit dem Grund.",
          "Wähle `Freigeben und übertragen`.",
          "Unter `Ergebnis` siehst du, welche Schule übernommen hat.",
        ],
      },
    ],
    result:
      "Jede Schule hat eine eigene Anmeldephase mit den Angeboten. Auf der Seite der Anmeldephase steht bei `Schulen` das letzte Ergebnis jeder Schule.",
    notes: [
      "Die Schule darf ihre Kopie ändern oder ausschalten. Diese Änderungen bleiben. In der Vorschau steht dann `Die Schule hat geändert – bleibt so`, mit dem Wert der Schule und deinem Wert.",
      "Neue Preise gelten in der Schule ab dem nächsten Monatsbeginn. Ausgestellte Verträge und Rechnungen bleiben, wie sie sind.",
      "Eine Schule darf eine Kopie nicht löschen. Entfernen geht nur hier mit `Zurückziehen`. Danach überträgst du noch einmal.",
      "Hat ein Kind ein zurückgezogenes Angebot schon gebucht, schaltet moto es in der Schule nur aus.",
      "Eine Phase dauert höchstens 2 Jahre. Ihr Ende liegt höchstens 5 Jahre in der Zukunft. Ältere Phasen außerhalb dieser Grenzen bleiben, wie sie sind, solange du Beginn und Ende nicht änderst.",
      "Du ziehst das Ende einer Anmeldephase vor? Dann nennt die Vorschau pro Schule, wie viele Kinder länger betreut werden. moto beendet keine Betreuung. Sage der Schule Bescheid.",
    ],
    differences: [
      "Du siehst in der Navigation kein `Anmeldephasen`? Deine Rolle darf keine Anmeldungen verwalten. Frage im Träger-Büro nach der Rolle Verwaltung.",
      "Eine zurückgezogene Anmeldephase lässt sich nicht mehr ändern. Das Formular fehlt dann.",
    ],
    troubleshootingDetails: [
      "Eine Schule `Lehnt ab`? Der Grund steht daneben. Passe deine Angaben an oder frag die Schule nach einer Änderung. Danach siehst du die Vorschau noch einmal an.",
      "Beim Übertragen steht, dass sich seit der Vorschau etwas geändert hat? moto lädt die Vorschau neu. Prüfe sie und wähle noch einmal `Freigeben und übertragen`.",
      "Bei einer Schule steht `Nicht übertragen`? Die Schule hat während der Vorschau etwas geändert. Übertrage noch einmal.",
    ],
    related: [
      HELP_TOPICS.traegerLogin,
      HELP_TOPICS.traegerCareContracts,
      HELP_TOPICS.traegerCareMonths,
    ],
  };
}
