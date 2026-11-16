import {
  getHelpTopics,
  helpTopicMatchesRole,
  type HelpTopic,
} from "~/components/help/help-content";
import { helpConcept } from "~/lib/concepts/help";
import { buildHelpHref, type HelpUrlContext } from "~/lib/help-topics";

import { searchEntry, type SearchEntry } from "./school-search-catalog";

/**
 * Die Hilfethemen als Ziele der Suche. Die Artikeltexte sind groß; diese
 * Datei lädt die Suche deshalb erst, wenn sie offen ist, nie mit der App.
 * Gefunden wird ein Thema über Titel, Frage und Zusammenfassung, nachrangig
 * über seine Schritte und Tipps, wie in der Suche der Hilfe selbst.
 */
function bodyText(topic: HelpTopic): string {
  return [
    topic.summary,
    ...topic.steps,
    ...(topic.instructionGroups?.flatMap((group) => [
      group.title,
      ...group.steps,
    ]) ?? []),
    ...(topic.notes ?? []),
  ].join(" ");
}

/** Die Themen, die die Hilfe dieser Rolle mit diesen Einstellungen zeigt. */
export function helpSearchEntries(
  context: HelpUrlContext,
): readonly SearchEntry[] {
  return getHelpTopics(
    context.presenceMode,
    context.groupMode,
    context.nfcEnabled,
  )
    .filter((topic) => helpTopicMatchesRole(topic, context.role))
    .map((topic) =>
      searchEntry(
        {
          id: `help-${topic.id}`,
          label: topic.title,
          context: topic.question,
          href: buildHelpHref(context, topic.id),
          concept: helpConcept,
          newTab: true,
        },
        bodyText(topic),
      ),
    );
}
