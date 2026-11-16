import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/nachweise` (#4707, ADR 0238): Nachweise der Personalakten mit
 * Ablaufwarnung. Nachweisarten einstellen, Nachweise in der Akte eintragen,
 * die Ablaufliste lesen und herunterladen, die Arten der Schulen zuordnen.
 */
export function traegerStaffProofsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffProofs,
    title: "Personalnachweise mit Ablaufwarnung",
    question: "Wie behalte ich Führungszeugnis und Masernschutz im Blick?",
    summary:
      "Sie tragen Nachweise in der Personalakte ein. moto warnt vor dem Ablauf und zeigt alle offenen Nachweise auf einer Liste.",
    group: "personal",
    audience: "traeger",
    icon: "ShieldCheck",
    requirements: [
      "Sie haben die Rolle `Personal`.",
      "Ihr Träger führt Personalakten. Dafür hat das moto-Team `Personal beim Träger` freigeschaltet.",
    ],
    instructionGroups: [
      {
        title: "Nachweisarten einstellen",
        description:
          "moto beginnt mit drei Arten: Erweitertes Führungszeugnis, Masernschutz und Präventionsschulung.",
        steps: [
          "Wählen Sie in der Navigation `Personalnachweise`.",
          "Öffnen Sie den Reiter `Nachweisarten`.",
          "Wählen Sie `Nachweisart anlegen` oder öffnen Sie eine Art.",
          "Tragen Sie ein, wie lange der Nachweis gilt und wie viele Wochen vorher moto warnt.",
          "Schalten Sie `Pflicht für alle Personen mit Akte` ein, wenn jede Person den Nachweis braucht.",
          "Wählen Sie `Nachweisart anlegen` oder `Änderungen speichern`.",
        ],
      },
      {
        title: "Einen Nachweis eintragen",
        steps: [
          "Öffnen Sie die Personalakte der Person.",
          "Wählen Sie bei `Nachweise` neben der Art `Eintragen` oder `Erneuern`.",
          "Wählen Sie den Tag, an dem der Nachweis vorlag.",
          "Beim Führungszeugnis: Wählen Sie auch das Ausstellungsdatum. Bestätigen Sie, dass es keine einschlägige Eintragung hat.",
          "Lassen Sie `Gültig bis` leer. moto rechnet das Datum aus.",
          "Wählen Sie `Nachweis speichern`.",
        ],
      },
      {
        title: "Die Ablaufliste lesen und herunterladen",
        steps: [
          "Wählen Sie in der Navigation `Personalnachweise`.",
          "Im Reiter `Ablaufliste` sehen Sie alle offenen Nachweise. Das Dringendste steht oben.",
          "Wählen Sie oben rechts `Herunterladen` und dann `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Nachweise.",
        ],
      },
      {
        title: "Die Nachweisarten der Schulen zuordnen",
        description:
          "So erinnert moto nur einmal an dasselbe Führungszeugnis: vom Träger, nicht noch einmal von der Schule.",
        steps: [
          "Öffnen Sie den Reiter `Arten der Schulen`.",
          "Wählen Sie bei jeder Art der Schule die passende Art Ihres Trägers.",
          "Wählen Sie `Zuordnung speichern`.",
        ],
      },
    ],
    steps: [],
    result:
      "Vor dem Ablauf bekommen die Leitung jedes Einsatzorts und die Person eine Nachricht und eine E-Mail. Am Ablauftag kommt eine zweite. Die Schule sieht bei der Person nur den Stand: gültig, läuft bald ab, abgelaufen oder fehlt.",
    notes: [
      "Vom Führungszeugnis speichert moto keine Kopie. Geben Sie das Zeugnis der Person zurück (§ 72a Abs. 5 SGB VIII).",
      "Hat ein Führungszeugnis eine einschlägige Eintragung, tragen Sie es nicht ein.",
      "Jedes Anzeigen der Ablaufliste und jeder Export steht im Zugriffsprotokoll jeder Schule.",
      "Eine Schule ohne Träger-App behält ihre eigenen Nachweise wie bisher.",
    ],
    differences: [
      "Sie sehen `Personalnachweise` nicht in der Navigation: Ihnen fehlt die Rolle `Personal`.",
      "Im Reiter `Arten der Schulen` steht bei einer Schule keine Art: Die Schule hat noch keine Nachweisarten angelegt.",
    ],
    troubleshootingDetails: [
      "„Eine Nachweisart mit diesem Namen gibt es schon“: Wählen Sie einen anderen Namen, oder holen Sie die archivierte Art zurück.",
    ],
    related: [HELP_TOPICS.traegerStaffRecords, HELP_TOPICS.traegerAccessLog],
  };
}
