import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function traegerHolidayFormTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerHolidayForm,
    title: "Anmeldeformular der Ferien",
    question: "Wie lege ich eigene Fragen für die Ferienanmeldung fest?",
    summary:
      "Jeder Ferienzeitraum hat ein eigenes Formular. Du wählst, welche Fragen Eltern zusätzlich beantworten.",
    image: "/help/screens/ferienformular-gesundheitsfrage.webp",
    imageAlt:
      "Eine Gesundheitsfrage mit den Häkchen Gesundheitsangabe und OGS sieht die Antwort. Rechts die Vorschau für Eltern.",
    group: "anmeldeverwaltung",
    audience: "traeger",
    icon: "NotePencil",
    requirements: [
      "Deine Rolle im Träger-Büro darf Anmeldungen verwalten. Das gilt für die Rolle Verwaltung.",
    ],
    steps: [],
    instructionGroups: [
      {
        title: "Hinweise und Einwilligungen ergänzen",
        steps: [
          "Wähle unter `Hinweise und Einwilligungen` die Aktion `Hinweis oder Einwilligung hinzufügen`.",
          "Trage `Titel` und `Text neben dem Häkchen oder Hinweis` ein.",
          "Ergänze den Text unter `Rechtstext / Erklärung`.",
          "Für ein PDF wähle `PDFs hinzufügen`. Höchstens 10 MB pro Datei.",
          "Trage unter `Bezeichnung für Eltern` einen passenden Namen ein.",
          "Müssen Eltern den Hinweis bestätigen? Wähle `Muss bestätigt werden`.",
          "Eine freiwillige Einwilligung lässt du ohne diese Pflicht.",
          "Wähle `Als neue Version speichern`.",
        ],
      },
      {
        title: "Fragen festlegen",
        steps: [
          "Wähle in der Navigation `Ferienbetreuung`.",
          "Öffne den Ferienzeitraum.",
          "Wähle den Reiter `Formular`.",
          "Wähle `Frage hinzufügen` oder `Infotext hinzufügen`.",
          "Schreibe die Frage und wähle den `Typ`, zum Beispiel `Ja/Nein` oder `Auswahl`.",
          "Soll jede Familie antworten oder jedes Kind? Für Fragen zum Kind wähle `Pro Kind abfragen`.",
          "Muss die Frage beantwortet werden? Wähle `Pflichtfrage`.",
          "Geht es um die Gesundheit des Kindes? Wähle `Gesundheitsangabe`.",
          "Bei neuen Fragen ist `OGS sieht die Antwort` an. Die ausrichtende OGS sieht die Antwort. Du kannst das ausschalten. Bei einer `Gesundheitsangabe` sieht sie die Antwort nur, wenn die Eltern zustimmen.",
          "Mit den Pfeilen änderst du die Reihenfolge.",
          "Wähle `Als neue Version speichern`.",
        ],
      },
      {
        title: "Allergien und Medikamente zur Pflicht machen",
        steps: [
          "Wähle unter `Gesundheit` die Einstellung `Pflicht`.",
          "Wähle `Als neue Version speichern`.",
          "Eltern beantworten dann für jedes Kind zwei Fragen: Allergien und Medikamente. Hat das Kind keine, wählen sie `Nein, keine`. Bei `Ja` schreiben sie auf, was ihr Kind hat.",
          "In der Anmeldung steht dann „Keine“ oder der Text der Eltern. Ein leeres Feld gibt es nicht mehr.",
        ],
      },
      {
        title: "Anschrift abfragen",
        steps: [
          "Wähle unter `Anschrift`, ob Eltern Straße, PLZ und Ort angeben: `Nicht abfragen`, `Freiwillig` oder `Pflicht`.",
          "Wähle `Als neue Version speichern`.",
          "Rechnung und Bestätigungsschreiben übernehmen die Anschrift der Familie.",
        ],
      },
      {
        title: "Standardvorlage einfügen",
        steps: [
          "Wähle `Standardvorlage einfügen`.",
          "moto fügt die Fragen der Vorlage ein, die im Formular fehlen. Zum Beispiel Lebensmittelunverträglichkeiten, Tetanus-Impfschutz, Ausflüge und Klasse.",
          "Ändere oder entferne Fragen, die du nicht brauchst.",
          "Wähle `Als neue Version speichern`.",
        ],
      },
      {
        title: "Frage nur unter einer Bedingung zeigen",
        steps: [
          "Lege zuerst eine andere Frage mit `Ja/Nein` oder `Auswahl` an.",
          "Schreibe auch den Fragetext dazu.",
          "Gehe zu der Frage, die nur manchmal erscheinen soll.",
          "Wähle dort `Nur unter einer Bedingung anzeigen`.",
          "Wähle die Frage und die Antwort, bei der sie erscheinen soll.",
        ],
      },
    ],
    result:
      "Neue Anmeldungen nutzen das gespeicherte Formular. Rechts siehst du, wie Eltern es sehen.",
    notes: [
      "Name, Geburtsdatum, Schule, Wochen, Allergien, Medikamente, Kontakte und Zustimmungen fragt die Anmeldung immer ab.",
      "Allergien und Medikamente sind zuerst freiwillig. Mit `Pflicht` unter `Gesundheit` brauchst du keine eigene Frage dafür. Eine eigene Pflichtfrage zu Allergien fragt dasselbe ein zweites Mal.",
      "Bei `Pflicht` brauchen Eltern immer die Zustimmung zu den Gesundheitsangaben. Auch „Keine“ ist eine Gesundheitsangabe. Weitere Hinweise zur Gesundheit bleiben freiwillig.",
      "Ein neuer Ferienzeitraum fragt keine Anschrift ab. Ältere Versionen fragen auch keine ab. Bei `Freiwillig` geben Eltern alle drei Angaben an oder keine.",
      "Ein neuer Ferienzeitraum startet mit der Standardvorlage. Alle Fragen darin sind zuerst freiwillig. Alle Fragen sind für die ausrichtende OGS freigegeben. Antworten auf Gesundheitsfragen sieht sie nur, wenn die Eltern zustimmen.",
      "Schon verwendete PDFs bleiben bei der alten Anmeldung lesbar. Neue Anmeldungen sehen die neue Version.",
      "Jedes Speichern legt eine neue Version an. Schon abgeschickte Anmeldungen behalten ihre Version und ihre Fragen.",
      "Mit `Änderungen verwerfen` holst du die gespeicherten Fragen zurück. Das gilt auch für Auswahloptionen.",
      "Eine Antwort mit Gesundheitsangabe braucht die Zustimmung der Eltern. Sie steht nicht in Liste und Export. In der Anmeldung sieht sie nur die Rolle Verwaltung.",
      "Antworten ohne Gesundheitsangabe stehen im Export in eigenen Spalten.",
      "Die ausrichtende OGS sieht nur Antworten mit `OGS sieht die Antwort`. Sie stehen in ihrer Liste unter `Ferienwochen` und beim Feriengast.",
      "Haben die Eltern zugestimmt, sieht die ausrichtende OGS Allergien, Medikamente und weitere Hinweise. Gesundheitsfragen mit `OGS sieht die Antwort` sieht sie auch.",
      "`OGS sieht die Antwort` gilt ab der Version, in der du es speicherst. Bei älteren Anmeldungen bleibt die bisherige Freigabe unverändert.",
      "Die OGS sieht auch Name und Telefon der zweiten sorgeberechtigten Person, keine E-Mail-Adresse.",
    ],
    troubleshootingDetails: [
      "Fehlt `Nur unter einer Bedingung anzeigen`? Du brauchst eine andere Ja/Nein- oder Auswahlfrage mit Fragetext. Diese Frage kann dann von deren Antwort abhängen.",
      "Fehlt bei der anderen Frage noch der Fragetext? Schreibe ihn zuerst dazu.",
      "Gilt die andere Frage pro Kind? Eine allgemeine Frage kann nicht davon abhängen. Nutze eine andere allgemeine Ja/Nein- oder Auswahlfrage. Schreibe auch den Fragetext dazu.",
      "`Standardvorlage einfügen` lässt sich nicht wählen? Alle Fragen der Vorlage sind schon im Formular.",
    ],
    related: [
      HELP_TOPICS.traegerHolidayPeriod,
      HELP_TOPICS.traegerHolidayRegistration,
      HELP_TOPICS.traegerHolidayRegistrationReview,
    ],
  };
}
