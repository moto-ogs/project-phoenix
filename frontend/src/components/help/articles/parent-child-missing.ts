import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Problemartikel: kein Kind sichtbar. Der Zugang haengt an der Freigabe. */
export function parentChildMissingTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.parentChildMissing,
    title: "Mein Kind wird nicht angezeigt",
    question: "Warum sehe ich mein Kind nicht?",
    summary: "Die OGS muss deinen Zugang zum Kind erst freigeben.",
    group: "probleme",
    audience: "parent",
    icon: "Search",
    steps: [
      "Prüfe, ob du mit der richtigen E-Mail-Adresse angemeldet bist.",
      "Hast du mehrere Kinder, prüfe oben die Auswahl.",
      "Schreibe sonst der OGS und nenne Name und Klasse des Kindes.",
    ],
    result: "Sobald die OGS deinen Zugang freigibt, erscheint das Kind.",
    notes: [
      "Ein Kind kommt nicht automatisch zu deinem Konto. Die OGS verbindet beides.",
      "Eine abgegebene Anmeldung allein genügt nicht. Das Kind erscheint erst nach der Übernahme.",
    ],
    differences: [
      "moto sagt, mit deinem Konto sei noch kein Kind verknüpft? Dann fehlt die Freigabe.",
    ],
    troubleshootingDetails: [
      "Du hast zwei E-Mail-Adressen? Melde dich mit der an, an die die Einladung ging.",
    ],
    related: [
      HELP_TOPICS.parentAccount,
      HELP_TOPICS.parentChildOverview,
      HELP_TOPICS.parentMessages,
    ],
  };
}
