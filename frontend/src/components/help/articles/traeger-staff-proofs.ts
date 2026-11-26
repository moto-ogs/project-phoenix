import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/traeger/nachweise` (#4707, ADR 0238): Nachweise der Personalakten mit
 * Ablaufwarnung. Nachweisarten einstellen, Nachweise in der Akte eintragen,
 * die Ablaufliste lesen und herunterladen, die Nachweisarten der Schulen
 * zuordnen.
 */
export function traegerStaffProofsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerStaffProofs,
    title: "Personalnachweise mit Ablaufwarnung",
    question: "Wie behalte ich Führungszeugnis und Masernschutz im Blick?",
    summary:
      "Du trägst Nachweise in der Personalakte ein. moto warnt vor dem Ablauf und zeigt alle offenen Nachweise auf einer Liste.",
    group: "personal",
    audience: "traeger",
    icon: "ShieldCheck",
    requirements: [
      "Du hast die Rolle `Personal`.",
      "Dein Träger führt Personalakten. Dafür hat das moto-Team `Personal beim Träger` freigeschaltet.",
    ],
    instructionGroups: [
      {
        title: "Nachweisarten einstellen",
        description:
          "moto beginnt mit drei Arten: Erweitertes Führungszeugnis, Masernschutz und Präventionsschulung.",
        steps: [
          "Wähle in der Navigation `Personalnachweise`.",
          "Öffne den Reiter `Nachweisarten`.",
          "Wähle `Nachweisart anlegen` oder öffne eine Art.",
          "Trage ein, wie lange der Nachweis gilt und wie viele Wochen vorher moto warnt.",
          "Schalte `Pflicht für alle Personen mit Akte` ein, wenn jede Person den Nachweis braucht.",
          "Wähle `Nachweisart anlegen` oder `Änderungen speichern`.",
        ],
      },
      {
        title: "Einen Nachweis eintragen",
        steps: [
          "Öffne die Personalakte der Person und darin den Reiter `Nachweise`.",
          "Wähle bei `Nachweise` neben der Art `Eintragen` oder `Erneuern`.",
          "Wähle den Tag, an dem der Nachweis vorlag.",
          "Beim Führungszeugnis: Wähle auch das Ausstellungsdatum. Bestätige, dass es keine einschlägige Eintragung hat.",
          "Lass `Gültig bis` leer. moto rechnet das Datum aus.",
          "Wähle `Nachweis speichern`.",
        ],
      },
      {
        title: "Die Ablaufliste lesen und herunterladen",
        steps: [
          "Wähle in der Navigation `Personalnachweise`.",
          "Im Reiter `Ablaufliste` siehst du alle offenen Nachweise. Das Dringendste steht oben.",
          "Öffne rechts neben der Suche das Drei-Punkte-Menü. Wähle unter `Herunterladen` `PDF`, `Excel` oder `CSV`. Die Datei enthält alle Nachweise.",
        ],
      },
      {
        title: "Die Nachweisarten der Schulen zuordnen",
        description:
          "Jede Schule hat eigene Nachweisarten, oft mit demselben Namen wie deine. Ordnest du sie zu, erinnert bei Personen mit Personalakte nur dein Träger. Die Schule erinnert dann nicht noch einmal.",
        steps: [
          "Wähle in der Navigation `Personalnachweise`.",
          "Öffne den Reiter `Zuordnung der Schulen`.",
          "Wähle bei jeder `Nachweisart der Schule` die passende `Nachweisart deines Trägers`.",
          "Wähle `Zuordnung speichern`.",
        ],
      },
    ],
    steps: [],
    result:
      "Vor dem Ablauf bekommen die Leitung jedes Einsatzorts und die Person eine Nachricht und eine E-Mail. Am Ablauftag kommt eine zweite. Die Schule sieht bei der Person nur den Stand: gültig, läuft bald ab, abgelaufen oder fehlt.",
    notes: [
      "Vom Führungszeugnis speichert moto keine Kopie. Gib das Zeugnis der Person zurück (§ 72a Abs. 5 SGB VIII).",
      "Hat ein Führungszeugnis eine einschlägige Eintragung, trage es nicht ein.",
      "Jedes Anzeigen der Ablaufliste und jeder Export steht im Zugriffsprotokoll jeder Schule.",
      "Eine Schule ohne Träger-App behält ihre eigenen Nachweise wie bisher.",
    ],
    differences: [
      "Du siehst `Personalnachweise` nicht in der Navigation: dir fehlt die Rolle `Personal`.",
      "Im Reiter `Zuordnung der Schulen` steht bei einer Schule keine Art: Die Schule hat noch keine Nachweisarten angelegt.",
    ],
    troubleshootingDetails: [
      "„Eine Nachweisart mit diesem Namen gibt es schon“: Wähle einen anderen Namen, oder hole die archivierte Art zurück.",
    ],
    related: [HELP_TOPICS.traegerStaffRecords, HELP_TOPICS.traegerAccessLog],
  };
}
