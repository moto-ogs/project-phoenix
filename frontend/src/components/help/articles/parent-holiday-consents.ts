import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/**
 * `/ferienanmeldungen` (#8038, ADR 0321): die freiwilligen Einwilligungen
 * einer Ferienanmeldung sehen, widerrufen und wieder geben. Die OGS, die
 * das Kind in den Ferien betreut, sieht den Stand sofort.
 */
export function parentHolidayConsentsTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentHolidayConsents,
    title: "Einwilligungen der Ferienanmeldung ändern",
    question: "Wie widerrufe ich eine Einwilligung aus der Ferienanmeldung?",
    summary:
      "Unter `Ferienanmeldungen` siehst du jede Einwilligung. Du widerrufst sie dort oder gibst sie wieder.",
    group: "anmeldung",
    audience: "parent",
    icon: "ShieldCheck",
    requirements: [
      "Du hast ein Elternkonto. Die Ferienanmeldung steht unter `Ferienanmeldungen`.",
      "Der Träger hat im Formular eine Einwilligung abgefragt, zum Beispiel `Fotos in der Ferienbetreuung`.",
    ],
    steps: [
      "Öffne in der Eltern-App `Ferienanmeldungen`.",
      "Unter jeder Anmeldung steht `Einwilligungen`. Dort steht jede Einwilligung mit dem Text, dem du zugestimmt hast.",
      "Rechts steht `Erteilt`, `Nicht erteilt` oder `Widerrufen`.",
      "Wähle bei der Einwilligung `Widerrufen`.",
      "moto fragt nach. Wähle noch einmal `Widerrufen`.",
    ],
    result:
      "Die Einwilligung gilt ab jetzt nicht mehr. Das Team, das dein Kind in den Ferien betreut, sieht das sofort. Der Träger sieht es auch.",
    notes: [
      "Die Einwilligungen sind freiwillig. Die Anmeldung gilt auch ohne sie.",
      "Ohne Elternkonto widerrufst du beim Träger, zum Beispiel per Mail. Er trägt den Widerruf in moto ein.",
      "Hast du dich anders entschieden? Wähle `Einwilligung geben`. Das geht auch bei einer Einwilligung, die du bei der Anmeldung nicht gegeben hast.",
      "Ein Widerruf gilt ab jetzt. Was vorher geschehen ist, bleibt erlaubt.",
      "Die Foto-Einwilligung bei der Schule deines Kindes ist eine eigene Einwilligung. Du änderst sie beim Kind unter `Angaben`.",
    ],
    troubleshootingDetails: [
      "Du siehst keine `Einwilligungen`? Dann hat der Träger im Formular keine abgefragt.",
      "Deine Anmeldung fehlt unter `Ferienanmeldungen`? Dann ist sie nicht mit deinem Konto verbunden. Wende dich an den Träger. Er trägt deinen Widerruf ein.",
      "moto meldet, die Anmeldung gebe es nicht mehr? Nach den Ferien löscht der Träger die Anmeldung. Dann gibt es auch die Einwilligungen nicht mehr.",
    ],
    related: [HELP_TOPICS.parentHolidayRegistration],
  };
}
