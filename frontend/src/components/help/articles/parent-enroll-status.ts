import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Statusseite ueber den Link aus der Bestaetigungs-E-Mail. */
export function parentEnrollStatusTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentEnrollStatus,
    title: "Eine Anmeldung weiter bearbeiten",
    question: "Wo sehe ich, was aus meiner Anmeldung geworden ist?",
    summary: "Der Link aus der Bestätigungs-E-Mail führt zum Stand.",
    group: "anmeldung",
    audience: "parent",
    icon: "Eye",
    requirements: ["Du hast die Bestätigungs-E-Mail zu deiner Anmeldung."],
    steps: [],
    instructionGroups: [
      {
        title: "Den Stand ansehen",
        steps: [
          "Öffne den Link aus der Bestätigungs-E-Mail.",
          "Lies unter `Aktueller Stand`, wie weit die Prüfung ist.",
          "Unter `Was jetzt passiert` steht, was als Nächstes kommt.",
        ],
      },
      {
        title: "Angaben ändern",
        steps: [
          "Öffne die Statusseite.",
          "Tippe auf `Anmeldung bearbeiten`.",
          "Ändere die Angaben.",
          "Fragt das Formular nach deiner `Unterschrift`? Unterschreibe neu und tippe auf `Unterschrift bestätigen`.",
          "Tippe auf `Änderungen speichern`.",
        ],
      },
      {
        title: "Kinder in der Familie angeben",
        description:
          "Für die Geschwisterermäßigung zählt der Träger alle Kinder deiner Familie. Auch Kinder ohne Betreuungsvertrag zählen mit.",
        steps: [
          "Öffne die Statusseite.",
          "Gehe zur Karte `Kinder in deiner Familie`.",
          "Stelle mit Minus und Plus ein, wie viele Kinder deine Familie hat.",
          "Tippe auf `Angabe senden`.",
        ],
      },
      {
        title: "Eine Anmeldung zurückziehen",
        steps: [
          "Öffne die Statusseite.",
          "Tippe bei dem Kind auf `Dieses Kind zurückziehen`.",
          "Bestätige mit `Endgültig zurückziehen`.",
        ],
      },
    ],
    result:
      "Sobald die OGS entschieden hat, siehst du das unter `Kinder` und bekommst eine E-Mail.",
    notes: [
      "Nach einer Verlängerung kann das Formular nach dem Ferienwunsch fragen. Wähle je Kind `Ja` oder `Nein`.",
      "Zurückziehen kannst du nicht selbst rückgängig machen. Wende dich dann an die OGS.",
      "Bei Rückfragen meldet sich die OGS über die angegebene E-Mail-Adresse.",
      "Die Kinderzahl kannst du ändern, bis ein Kind angenommen ist. Sie kommt dann mit in deinen Betreuungsvertrag. Dort änderst du sie später.",
      "Hast du die Anmeldung unterschrieben, steht auf der Statusseite der Abschnitt `Unterschrift`. Mit `Nachweis als PDF` lädst du deinen Anmeldenachweis herunter.",
    ],
    differences: [
      "Steht dort `Bestätigung erforderlich`? Dann musst du mit `Anmeldung bestätigen` zusagen, sonst läuft die Anmeldung zur Frist ab. Stehen darüber Bedingungen? Lies sie und setze die Häkchen. Ohne Häkchen klappt die Bestätigung nicht.",
      "Steht dort `Anmeldung wurde verlängert` mit Bedingungen zum Ankreuzen? Die Betreuung läuft weiter. Für den Vertrag im neuen Zeitraum setzt du die Häkchen und tippst auf `Vertragsbedingungen bestätigen`.",
      "Steht dort `Zustimmung für den neuen Zeitraum`, solange die Schule noch prüft? Lies die Bedingungen und die PDF-Anhänge. Setze die Häkchen und bestätige. Die Schule entscheidet danach über die Anmeldung.",
      "Steht dort `Anmeldung wurde verlängert` ohne Bedingungen? Dann musst du nichts tun.",
      "Bei einem Kind steht `Diese Anmeldung kann nicht mehr online geändert werden`? Dann wende dich an die OGS.",
      "Steht dort `Noch kein Zugang zur Eltern-App`? Dann öffne die E-Mail „Einladung zum Eltern-Portal“ und lege dort ein Passwort fest. Vorher klappt die Anmeldung nicht.",
      "Steht dort `Zugang zur Eltern-App nicht möglich`? Dann wende dich an die OGS.",
      "Du siehst keine Karte `Kinder in deiner Familie`? Dann braucht dein Träger die Zahl nicht.",
    ],
    troubleshootingDetails: [
      "moto sagt, der Status-Link sei ungültig? Prüfe die Adresse aus der E-Mail oder frage bei der OGS nach.",
    ],
    related: [
      HELP_TOPICS.parentEnroll,
      HELP_TOPICS.parentMessages,
      HELP_TOPICS.parentChildMissing,
    ],
  };
}
