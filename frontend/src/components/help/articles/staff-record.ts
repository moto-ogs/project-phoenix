import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/staff/[id]`, die sieben Reiter der Personalakte. Live geprueft an einer
 * Person mit Daten. Schwerpunkt ist das `Arbeitszeitmodell`: daran rechnet
 * jedes Stundenkonto, und es war in der Hilfe bisher nur eine Fehlerzeile.
 */
export function staffRecordTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadStaffRecord,
    title: "Die Personalakte einer Person führen",
    question: "Wo pflege ich die Angaben zu einer Person?",
    summary:
      "Die Personalakte bündelt Arbeitszeit, Abwesenheiten und Unterlagen.",
    group: "personal",
    audience: "lead",
    icon: "FolderOpen",
    steps: [],
    instructionGroups: [
      {
        title: "Die Akte öffnen",
        steps: [
          "Klappe in der Seitenleiste `Team` auf.",
          "Öffne `Mitarbeitende`.",
          "Gib den Namen in das Feld `Name suchen` ein.",
          "Wähle die Karte der Person.",
        ],
      },
      {
        title: "Das Arbeitszeitmodell eintragen",
        description:
          "Ohne Modell und ohne Sonderarbeitszeit hat die Person kein Soll. Dann zählen Krankheit, Urlaub und Fortbildung 0 Stunden. Gearbeitete Zeit zählt ganz als Plus.",
        steps: [
          "Wähle oben `Arbeitszeitmodell`.",
          "Wähle rechts `Bearbeiten`.",
          "Wähle `Vorlage zuweisen` für ein Modell, das mehrere Personen teilen. Vorlagen legst du unter `Datenverwaltung` › `Arbeitszeitmodelle` an. Dort ordnest du eine Vorlage auch mehreren Personen auf einmal zu.",
          "Oder wähle `Eigenes Modell` nur für diese Person.",
          "Wähle bei `Rotation` zum Beispiel `Standard (1 Woche)` oder `A/B-Wochen (2 Wochen)`.",
          "Trage je Wochentag die Stunden ein, zum Beispiel `4,45`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Die weiteren Bereiche der Akte",
        ordered: false,
        steps: [
          "`Übersicht`: Stundenkonto, Urlaubstage und Krankheitstage des Jahres.",
          "`Zeiterfassung`: die einzelnen Buchungen dieser Person.",
          "`Abwesenheiten`: unter `Kontingente` der Resturlaub und die Tage eigener Abwesenheitsarten, dazu `Krank melden` und `Freizeitausgleich eintragen`.",
          "`Stammdaten`: Person, Kontakt, Arbeitsvertrag, Qualifikationen und Personalnummer.",
          "`Dokumente`: Dateien zur Akte, je mit Kategorie und Frist.",
          "`Klassen`: nur bei Lehrkräften.",
        ],
      },
    ],
    result:
      "Unter `Arbeitszeitmodell` zeigt die `Vorschau` das Wochensoll der nächsten vier Wochen.",
    notes: [
      "Qualifikationen sind Nachweise wie Erste Hilfe am Kind, Rettungsfähigkeit oder erweitertes Führungszeugnis, jeweils mit Ablaufdatum. Wie moto daran erinnert, steht unter `Nachweise`.",
      "Die Personalnummer braucht die spätere Abrechnung. Ohne sie fehlt die Person dort.",
      "In der `Übersicht` buchst du unter `Stundenkonto-Verwaltung` Auszahlung, Freizeitausgleich oder einen Eröffnungssaldo.",
      "Ein Soll gilt ab seinem Startdatum. Beginnt es rückwirkend, rechnet moto auch frühere Tage gegen das Soll. Das Stundenkonto kann dann ins Minus rutschen. Lege das Startdatum deshalb bewusst fest.",
    ],
    differences: [
      "Änderst du eine Vorlage, wirkt das künftig auf alle Personen mit dieser Zuordnung.",
      "Den Bereich `Klassen` gibt es nur bei Lehrkräften.",
      "Bankverbindung und Steuernummer sind verborgen. Jeder Abruf wird festgehalten.",
      "Bei `Personalnummer` oder `Bank & Steuer` steht: „führt der Träger in seiner Personalakte“. Dann pflegt die Personalverwaltung des Trägers diese Werte. Du siehst die Personalnummer und änderst sie nicht.",
    ],
    troubleshootingDetails: [
      "Ein Krankheitstag zählt 0 Stunden? Dann fehlt das Soll. Trage es unter `Arbeitszeitmodell` ein.",
      "Ein Saldo stimmt nicht? Prüfe zuerst das `Arbeitszeitmodell`.",
      "Ein Bereich fehlt dir? Dann fehlt deiner Rolle das Recht dafür.",
    ],
    related: [
      HELP_TOPICS.leadWorkTimeTemplates,
      HELP_TOPICS.leadTargetOverride,
      HELP_TOPICS.leadWorkTimeReview,
      HELP_TOPICS.leadInviteStaff,
      HELP_TOPICS.leadPayroll,
      HELP_TOPICS.leadStaffQualifications,
    ],
  };
}
