import type { RequestReviewAccess } from "~/lib/change-request-list-api";
import {
  createFeedState,
  takeMergedPage,
  type FeedPage,
  type FeedSource,
  type FeedState,
} from "~/lib/request-feed";
import type { AnyItem } from "~/components/students/requests/case-model";
import type { AggregatedRequestFilters } from "~/components/students/requests/filters";

export const PAGE_SIZE = 25;
export const WITHDRAWAL_PAGE_SIZE = 25;

/**
 * Was eine Liste im Cache hält. `fetchedAt` ist die Nummer des Abrufs der
 * ersten Seite (`startListFetch`): sie kennzeichnet den Stand und entscheidet,
 * welche lokalen Änderungen für ihn noch gelten.
 */
export interface PagedSnapshot<T> {
  readonly fetchedAt: number;
  readonly items: T[];
  readonly hasMore: boolean;
}

/** Eine Seite einer Anfragequelle; der Aggregator meldet dazu die Freigabe. */
type RequestFeedPage = FeedPage<AnyItem> & {
  readonly review_access?: RequestReviewAccess;
};

export interface RequestFeedSource extends FeedSource<AnyItem> {
  readonly fetchPage: (cursor?: string) => Promise<RequestFeedPage>;
}

/**
 * Der Listenzustand im Cache. `feed` hält die Cursors und Puffer der Quellen
 * nach den geladenen Seiten; er wird nie verändert, nur ersetzt.
 */
export interface RequestFeedSnapshot extends PagedSnapshot<AnyItem> {
  readonly pages: number;
  readonly feed: FeedState<AnyItem>;
  readonly reviewAccess?: RequestReviewAccess;
}

/** Was die Quellen abfragen; bestimmt den Cache-Schlüssel der Liste. */
export function requestFeedParts(
  view: "open" | "history",
  filters: AggregatedRequestFilters,
): unknown[] {
  return [
    filters.search,
    filters.studentId ?? null,
    filters.includeAggregated !== false,
    filters.includeEnrollment === true,
    filters.types,
    view === "history" ? filters.statuses : [],
    view === "history" ? (filters.from ?? null) : null,
    view === "history" ? (filters.to ?? null) : null,
  ];
}

/** Erste Seite über alle Quellen; die Freigabe meldet der Aggregator mit. */
export async function loadFirstRequestPage(
  sources: readonly RequestFeedSource[],
  fetchedAt: number,
): Promise<RequestFeedSnapshot> {
  let reviewAccess: RequestReviewAccess | undefined;
  const reporting = sources.map((source) => ({
    key: source.key,
    fetchPage: async (cursor?: string) => {
      const page = await source.fetchPage(cursor);
      reviewAccess ??= page.review_access;
      return page;
    },
  }));
  const feed = createFeedState<AnyItem>(reporting);
  const page = await takeMergedPage(reporting, feed, PAGE_SIZE);
  return {
    fetchedAt,
    items: page.items,
    hasMore: page.hasMore,
    pages: 1,
    feed,
    reviewAccess,
  };
}
