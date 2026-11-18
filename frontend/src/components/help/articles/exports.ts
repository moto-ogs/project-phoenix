import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/database/exports`: fertige Listen als Datei (Kinder, Personal, Notfall). */
export function exportsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadExports,
    title: "Eine Liste exportieren",
    question: "Wie bekomme ich Daten aus moto als Datei?",
    summary: "Fertige Listen lassen sich als Datei herunterladen.",
    group: "auswertung",
    audience: "lead",
    icon: "Download",
    image: "/help/screens/export-dialog.webp",
    imageAlt:
      "Das Fenster zum Exportieren einer Kinderliste mit Titel, Spalten und Format.",
    steps: [
      "Öffne `Datenverwaltung` und danach `Exporte`.",
      "Suche die passende Liste und wähle `Liste erstellen`.",
      "Hake unter `Spalten` an, was in der Liste stehen soll.",
      "Wähle unter `Format` `PDF`, `Word` oder `Excel`.",
      "Wähle `Herunterladen`.",
    ],
    result: "Die Datei liegt im Download-Ordner deines Geräts.",
    notes: [
      "Die Listen sind in `Kinderlisten`, `Personallisten` und `Momentaufnahmen` geordnet.",
      "Eine `Momentaufnahme` wie die `Notfallliste` zeigt den Stand von jetzt. Dort öffnet `Liste erstellen` ein Menü: `Drucken` oder das Format.",
      "Die `Gesundheitsliste` zeigt Allergien, Medikamente und andere Gesundheitsinformationen.",
      "Sie enthält zuerst nur Kinder mit einem Eintrag.",
      "`Auch Kinder ohne Eintrag` nimmt alle Kinder auf.",
      "Jeder Export der `Gesundheitsliste` wird protokolliert.",
      "Jede Datei enthält personenbezogene Daten. Behandle sie wie jede andere Unterlage dieser Art.",
    ],
    differences: [
      "Du siehst weniger Listen als eine Kollegin? Jede Liste hängt an einem eigenen Recht.",
    ],
    troubleshootingDetails: [
      "Fehlt ein Kind auf der `Gesundheitsliste`? Dann ist bei ihm nichts eingetragen. Hake `Auch Kinder ohne Eintrag` an.",
      "Brauchst du Zahlen statt Namen? Nutze die `Statistik`.",
      "Brauchst du eine Liste für einen bestimmten Tag? Nutze die `Tageslisten`.",
    ],
    related: [
      HELP_TOPICS.leadStatistics,
      HELP_TOPICS.leadDayLists,
      HELP_TOPICS.dataManagement,
    ],
  };
}
