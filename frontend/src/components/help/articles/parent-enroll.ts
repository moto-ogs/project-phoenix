import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** `/parents/anmeldung`: Phase waehlen, Formular ausfuellen, absenden. */
export function parentEnrollTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentEnroll,
    title: "Mein Kind anmelden",
    question: "Wie melde ich mein Kind für die OGS an?",
    summary: "Du wählst die Anmeldung und füllst ein Formular aus.",
    group: "anmeldung",
    audience: "parent",
    icon: "ListChecks",
    steps: [
      "Tippe unten auf `Mehr`.",
      "Wähle `Neue Anmeldung`.",
      "Wähle unter `Deine Schulen` oder `Weitere Schulen` die Schule.",
      "Tippe auf die passende Anmeldung. Das Formular öffnet sich sofort.",
      "Trage deine Kontaktdaten und die Angaben zum Kind ein.",
      "Wähle unter `Zusätzlich wählen` mindestens ein Angebot. `Pflichtangebote` sind schon gesetzt.",
      "Fragt das Formular unten nach deiner `Unterschrift`? Unterschreibe im Feld und tippe auf `Unterschrift bestätigen`.",
      "Tippe auf `Anmeldung absenden`.",
    ],
    result:
      "Du bekommst eine Bestätigungs-E-Mail mit einem Link zum Stand deiner Anmeldung.",
    notes: [
      "Mit `Weiteres Kind` meldest du Geschwister in derselben Anmeldung an.",
      "Bewahre die Bestätigungs-E-Mail auf. Der Link darin führt zum Stand.",
      "Eine Anmeldung gilt für ein `Schuljahr`, eine `Ferienbetreuung` oder `Sonstiges`.",
      "Fragt das Formular nach einem Nachweis? Tippe auf `Datei auswählen`. Die Datei wird sofort hochgeladen.",
      "Unter dem Knopf steht, welche Dateien erlaubt sind und wie groß sie sein dürfen. Meist sind es PDF, JPG oder PNG bis 10 MB.",
      "Auf dem Handy kannst du den Nachweis auch direkt fotografieren.",
      "Eine falsche Datei entfernst du mit dem Kreuz neben dem Dateinamen.",
      "Statt zu zeichnen kannst du mit `Namen tippen` deinen Vor- und Nachnamen eintippen.",
    ],
    differences: [
      "Manche Anmeldungen sind `Nur bereits angemeldete Kinder`.",
      "Nicht jede Schule fragt nach einer Unterschrift. Ohne Feld `Unterschrift` sendest du die Anmeldung direkt ab.",
      "An jeder Anmeldung steht `Anmeldung bis` mit der Frist.",
      "Über dem Formular steht `Zurück zu Neue Anmeldung`. Damit wählst du eine andere Anmeldung.",
    ],
    troubleshootingDetails: [
      "moto sagt, aktuell sei keine Anmeldephase geöffnet? Dann wende dich an die OGS.",
      "moto sagt, die Online-Anmeldung sei nicht freigeschaltet? Dann nimmt diese OGS keine Anmeldungen über moto an.",
      "moto sagt, eine hochgeladene Datei sei abgelaufen? Dann ist sie älter als einen Tag. Lade sie noch einmal hoch und sende die Anmeldung ab.",
      "Steht vor dem Absenden `Die Sicherheitsprüfung lädt nicht`? Oft blockiert ein Werbeblocker die Prüfung. Schalte ihn für die Seite aus und wähle `Prüfung neu starten`. Hilft das nicht, wähle `Link kopieren` und öffne den Link in einem anderen Browser, zum Beispiel Chrome.",
      "Ein roter Hinweis nennt einen Tag und zwei Angebote? Diese Angebote gehen am selben Tag nicht zusammen. Nimm den Tag bei einem der beiden heraus.",
    ],
    related: [
      HELP_TOPICS.parentEnrollStatus,
      HELP_TOPICS.parentChildOverview,
      HELP_TOPICS.parentCareChange,
    ],
  };
}
