import type { HelpTopic } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

/** Problemartikel: fehlende Bereiche haengen an den Schaltern der OGS. */
export function teacherFeatureMissingTopic(): HelpTopic {
  return {
    id: HELP_TOPICS.teacherFeatureMissing,
    title: "Ein Bereich fehlt mir",
    question: "Warum fehlt mir ein Bereich in moto schule?",
    summary:
      "Jede OGS schaltet selbst frei, was Lehrkräfte sehen und tun dürfen.",
    group: "probleme",
    audience: "teacher",
    icon: "EyeSlash",
    steps: [
      "Prüfe, welcher Bereich genau fehlt.",
      "Schreibe der OGS, wenn du ihn brauchst.",
    ],
    result: "Die OGS kann den Bereich für deine Schule einschalten.",
    notes: [
      "moto blendet einen Bereich aus, statt ihn zu sperren. Ein fehlender Eintrag ist kein Fehler.",
      "moto schule zeigt bewusst wenig: deine Klassen und deine eigenen Aufsichten.",
    ],
    differences: [
      "Fehlt `Nachrichten`? Dann nutzt deine OGS den Team-Chat nicht.",
      "Fehlt `Ankunft heute ändern`? Dann hat die OGS das Eintragen nicht freigegeben.",
      "Fehlt `Hinweis für die OGS`? Auch das muss die OGS erst freigeben.",
      "Abhol- und Notfallkontakte gibt es nur in einer laufenden Aufsicht.",
    ],
    troubleshootingDetails: [
      "Du brauchst Stammdaten oder Kontaktdaten? Die zeigt moto schule nicht. Frage im OGS-Team nach.",
    ],
    related: [
      HELP_TOPICS.teacherMessages,
      HELP_TOPICS.teacherArrivalChange,
      HELP_TOPICS.teacherNoClasses,
    ],
  };
}
