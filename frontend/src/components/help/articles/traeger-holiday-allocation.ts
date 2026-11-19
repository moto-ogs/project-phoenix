import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/ferien/kriterien` und `/traeger/ferien/[id]/vergabe` (#4700):
 * Plätze nach Kriterien vergeben. moto sortiert vor, das Büro entscheidet.
 */
export function traegerHolidayAllocationTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerHolidayAllocation,
    title: "Ferienplätze nach Kriterien vergeben",
    question: "Wie vergebe ich Ferienplätze nach Kriterien?",
    summary:
      "Eltern beantworten deine Fragen mit Ja oder Nein. moto sortiert die Anmeldungen danach vor. Dein Büro entscheidet über jeden Platz.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "CheckSquare",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
      "Der Ferienzeitraum hat noch keine Anmeldung. Danach bleibt die Art der Platzvergabe so.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Kriterien festlegen",
        steps: [
          "Wähle in der Navigation `Ferienbetreuung`.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle `Kriterien der Platzvergabe`.",
          "Wähle eine Vorlage oder `Eigenes Kriterium`.",
          "Gib den Namen und die `Frage an die Eltern` ein. Wähle bei `Gilt für`, ob die Frage für die Familie oder für jedes Kind gilt.",
          "Bringe die Kriterien mit den Pfeilen in die richtige Reihenfolge. Das oberste Kriterium zählt am meisten.",
          "Wähle `Kriterien speichern`.",
        ],
      },
      {
        title: "Ferienzeitraum nach Kriterien vergeben",
        steps: [
          "Öffne den Ferienzeitraum im Reiter `Planung`.",
          "Wähle bei `Wie werden die Plätze vergeben?` die Karte `Nach Kriterien`.",
          "Wähle `Speichern`.",
        ],
      },
      {
        title: "Plätze vergeben",
        steps: [
          "Öffne den Ferienzeitraum und wähle den Reiter `Vergabe`.",
          "Je Woche stehen die offenen Anmeldungen in der Reihenfolge des Vorschlags. Die Zeile mit „ab hier schlägt moto die Warteliste vor“ zeigt, wo die freien Plätze enden.",
          "Wähle bei einem Kind `Platz geben` oder `Auf die Warteliste`. Weicht das vom Vorschlag ab, schreibe eine `Begründung`.",
          "Oder wähle bei der Woche `Vorschlag übernehmen`. Mit mehreren Wochen gibt es oben `Vorschlag für alle Wochen übernehmen`.",
          "Bestätige im Fenster.",
        ],
      },
      {
        title: "Vergabe herunterladen",
        description: "Zum Drucken, zum Ablegen oder für eine Tabelle.",
        steps: [
          "Öffne den Ferienzeitraum und wähle den Reiter `Vergabe`.",
          "Öffne oben rechts das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`.",
          "Die Datei enthält die offenen Anmeldungen im Vorschlag und alle Entscheidungen deines Büros.",
        ],
      },
      {
        title: "Angaben einer Familie prüfen",
        steps: [
          "Öffne die Anmeldung.",
          "Wähle bei `Angaben für die Vergabe` den Knopf `Prüfen`.",
          "Wähle je Kriterium `Trifft zu`, `Trifft nicht zu` oder `Nicht geprüft`.",
          "Wähle `Prüfung speichern`.",
        ],
      },
    ],
    result:
      "Die Eltern bekommen eine E-Mail mit dem Platz oder der Warteliste. Danach rücken Kinder von der Warteliste automatisch nach, wenn ein Platz frei wird. Die Warteliste ist nach deinen Kriterien sortiert, dann nach Eingang.",
    notes: [
      "moto schlägt nur vor. Jede Entscheidung trifft dein Büro. Unter `Verlauf der Entscheidungen` steht jede Entscheidung mit Vorschlag und Begründung.",
      "Bei gleichen Kriterien zählt, wer sich zuerst angemeldet hat.",
      "Sobald Antworten vorliegen, bleibt `Gilt für` beim Kriterium fest.",
      "Solange eine Woche offene Entscheidungen hat, rückt dort niemand nach. Nach der letzten Entscheidung können ältere Wartelisteneinträge nachrücken. Gerade auf die Warteliste gesetzte Kinder bleiben zunächst dort.",
      "Eine Prüfung des Büros zählt vor der Angabe der Eltern. Sie ändert den Vorschlag für offene Plätze.",
      "Frage nur, was du für die Vergabe brauchst. Frage nicht nach Gesundheit oder Förderbedarf.",
      "Ein Kind mit offenem Platz zahlt nichts. Es steht auch nicht auf der Teilnehmerliste der OGS.",
      "Eine Anmeldung mit offenem Platz kannst du erst bestätigen, wenn das Büro entschieden hat.",
    ],
    differences: [
      "Bei einem Kriterium steht `ungeklärt`? Die Eltern haben dazu nichts gesagt, zum Beispiel weil das Kriterium später dazukam. Es zählt erst, wenn dein Büro es geprüft hat.",
      "Der Reiter `Vergabe` fehlt? Der Ferienzeitraum vergibt die Plätze nach Eingang.",
      "Die Karten bei `Wie werden die Plätze vergeben?` lassen sich nicht wählen? Es gibt schon Anmeldungen.",
    ],
    troubleshootingDetails: [
      "Es erscheint, dass sich die Liste geändert hat? Jemand hat gerade entschieden oder eine Angabe geprüft. moto lädt die Liste neu. Prüfe deine Entscheidung noch einmal.",
      "Kein Platz für die gewünschten Tage frei? Erhöhe im Reiter `Plätze` die Zahl der Plätze. Bei einzelnen Tagen prüft moto nur die gebuchten Tage.",
      "Bei vielen Anmeldungen übernimmt moto den Vorschlag schrittweise. Bei einem Fehler bleiben gespeicherte Entscheidungen erhalten. Prüfe die offenen Anmeldungen und versuche es erneut.",
    ],
    related: [
      HELP_TOPICS.traegerHolidayPlaces,
      HELP_TOPICS.traegerHolidayPeriod,
      HELP_TOPICS.traegerHolidayRegistrationReview,
    ],
  };
}
