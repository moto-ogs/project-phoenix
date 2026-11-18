import type { HelpTopic, HelpPresenceMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";

export function attendanceProblemTopic(
  presenceMode: HelpPresenceMode,
): HelpTopic {
  return {
    id: HELP_TOPICS.attendanceProblem,
    title: "Ich kann ein Kind nicht an- oder abmelden",
    question: "Warum kann ich ein Kind nicht an- oder abmelden?",
    summary: "Prüfe den aktuellen Status, deine Auswahl und deine Rechte.",
    group: "probleme",
    audience: "caregiver",
    icon: "ShieldAlert",
    steps: [
      "Öffne das Kind und prüfe den aktuellen Status.",
      "Lade die Seite neu, damit du den neuesten Stand siehst.",
      "Bei einem abwesenden Kind zeigt moto `Anmelden`.",
      "Bei einem anwesenden Kind zeigt moto `Abmelden`.",
      ...(presenceMode === "detailed"
        ? [
            "Möchtest du den Raum ändern? Prüfe, ob im Zielraum eine Aufsicht läuft.",
            "Öffne bei Bedarf `Aktuelle Aufsicht`.",
            "Prüfe, ob du den aktuellen Raum oder den Zielraum beaufsichtigst.",
          ]
        : []),
      "Versuche die Aktion erneut.",
      "Fehlt die Aktion weiterhin? Frag deine Leitung, ob sie dein Recht zum An- und Abmelden prüft.",
    ],
    result:
      "Stimmen Status und Rechte, ist die Aktion verfügbar. Sonst prüft deine Leitung den Zugang.",
    differences: [
      "Eine Krankmeldung oder Entschuldigung ist nicht dasselbe wie An- oder Abmelden.",
      "Bei einer gleichzeitigen Änderung durch eine andere Person kann moto den neueren Status anzeigen.",
    ],
    related: [HELP_TOPICS.webAttendance, HELP_TOPICS.activeSupervision],
  };
}
