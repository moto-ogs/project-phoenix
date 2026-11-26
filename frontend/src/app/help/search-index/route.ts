import { getHelpTopics } from "~/components/help/help-content";
import type { HelpSearchIndexEntry } from "~/lib/help-search-index";

// Der kleine Index der Hilfe für die Suche der App (#6954): Titel, Frage und
// Zusammenfassung jedes Artikels, ohne die Schritte. Er entsteht beim Build;
// die Artikeltexte bleiben so aus dem Client-JavaScript jeder Seite. Welche
// Artikel eine Rolle bei ihren Einstellungen sieht, filtert die Suche mit
// `isHelpTopicAvailable`, das ohne Artikeltexte auskommt.
export function GET() {
  // Titel und Frage hängen nicht von der Einstellungsvariante ab; „unknown“
  // blendet keinen Artikel aus.
  const entries: HelpSearchIndexEntry[] = getHelpTopics(
    "unknown",
    "unknown",
    null,
  ).map((topic) => ({
    id: topic.id,
    title: topic.title,
    question: topic.question,
    summary: topic.summary,
  }));
  return Response.json(entries);
}
