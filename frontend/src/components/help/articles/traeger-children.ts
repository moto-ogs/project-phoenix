import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/traeger/kinder` (#8137): alle Kinder der Schulen in einer Liste, ein Reiter je Schule. */
export function traegerChildrenTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerChildren,
    title: "Kinder aller Schulen",
    question: "Wie finde ich ein Kind, ohne in jede Schule zu wechseln?",
    summary:
      "Die Liste zeigt alle Kinder deiner Schulen: mit Schule, Klasse und Gruppe. Jede Schule hat einen eigenen Reiter.",
    group: "einstieg",
    audience: "traeger",
    icon: "User",
    requirements: ["Du hast die Rolle `Verwaltung`."],
    steps: [
      "Wähle in der Navigation `Kinder`.",
      "Wähle den Reiter einer Schule. `Alle` zeigt die Kinder aller Schulen zusammen.",
      "Tippe oben in `Kind suchen` einen Teil des Namens ein.",
      "Lies in der Zeile, an welcher Schule das Kind ist, in welcher Klasse und in welcher Gruppe.",
      "Stehen unten weitere Kinder, wähle `Weitere Kinder laden`.",
      "Warte, bis die Suche fertig ist. Öffne dann oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält die Kinder des offenen Reiters und deiner Suche.",
    ],
    result:
      "Du weißt, an welcher Schule ein Kind betreut wird, ohne die Schule zu öffnen.",
    notes: [
      "Die Liste ist nach Nachnamen sortiert.",
      "Die Suche findet Vornamen und Nachnamen, auch ohne Umlaute: „Oemer“ musst du nicht tippen, „omer“ findet „Ömer“.",
      "Am Reiter jeder Schule steht die Zahl ihrer Kinder. Sie ist dieselbe Zahl wie `Kinder gesamt` in der Ansicht der Schule.",
      "moto hält fest, wer die Liste öffnet oder herunterlädt. Das steht im Zugriffsprotokoll der Schule.",
    ],
    differences: [
      "Fehlt `Kinder` in der Navigation, hast du die Rolle `Verwaltung` nicht. Die Leitung deines Träger-Büros vergibt sie unter `Mitglieder und Rollen`.",
      "Hat dein Träger nur eine Schule, gibt es keine Reiter.",
      "Steht bei Klasse oder Gruppe ein Strich, hat die Schule nichts eingetragen.",
    ],
    troubleshootingDetails: [
      "Öffnet ein gespeicherter Link eine Schule, die nicht mehr zu deinem Träger gehört? Wähle `Alle Schulen anzeigen`.",
      "Fehlt ein Kind, führt die Schule es heute nicht mit Betreuungsplatz: Es hat die Schule verlassen, wartet noch auf seinen Start oder hat keinen Platz in der Betreuung.",
      "Du siehst hier keine Eltern, keine Verträge und keine Gesundheitsangaben. Verträge findest du unter `Verträge`.",
    ],
    related: [
      HELP_TOPICS.traegerSchoolView,
      HELP_TOPICS.traegerOccupancy,
      HELP_TOPICS.traegerAccessLog,
    ],
  };
}
