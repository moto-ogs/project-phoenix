import type { HelpTopicId } from "~/lib/help-topics";

/** Adresse des Hilfe-Index für die Suche der App. */
export const HELP_SEARCH_INDEX_PATH = "/help/search-index";

/** Ein Artikel im Hilfe-Index der Suche, ohne Schritte und Tipps. */
export interface HelpSearchIndexEntry {
  readonly id: HelpTopicId;
  readonly title: string;
  readonly question: string;
  readonly summary: string;
}
