"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  PageTitleSectionProvider,
  type PageTitleSection,
} from "~/components/ui/page-title-section";
import {
  pageTitleText,
  resolvePageTitle,
  type LocalizedPageTitleMessages,
  type PageTitleSurface,
} from "~/lib/page-titles";

/**
 * Renders the `<title>` of the current page (#7109). Mounted once in the root
 * layout; React 19 hoists the element into `<head>`, also in the server
 * render, and swaps its text on every client navigation, before Next.js'
 * route announcer reads `document.title`.
 *
 * Pages with a Metadata API title (help, payroll office download) get no
 * second element here.
 */
export function RouteTitle({
  hostSurface,
  messages,
  children,
}: {
  readonly hostSurface: PageTitleSurface;
  readonly messages: LocalizedPageTitleMessages;
  readonly children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const [section, setSection] = useState<PageTitleSection | null>(null);
  const resolved = useMemo(
    () => resolvePageTitle(hostSurface, pathname),
    [hostSurface, pathname],
  );
  // A section belongs to the page that reported it; after a navigation the
  // old one no longer counts, even before the old page's cleanup ran.
  const activeSection = section?.pathname === pathname ? section.label : null;
  const title = pageTitleText(resolved, messages, activeSection);

  return (
    <PageTitleSectionProvider pathname={pathname} onSection={setSection}>
      {title !== null && <title>{title}</title>}
      {children}
    </PageTitleSectionProvider>
  );
}
