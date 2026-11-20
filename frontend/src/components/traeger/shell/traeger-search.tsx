"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import {
  CommandPalette,
  CommandPaletteHighlight,
  type CommandPaletteGroup,
} from "~/components/ui/command-palette";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Loading } from "~/components/ui/loading";
import { schoolsConcept } from "~/lib/concepts/schools";
import {
  useSearchShortcut,
  useSearchShortcutLabel,
} from "~/lib/hooks/use-search-shortcut";
import { foldForSearch } from "~/lib/search-fold";
import type { TraegerSchool } from "~/lib/traeger-api";
import { traegerPath } from "~/lib/traeger-url";
import { useTraegerSchools } from "../use-traeger-schools";
import {
  traegerSearchPagesFor,
  type TraegerSearchPage,
} from "./traeger-nav-items";

/** Name of the dialog, its field and the buttons that open it. */
export const TRAEGER_SEARCH_LABEL = "Suchen";

const SEARCH_TOOLTIP = "Öffnet die Suche nach Seiten und Schulen.";

const TraegerSearchContext = createContext<(() => void) | null>(null);

/** Opens the search of the Träger portal; null outside its shell. */
export function useOpenTraegerSearch(): (() => void) | null {
  return useContext(TraegerSearchContext);
}

/**
 * Owns the one search dialog of the Träger portal (#7648) and its shortcut
 * Cmd/Ctrl+K. The sidebar button and the magnifier of the bottom bar open it
 * through `useOpenTraegerSearch`.
 */
export function TraegerSearchProvider({
  children,
  federalStates,
}: Readonly<{
  children: ReactNode;
  /** Die Bundesländer der Schulen, wie in den Leisten (#4717). */
  federalStates?: readonly string[];
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);
  useSearchShortcut(isOpen, toggle);
  return (
    <TraegerSearchContext.Provider value={open}>
      {children}
      {isOpen ? (
        <TraegerSearchDialog onClose={close} federalStates={federalStates} />
      ) : null}
    </TraegerSearchContext.Provider>
  );
}

/**
 * Der Such-Knopf oben in der Seitenleiste: sieht aus wie ein Suchfeld und
 * nennt das Tastenkürzel, wie „Überall suchen“ in der OGS-App.
 */
export function TraegerSearchButton() {
  const openSearch = useOpenTraegerSearch();
  const shortcut = useSearchShortcutLabel();
  if (!openSearch) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={openSearch}
      aria-keyshortcuts="Control+K Meta+K"
      aria-haspopup="dialog"
      tooltip={SEARCH_TOOLTIP}
      className="w-full justify-start gap-2"
    >
      <Search aria-hidden="true" className="h-4 w-4 text-gray-500" />
      <span className="text-gray-600">{TRAEGER_SEARCH_LABEL}</span>
      {shortcut ? (
        // Das Kürzel nennt `aria-keyshortcuts`; vorgelesen wird nur „Suchen“.
        <span aria-hidden="true" className="ml-auto text-xs text-gray-500">
          {shortcut}
        </span>
      ) : null}
    </Button>
  );
}

// Rank of a hit: a name that starts with the text first, then a word in the
// name, then the text anywhere in the name, last only the second line
// (area of a page, city of a school).
function rankOf(name: string, second: string, needle: string): number | null {
  const folded = foldForSearch(name);
  if (folded.startsWith(needle)) return 0;
  if (folded.includes(` ${needle}`)) return 1;
  if (folded.includes(needle)) return 2;
  if (foldForSearch(second).includes(needle)) return 3;
  return null;
}

/**
 * The entries whose name or second line contains the text, best first;
 * without text all entries in their order.
 */
