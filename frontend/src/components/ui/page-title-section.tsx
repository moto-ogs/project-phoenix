"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from "react";

/** The part of a page its address selects, for the tab title (#7109). */
export interface PageTitleSection {
  readonly pathname: string;
  readonly label: string;
}

type SetPageTitleSection = (section: PageTitleSection | null) => void;

const PageTitleSectionContext = createContext<SetPageTitleSection | null>(null);

/** Receives the section a page reports; `RouteTitle` mounts it. */
export function PageTitleSectionProvider({
  onSection,
  children,
}: {
  readonly onSection: SetPageTitleSection;
  readonly children: ReactNode;
}) {
  return (
    <PageTitleSectionContext.Provider value={onSection}>
      {children}
    </PageTitleSectionContext.Provider>
  );
}

/**
 * Puts the part of a page the address selects in front of the page title,
 * for example the tab of a record (`?tab=…`): „Verlauf – Kindakte – OGS –
 * moto“. Pass null when the address selects nothing. Without a provider
 * (tests, stories) nothing happens.
 */
export function usePageTitleSection(label: string | null | undefined): void {
  const onSection = useContext(PageTitleSectionContext);
  const pathname = usePathname() ?? "/";
  const report = useCallback(
    (next: string | null) => {
      onSection?.(next ? { pathname, label: next } : null);
    },
    [pathname, onSection],
  );

  useEffect(() => {
    report(label?.trim() ? label : null);
    return () => report(null);
  }, [label, report]);
}
