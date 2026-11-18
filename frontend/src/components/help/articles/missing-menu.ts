import type { HelpTopic, HelpPresenceMode, HelpGroupMode } from "../help-types";
import { HELP_TOPICS } from "~/lib/help-topics";
import { missingMenuDifferences } from "../help-article-shared";

export function missingMenuTopic(
  presenceMode: HelpPresenceMode,
  groupMode: HelpGroupMode,
  nfcEnabled: boolean | null,
): HelpTopic {
  return {
    id: HELP_TOPICS.missingMenu,
    title: "Ein Menüpunkt fehlt",
    question: "Was kann ich tun, wenn ein Menüpunkt fehlt?",
    summary:
      "Ein Bereich kann wegen deiner Rolle, einer Einstellung oder der gewählten Arbeitsweise der OGS fehlen.",
    group: "probleme",
    audience: "caregiver",
    icon: "EyeSlash",
    steps: [
      "Öffne auf dem Handy unten `Mehr`. Dort stehen alle Bereiche.",
      "Klappe am Computer in der Seitenleiste die passende Gruppe auf.",
      "Lade die Seite neu.",
      "Melde dich ab und wieder an, wenn deine Rolle oder Rechte gerade geändert wurden. `Abmelden` steht am Computer im Menü oben rechts, auf dem Handy unter `Mehr`.",
      "Frage deine Leitung, ob die Funktion für deine OGS eingeschaltet ist.",
      "Frag deine Leitung, ob sie deine Rolle und Rechte prüft.",
    ],
    result:
      "Deine Leitung prüft die Einstellungen und deinen Zugang. Danach kann sie die Ursache klären.",
    differences: missingMenuDifferences(presenceMode, groupMode, nfcEnabled),
    related: [HELP_TOPICS.missingChildOrGroup, HELP_TOPICS.loginProblem],
  };
}
