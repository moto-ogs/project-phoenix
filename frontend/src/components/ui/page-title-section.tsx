"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

/** The part of a page its address selects, for the tab title (#7109). */
export interface PageTitleSection {
  readonly pathname: string;
  readonly label: string;
}

interface PageTitleSectionTarget {
  /** The path the title currently names. */
  readonly pathname: string;
  readonly onSection: (section: PageTitleSection | null) => void;
}

const PageTitleSectionContext = createContext<PageTitleSectionTarget | null>(
  null,
);

/** Receives the section a page reports; `RouteTitle` mounts it. */
export function PageTitleSectionProvider({
  pathname,
  onSection,
  children,
}: PageTitleSectionTarget & { readonly children: ReactNode }) {
  const target = useMemo(
    () => ({ pathname, onSection }),
    [pathname, onSection],
  );
  return (
    <PageTitleSectionContext.Provider value={target}>
      {children}
    </PageTitleSectionContext.Provider>
  );
}

/**
 * Puts the part of a page the address selects in front of the page title,
 * for example the tab of a record (`?tab=…`): „Kindakte: Verlauf
 * – moto“. Pass null when the address selects nothing. Without a provider
 * (tests, stories) nothing happens; the hook reads no router state itself.
 */
export function usePageTitleSection(label: string | null | undefined): void {
  const target = useContext(PageTitleSectionContext);
  const pathname = target?.pathname;
  const onSection = target?.onSection;
  const report = useCallback(
    (next: string | null) => {
      if (!onSection || pathname === undefined) return;
      onSection(next ? { pathname, label: next } : null);
    },
    [onSection, pathname],
  );

  useEffect(() => {
    report(label?.trim() ? label : null);
    return () => report(null);
  }, [label, report]);
}
