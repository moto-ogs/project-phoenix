"use client";

// `.js`: Die Layouttests rendern ButtonLink in Node ohne Bundler (#6570).
import NextLink from "next/link.js";
import { forwardRef, useContext, type ComponentProps } from "react";
import { PortalScrollContext } from "./navigation-progress-store";
import { useNavigationLinkProgress } from "./use-navigation-link-progress";
import { isInternalPath, portalManagesScroll } from "./navigation-url";

export type NavigationLinkProps = Omit<
  ComponentProps<typeof NextLink>,
  "href" | "prefetch"
> & {
  readonly href: string;
  /** `false` schaltet das Vorladen der Hülle ab. */
  readonly prefetch?: false;
  /** Verlässt das App-Dokument, etwa für die öffentliche Hilfe. */
  readonly nativeAnchor?: boolean;
};

/**
 * Der eine Link des Kits für interne Ziele (#6570): Seitenleiste, untere
 * Leiste, Kopfzeile, Seiteninhalt und `ButtonLink` nutzen ihn.
 *
 * Next lädt die neutrale Hülle, nicht den URL-spezifischen Inhalt (#8083).
 * Die Daten liefert der autorisierte Seitenseed oder der scoped SWR-Cache
 * (#8079). Fremde Ziele, neue Tabs und `prefetch={false}` laden nichts vor.
 */
const NavigationLink = forwardRef<HTMLAnchorElement, NavigationLinkProps>(
  function NavigationLink(
    {
      href,
      target,
      prefetch,
      nativeAnchor,
      scroll,
      onClick,
      onNavigate,
      children,
      ...anchorProps
    },
    ref,
  ) {
    const progress = useNavigationLinkProgress(href, onClick, onNavigate);
    const portalScroll = useContext(PortalScrollContext);
    if (nativeAnchor) {
      return (
        <a
          {...anchorProps}
          ref={ref}
          href={href}
          target={target}
          onClick={onClick}
        >
          {children}
        </a>
      );
    }

    const canPrefetch =
      prefetch !== false &&
      (!target || target === "_self") &&
      isInternalPath(href);

    return (
      <NextLink
        {...anchorProps}
        ref={ref}
        href={href}
        target={target}
        scroll={
          scroll ??
          (portalScroll && portalManagesScroll(href) ? false : undefined)
        }
        prefetch={canPrefetch ? "auto" : false}
        onClick={progress.onClick}
        onNavigate={progress.onNavigate}
      >
        {children}
      </NextLink>
    );
  },
);

export default NavigationLink;
