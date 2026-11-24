import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * moto-Module im Träger-Portal (#6052). Die Seite `moto-Module` unter
 * `Einstellungen` zeigt ihren Stand; Navigation und Seiten
 * folgen dem Register (lib/traeger-modules.ts). Das Schloss sieht nur, wer
 * das Träger-Büro leitet. „moto-Modul“, weil „Modul“ im Träger-Portal auch
 * die Betreuungsmodule eines Vertrags meint.
 */
export function traegerModulesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.traegerModules,
    title: "Welche moto-Module hat mein Träger?",
    question: "Welche moto-Module hat mein Träger?",
    summary:
      "Unter `Einstellungen` siehst du, welche moto-Module dein Träger gebucht hat.",
    group: "konfiguration",
    audience: "traeger",
    icon: "PuzzlePiece",
    steps: [
      "Wähle unten in der Navigation `Einstellungen`.",
      "Wähle `moto-Module`.",
      "Bei jedem moto-Modul steht `Gebucht` oder `Nicht gebucht`.",
    ],
    result: "Du weißt, welche Bereiche dein Träger-Büro nutzen kann.",
    notes: [
      "Schulen, Schließtage, Anmeldephasen, Dokumente, Personal und die Einstellungen hat jeder Träger.",
      "`Träger-Übersicht` öffnet Dashboard, Belegung, Auslastung, Ankunft und Abholung, Standortvergleich, Berichte und `Länger als gebucht`.",
      "`Ferienbetreuung` öffnet die Ferienzeiträume mit ihren Anmeldungen. Ohne das moto-Modul können Eltern sich nicht mehr für Ferien anmelden. Der Link zur Anmeldung ist dann geschlossen.",
      "`Verträge und Dokumente` öffnet die Betreuungsverträge.",
      "`Elternbeiträge und Abrechnung` öffnet Abrechnungsläufe, Familien und Zahlung, Preise und Ermäßigungen, die Dokumentarten und die Vorgaben für Rechnungen.",
      "Ein moto-Modul gilt für deinen Träger, sobald eine deiner Schulen es gebucht hat. Was gebucht ist, steht im Vertrag mit moto.",
      "Ohne `Elternbeiträge und Abrechnung` fehlen auf einem Vertrag die Karten `Empfänger und Zahlung` und `SEPA-Lastschriftmandat`.",
    ],
    differences: [
      "Ein Menüpunkt hat ein Schloss? Dann gehört er zu einem moto-Modul, das keine deiner Schulen gebucht hat. Das Schloss sieht nur, wer das Träger-Büro leitet. Alle anderen sehen den Menüpunkt nicht.",
      "Eine Seite sagt `ist nicht gebucht`? Dann gehört sie zu einem moto-Modul, das keine deiner Schulen gebucht hat. Die Seite nennt das moto-Modul.",
      "Das `Dashboard` fehlt? Ohne `Träger-Übersicht` startet das Träger-Portal mit `Schulen`.",
      "Unter `Abrechnungsvorgaben` stehen nur die Bankverbindungen? Die übrigen Vorgaben gehören zu `Elternbeiträge und Abrechnung`.",
    ],
    troubleshootingDetails: [
      "Du brauchst ein weiteres moto-Modul, oder eines ist falsch eingetragen? Wende dich an das moto-Team. Nur das moto-Team kann moto-Module buchen oder abbestellen.",
      "Ein moto-Modul wurde abbestellt? Die Daten bleiben gespeichert, bis ihre Löschfrist abläuft. Verschickte Verträge können Eltern weiter unterschreiben. Brauchst du die Daten noch, frage das moto-Team nach einem Export.",
    ],
    related: [HELP_TOPICS.traegerSettings, HELP_TOPICS.traegerLogin],
  };
}
