"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { REDUCED_MOTION_QUERY } from "~/lib/device-context";
import {
  useTenantRoutingModeSafe,
  useTenantSlugSafe,
} from "~/lib/tenant-context";
import { normalizeTenantPathname } from "~/lib/tenant-path";
import {
  currentEntry,
  previousEntry,
  setEntryTab,
  setPendingTab,
  stackVersion,
  subscribeStack,
  takePendingTab,
} from "./history-stack";
import {
  isTabRoot,
  MORE_TAB,
  tabForEntry,
  visibleTabFor,
} from "./tab-registry";

const MEMORY_KEY = "moto:tab-memory:v1";

export interface PillTabItem {
  readonly href: string;
  readonly activePaths?: readonly string[];
}

function readMemory(): Record<string, string> {
  try {
    return JSON.parse(
      window.sessionStorage.getItem(MEMORY_KEY) ?? "{}",
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function remember(tab: string, url: string) {
  try {
    const memory = readMemory();
    if (memory[tab] === url) return;
    memory[tab] = url;
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Ohne Speicher führt jeder Reiter auf seine Wurzel.
  }
}

function isModifiedClick(event: MouseEvent<HTMLElement>) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * Reiter-Modell der Pill (#8070):
 *   - Der aktive Reiter kommt aus dem Register (`tab-registry.ts`) und dem
 *     Verlaufseintrag: ein Detail gehört zu dem Reiter, aus dem es geöffnet
 *     wurde, auch ohne `?from=`.
 *   - Jeder Reiter merkt sich seine zuletzt besuchte Adresse in
 *     `sessionStorage`; ein Reiterwechsel führt dorthin zurück.
 *   - Erneuter Tipp auf den aktiven Reiter: tiefer → zur Wurzel, auf der
 *     Wurzel → sanft nach oben.
 *
 * `activeHref` ist `null`, bis der Eintrag bekannt ist (Server-Render und
 * erster Client-Render); dann gilt die alte Markierung des Aufrufers.
 */
export function usePillTabs(items: readonly PillTabItem[]) {
  const rawPathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const from = searchParams?.get("from") ?? null;
  const tenantSlug = useTenantSlugSafe();
  const routingMode = useTenantRoutingModeSafe();
  const pathname = normalizeTenantPathname(
    rawPathname,
    tenantSlug,
    routingMode,
  );
  const version = useSyncExternalStore(subscribeStack, stackVersion, () => 0);
  const [entryTab, setEntryTabState] = useState<string | null>(null);
  const [memory, setMemory] = useState<Record<string, string>>({});
  const itemsKey = items.map((item) => item.href).join("|");

  useEffect(() => {
    const entry = currentEntry();
    if (!entry) return;
    let tab = entry.tab;
    if (!tab) {
      tab = tabForEntry(
        pathname,
        takePendingTab() ?? previousEntry()?.tab ?? null,
        from,
      );
      setEntryTab(entry.id, tab);
    }
    setEntryTabState(tab);
    remember(
      visibleTabFor(tab, items) ?? MORE_TAB,
      `${pathname}${search ? `?${search}` : ""}`,
    );
    setMemory(readMemory());
    // `items` steckt in `itemsKey`.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, from, version, itemsKey]);

  const activeHref =
    entryTab === null ? null : (visibleTabFor(entryTab, items) ?? MORE_TAB);

  /**
   * Ziel eines Felds: der aktive Reiter führt zu seiner Wurzel, jeder andere
   * zu seiner zuletzt besuchten Adresse. Ein echter Link, also gehen
   * Mittelklick und Vorladen weiter.
   */
  const hrefFor = (tabHref: string, rootHref: string): string =>
    activeHref === tabHref ? rootHref : (memory[tabHref] ?? rootHref);

  /** Klick auf ein Feld: merkt den Reiter, auf der Wurzel nach oben. */
  const onTabClick = useCallback(
    (tabHref: string, rootHref: string, event: MouseEvent<HTMLElement>) => {
      if (isModifiedClick(event)) return;
      setPendingTab(tabHref);
      if (activeHref !== tabHref) return;
      const rootPath = rootHref.split("?")[0] ?? rootHref;
      if (isTabRoot(entryTab ?? tabHref, pathname) || pathname === rootPath) {
        event.preventDefault();
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches
            ? "auto"
            : "smooth",
        });
      }
    },
    [activeHref, entryTab, pathname],
  );

  return { activeHref, hrefFor, onTabClick };
}
