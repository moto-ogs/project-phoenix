import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/parents/children`. Live geprueft: die Kindseite zeigt oben `Heute` mit
 * `Aktueller Status`, `Abholung` und drei Knoepfen, darunter die drei
 * Reiter `Betreuung`, `Angaben` und `Kontakte`. Unter dem Status steht
 * `Heute anders` (#7671), auch auf der Startseite. Die langen Bereichsnamen
 * aus `parentChild.areas.*.title` stehen nur im aria-label.
 */
export function parentChildOverviewTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentChildOverview,
    title: "Mein Kind und den heutigen Tag ansehen",
    question: "Wo sehe ich, wie der Tag meines Kindes läuft?",
    summary: "Die Seite `Kinder` zeigt den heutigen Tag und drei Bereiche.",
    group: "mein-kind",
    audience: "parent",
    icon: "UserRoundSearch",
    steps: [
      "Tippe unten auf `Mein Kind`.",
      "Hast du mehrere Kinder, wähle oben das Kind.",
      "Lies unter `Heute` den `Aktueller Status` und die `Abholung`.",
      "Lies darunter `Heute anders`. Dort steht, was heute für dein Kind anders ist.",
      "Wähle darunter einen Reiter: `Betreuung`, `Angaben` oder `Kontakte`.",
    ],
    result: "Du siehst den gewählten Reiter mit allen Angaben dazu.",
    notes: [
      "`Betreuung`: Abwesenheiten, Wochenplan, gebuchte Betreuung und der Weg nach Hause.",
      "`Angaben`: persönliche Angaben, Klasse und Gesundheit.",
      "`Kontakte`: Abholberechtigte, Kontakte und verbundene Konten.",
      "Unter `Heute` stehen die Knöpfe zum Abmelden, zur Abholzeit und für eine Nachricht.",
      "`Heute anders` nennt zum Beispiel: Ein Angebot fällt aus, ist in einem anderen Raum oder hat eine Vertretung. Dazu kommen eine geänderte Abholzeit, ein Schließtag, geänderte Öffnungszeiten, ein Ausflug oder eine Krankmeldung.",
      // Essensausfall im Elternportal (#8160): nur bei einer Buchung des Kindes.
      "Fällt das Mittagessen aus und dein Kind ist an dem Tag angemeldet, steht das auch unter `Heute anders`. Der Tag wird nicht berechnet.",
      // #8170, #8173: eine Abholzeit nach der geänderten Schließzeit bleibt stehen.
      "Schließt die OGS heute früher und liegt deine Abholzeit danach, steht dort `Das ist nach der Schließung.` Das gilt auch für die Abholzeit aus dem Wochenplan. moto ändert die Abholzeit nicht. Wähle `Abholung ändern` und trage eine frühere Zeit ein.",
      "Namen von Betreuungskräften stehen bei `Heute anders` nie. Du siehst nur, was dein Kind betrifft.",
      "Was du selbst eingetragen hast, ist mit `Von dir eingetragen` markiert. So siehst du, dass es angekommen ist.",
      "Die Startseite zeigt `Heute anders` für jedes Kind in seiner eigenen Karte.",
    ],
    differences: [
      "Hast du mehrere Kinder, heißt der Punkt unten `Meine Kinder`.",
      "Ist dein Kind heute abgemeldet, steht dort `Heute abgemeldet, keine Abholung`.",
      "Wurde die Abholzeit für heute geändert, steht die Zeit mit dem Hinweis `geändert für heute`.",
      "Ist für heute nichts eingetragen, steht dort `Für heute ist keine Abholung eingetragen`.",
      "Ist heute nichts anders, steht unter `Heute anders` der Satz `Heute läuft alles wie geplant.`",
      "Konnte moto nicht alles laden, steht dort ein Hinweis. Schau dann später noch einmal nach.",
      "Hat dein Kind keinen Platz in der OGS, steht unter `Betreuung` der Hinweis `Kein Platz in der OGS`. Abholung, Betreuungszeiten und Essen fehlen dann. Krankmeldung, Elternsprechtag und Angaben bleiben.",
    ],
    troubleshootingDetails: [
      "Du siehst kein Kind? Dann hat die OGS deinen Zugang noch nicht freigegeben.",
    ],
    related: [
      HELP_TOPICS.parentChildData,
      HELP_TOPICS.parentReportAbsence,
      HELP_TOPICS.parentCalendar,
    ],
  };
}
