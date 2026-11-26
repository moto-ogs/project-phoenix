import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * Gebuchte Module (#4894). Der Bereich `Module` unter Einstellungen zeigt sie
 * lesend (#4892); Navigation, Startseite und Seiten folgen dem Modul-Register
 * (lib/module-register.ts). Das Schloss sieht nur, wer die Schule leitet.
 */
export function modulesTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.leadModules,
    title: "Welche Module hat meine Schule?",
    question: "Welche Module hat meine Schule?",
    summary:
      "Unter `Einstellungen` siehst du, welche Zusatzmodule deine OGS gebucht hat.",
    group: "konfiguration",
    audience: "lead",
    icon: "PuzzlePiece",
    steps: [
      "Öffne unten in der Seitenleiste `Einstellungen`.",
      "Wähle den Bereich `Module`.",
      "Klappe `Gebuchte Module` auf. Dort steht jedes Zusatzmodul mit einem Satz, was dazugehört.",
      "Ein eingeschalteter Schalter heißt: Deine OGS hat das Modul gebucht.",
    ],
    result: "Du weißt, welche Zusatzmodule deine OGS nutzen kann.",
    notes: [
      "moto Basis hat jede OGS. Dazu gehören zum Beispiel Kinder, Gruppen, Räume, Anwesenheit und Kalender.",
      "Die Schalter sind nur zur Information. Welche Module deine OGS hat, steht im Vertrag mit moto.",
      "Ohne `Eltern-App` gibt es kein Elternportal. Eltern können sich dort nicht anmelden. moto schickt ihnen keine E-Mails und Mitteilungen mehr, zum Beispiel zu Terminen.",
      "Ohne `Unterricht am Vormittag` gibt es kein moto schule. Lehrkräfte können sich dort nicht anmelden.",
      "Ohne `Online-Anmeldung` verschickt moto keine E-Mails zu Anmeldungen.",
      "Ohne `NFC-Anwesenheit` lässt sich kein Tablet mit der Geräte-PIN anmelden. Das Tablet zeigt dann einen Hinweis.",
      "Ohne `Zeiterfassung` kann dein Team am Tablet nicht stempeln. Anwesenheit mit Armband geht weiter.",
      "`Träger-Übersicht`, `Ferienbetreuung`, `Verträge und Dokumente` und `Elternbeiträge und Abrechnung` nutzt dein Träger im Träger-Portal. In deiner OGS ändert sich dadurch kein Menüpunkt.",
    ],
    differences: [
      "Ein Menüpunkt hat ein Schloss? Dann gehört er zu einem Modul, das deine OGS nicht gebucht hat. Das Schloss siehst nur du als Leitung. Dein Team sieht den Menüpunkt nicht.",
      "Eine Seite sagt `ist nicht gebucht`? Dann gehört sie zu einem Modul, das deine OGS nicht gebucht hat. Die Seite nennt das Modul.",
      "Ein Bereich fehlt trotz gebuchtem Modul? Dann ist er unter `Einstellungen` ausgeschaltet, zum Beispiel der Speiseplan.",
    ],
    troubleshootingDetails: [
      "Du brauchst ein weiteres Modul, oder ein Modul ist falsch eingetragen? Wende dich an das moto-Team. Nur das moto-Team kann Module buchen oder abbestellen.",
      "Ein Modul wurde abbestellt? Die Daten bleiben gespeichert, bis ihre Löschfrist abläuft. Brauchst du die Daten noch, frage das moto-Team nach einem Export.",
    ],
    related: [
      HELP_TOPICS.settingsGuide,
      HELP_TOPICS.leadMissingMenu,
      HELP_TOPICS.settings,
    ],
  };
}
