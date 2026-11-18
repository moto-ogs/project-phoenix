"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import {
  isOutstandingAnnouncement,
  NewsCard,
  NewsDetailModal,
} from "~/components/parent/news/news-components";
import { useSWRAuth } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";
import { PARENT_RESOURCE_OPTIONS } from "~/lib/hooks/use-parent-resources";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { type ParentAnnouncement, listAnnouncements } from "~/lib/parent-api";
import { ParentPage, ParentPageHeader } from "~/components/parent/parent-page";
import { useCareTermTranslations } from "~/lib/care-facility-term";

const NO_ITEMS: ParentAnnouncement[] = [];

/** Elternbriefe buendeln Mitteilungen, Umfragen und Elterninformationen. */
export function ParentNewsPage() {
  const t = useCareTermTranslations("parentNews");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedBrief = searchParams.get("brief");
  const announcements = useSWRAuth(
    parentKeys.announcements(),
    listAnnouncements,
    PARENT_RESOURCE_OPTIONS,
  );
  const { mutate } = announcements;
  const items = announcements.data ?? NO_ITEMS;
  // A failed load replaces the list with retry (#2518), so it never reads
  // as "nothing to do".
  const { error: loadError, failure } = useSwrResourceLoadError(
    [announcements],
    t("errorObjectList"),
    () => mutate(),
  );
  const loaded = announcements.data !== undefined || !!failure;
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (requestedBrief && items.some((item) => item.id === requestedBrief)) {
      setOpenId(requestedBrief);
    }
  }, [items, requestedBrief]);

  const applyState = useCallback(
    (id: string, patch: Partial<ParentAnnouncement>) => {
      void mutate(
        (current) =>
          current?.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        { revalidate: false },
      );
    },
    [mutate],
  );

  // Ein Lesen oder Bestaetigen wurde abgewiesen, weil die Meldung nicht mehr
  // aktuell ist: neu laden, damit eine zurueckgezogene verschwindet. A failure
  // stays silent: the open letter already shows that it is out of date.
  const refetchOnStale = useCallback(() => {
    void mutate();
  }, [mutate]);

  const openItem = items.find((item) => item.id === openId) ?? null;

  const closeItem = useCallback(() => {
    setOpenId(null);
    if (!requestedBrief) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("brief");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [pathname, requestedBrief, router, searchParams]);
  const outstandingItems = items.filter(isOutstandingAnnouncement);
  const completedItems = items.filter(
    (item) => !isOutstandingAnnouncement(item),
  );

  const renderItems = (group: readonly ParentAnnouncement[]) => (
    <ul className="mt-3 space-y-3">
      {group.map((item) => (
        <li key={item.id}>
          <NewsCard item={item} onOpen={(opened) => setOpenId(opened.id)} />
        </li>
      ))}
    </ul>
  );

  return (
    <ParentPage
      header={
        <div data-parent-tour="news">
          <ParentPageHeader
            kicker={t("kicker")}
            title={t("title")}
            description={t("description")}
          />
        </div>
      }
      loading={
        !loaded && (
          <div data-testid="parent-news-skeleton">
            <ListSkeleton rows={3} />
          </div>
        )
      }
      error={loaded ? loadError : null}
      empty={items.length === 0 ? { title: t("empty") } : null}
    >
      <div className="space-y-8">
        {outstandingItems.length > 0 && (
          <section aria-labelledby="parent-news-outstanding">
            <h2
              id="parent-news-outstanding"
              aria-label={t("openLabel", {
                count: outstandingItems.length,
              })}
              className="flex items-baseline gap-2 px-1 text-lg font-semibold text-gray-950"
            >
              {t("open")}
              <span
                className="text-moto-blue-strong tabular-nums"
                aria-hidden="true"
              >
                {outstandingItems.length}
              </span>
            </h2>
            {renderItems(outstandingItems)}
          </section>
        )}

        {completedItems.length > 0 && (
          <section aria-labelledby="parent-news-completed">
            <h2
              id="parent-news-completed"
              className="px-1 text-lg font-semibold text-gray-950"
            >
              {t("completed")}
            </h2>
            {renderItems(completedItems)}
          </section>
        )}
      </div>

      {openItem && (
        <NewsDetailModal
          item={openItem}
          onClose={closeItem}
          onUpdated={applyState}
          onStale={refetchOnStale}
        />
      )}
    </ParentPage>
  );
}
