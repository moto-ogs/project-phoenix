import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Tagesinformationen unter `/tagesinformationen`: lesen alle, anlegen nur
 * Admins (page.tsx:183). Die Zielgruppen stehen in AUDIENCE_LABELS
 * (lib/staff-notices-api.ts:239).
 */
export function staffNoticesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadStaffNotices,
    title: "Hinweise der Leitung an das Team schreiben",
    question: "Wie erreiche ich das ganze Team mit einem Hinweis?",
    summary: "Einen Hinweis der Leitung sehen alle, die heute arbeiten.",
    group: "planung",
    audience: "lead",
    icon: "Megaphone",
    image: "/help/screens/tagesinformationen-anlegen.webp",
    imageAlt:
      "Das Fenster für einen neuen Hinweis mit Titel, Hinweis, Empfängern und Wochentagen.",
    steps: [
      "Klappe in der Seitenleiste `Team` auf.",
      "Öffne `Hinweise der Leitung`.",
      "Wähle `Neuer Hinweis`.",
      "Trage `Titel` und `Hinweis` ein.",
      "Wähle bei `Für wen` `Alle`, `Nur Betreuung` oder `Nur Lehrkräfte`.",
      "Wähle bei `Wichtigkeit`, wie dringend der Hinweis ist.",
      "Wähle bei `Woche`, ob der Hinweis sich wiederholt.",
      "Trage `Gilt ab` und bei Bedarf `Gilt bis (optional)` ein.",
      "Wähle unter `Wochentage` die Tage aus, an denen der Hinweis erscheint.",
      "Wähle `Speichern`.",
    ],
    result:
      "Der Hinweis steht an seinen Tagen unter `Heute` für die gewählte Gruppe. Bei `Alle` und `Nur Betreuung` steht er außerdem sofort bei den Benachrichtigungen der Betreuung.",
    notes: [
      "Mit `Kenntnisnahme verlangen` siehst du später, wer den Hinweis bestätigt hat.",
      "Das Team sieht den Hinweis an seinen Tagen auch auf der `Startseite` in `Heute anders`. Dort kann es ihn gleich mit `Zur Kenntnis nehmen` bestätigen.",
      "`Nur Lehrkräfte` erreicht die Lehrkräfte in moto schule. Unter `Für wen` steht das auch im Fenster.",
      "Du selbst bekommst zu deinem eigenen Hinweis keine Benachrichtigung. Ein Hinweis, der schon vorbei ist, auch nicht.",
      "Speicherst du einen Hinweis ohne Haken bei `Aktiv`, kommt die Benachrichtigung erst, wenn du den Haken setzt.",
    ],
    differences: [
      "Ein wichtiger Hinweis trägt `Wichtig`, ein abgeschalteter `Abgeschaltet`.",
      "Lesen können alle im Team. Anlegen und ändern darf nur die Leitung.",
    ],
    troubleshootingDetails: [
      "Beim Löschen gehen die bereits erfassten Kenntnisnahmen mit verloren.",
      "Soll die Nachricht an Eltern gehen? Nutze stattdessen eine Elternmitteilung.",
    ],
    related: [
      HELP_TOPICS.leadTeacherAccess,
      HELP_TOPICS.leadParentAnnouncement,
      HELP_TOPICS.leadInviteStaff,
    ],
  };
}
