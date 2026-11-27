import { helpConcept } from "~/lib/concepts/help";
import {
  HELP_SEARCH_INDEX_PATH,
  type HelpSearchIndexEntry,
} from "~/lib/help-search-index";
import { isHelpTopicAvailable } from "~/lib/help-topic-availability";
import { buildHelpHref, type HelpUrlContext } from "~/lib/help-topics";

import { searchEntry, type SearchEntry } from "./school-search-catalog";

/**
 * Lädt den kleinen Hilfe-Index (Titel, Frage, Zusammenfassung) einmal je
 * Seitenaufruf. Die Artikeltexte selbst lädt die Suche nie: sie wären
 * Hunderte Kilobyte für jede Seite der App.
 */
let indexLoad: Promise<readonly HelpSearchIndexEntry[]> | null = null;

export function loadHelpIndex(): Promise<readonly HelpSearchIndexEntry[]> {
  indexLoad ??= fetch(HELP_SEARCH_INDEX_PATH).then(async (response) => {
    if (!response.ok) {
      throw new Error(`help search index failed (${response.status})`);
    }
    return (await response.json()) as HelpSearchIndexEntry[];
  });
  // Ein Fehlschlag darf beim nächsten Öffnen neu laden.
  indexLoad.catch(() => {
    indexLoad = null;
  });
  return indexLoad;
}

/** Die Themen, die die Hilfe dieser Rolle mit diesen Einstellungen zeigt. */
export function helpEntriesOf(
  index: readonly HelpSearchIndexEntry[],
  context: HelpUrlContext,
): readonly SearchEntry[] {
  return index
    .filter((topic) =>
      isHelpTopicAvailable(
        topic.id,
        context.role,
        context.presenceMode,
        context.groupMode,
        context.nfcEnabled,
      ),
    )
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
        topic.summary,
      ),
    );
}