function matchTraegerSearch<T>(
  entries: readonly T[],
  query: string,
  name: (entry: T) => string,
  second: (entry: T) => string,
): readonly T[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return entries;
  const ranked: { entry: T; rank: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const rank = rankOf(name(entry), second(entry), needle);
    if (rank !== null) ranked.push({ entry, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map(({ entry }) => entry);
}

const pageName = (page: TraegerSearchPage) => page.label;
const pageArea = (page: TraegerSearchPage) => page.area;
const schoolName = (school: TraegerSchool) => school.name;
const schoolCity = (school: TraegerSchool) => school.city;
const NO_SCHOOLS: readonly TraegerSchool[] = [];

/**
 * Die Suche des Träger-Portals (#7648): die Seiten der Seitenleiste und der
 * Einstellungen, die die Sitzung öffnen darf, und die Schulen des Trägers nach
 * Name und Ort. Alles kommt aus dem Browser: die Seiten aus der Navigation,
 * die Schulen aus der geteilten Liste (`useTraegerSchools`); kein eigener
 * Endpunkt.
 */
function TraegerSearchDialog({
  onClose,
  federalStates,
}: Readonly<{
  onClose: () => void;
  federalStates?: readonly string[];
}>) {
  const router = useRouter();
  const { data: session } = useSession();
  const { schools, error: schoolsError } = useTraegerSchools();
  const [query, setQuery] = useState("");
  const term = query.trim();

  const pages = useMemo(
    () => traegerSearchPagesFor(session ?? null, federalStates),
    [session, federalStates],
  );

  const go = useCallback(
    (href: string, newTab?: boolean) => {
      onClose();
      if (newTab) {
        globalThis.open(href, "_blank", "noopener");
        return;
      }
      router.push(href);
    },
    [onClose, router],
  );

  const groups = useMemo<CommandPaletteGroup[]>(
    () => [
      {
        id: "pages",
        title: "Seiten",
        items: matchTraegerSearch(pages, term, pageName, pageArea).map(
          (page) => ({
            id: `page-${page.key}`,
            label: `${page.label}, ${page.area}`,
            title: <CommandPaletteHighlight text={page.label} query={term} />,
            subtitle: <CommandPaletteHighlight text={page.area} query={term} />,
            leading: <ConceptIconTile concept={page.concept} size="xs" />,
            onSelect: () =>
              page.newTab ? go(page.href, true) : go(traegerPath(page.href)),
          }),
        ),
      },
      {
        id: "schools",
        title: "Schulen",
        items: matchTraegerSearch(
          schools ?? NO_SCHOOLS,
          term,
          schoolName,
          schoolCity,
        ).map((school) => ({
          id: `school-${school.id}`,
          label: school.city ? `${school.name}, ${school.city}` : school.name,
          title: <CommandPaletteHighlight text={school.name} query={term} />,
          subtitle: school.city ? (
            <CommandPaletteHighlight text={school.city} query={term} />
          ) : undefined,
          leading: <ConceptIconTile concept={schoolsConcept} size="xs" />,
          onSelect: () =>
            go(
              traegerPath(`/traeger/schulen/${encodeURIComponent(school.id)}`),
            ),
        })),
      },
    ],
    [pages, schools, term, go],
  );
  const hits = groups.reduce((sum, group) => sum + group.items.length, 0);
  const schoolsLoading = schools === null && !schoolsError;

  // Shown only when no entry matches: a school may still be on its way, its
  // list may have failed, or nothing matches.
  let placeholderContent: ReactNode;
  if (schoolsError) {
    placeholderContent = (
      <div className="px-3 pt-3">
        <LoadErrorAlert error={schoolsError} actionLayout="responsive" />
      </div>
    );
  } else if (schoolsLoading) {
    placeholderContent = <Loading />;
  } else {
    placeholderContent = (
      <EmptyState
        variant="compact"
        title="Nichts gefunden"
        description="Suche nach einer Seite, einer Schule oder einem Ort."
      />
    );
  }

  return (
    <CommandPalette
      isOpen
      onClose={onClose}
      label={TRAEGER_SEARCH_LABEL}
      query={query}
      onQueryChange={setQuery}
      placeholder="Seite, Schule oder Ort …"
      groups={groups}
      placeholderContent={placeholderContent}
      footer={
        <span className="text-gray-500">
          {schoolsError && hits > 0
            ? "Die Schulen fehlen gerade. Seiten findest du trotzdem."
            : "Findet Seiten und Schulen."}
        </span>
      }
      status={term ? `${hits} Treffer` : undefined}
    />
  );
}
