"use client";

// `.js`: Die Layouttests rendern ButtonLink in Node ohne Bundler (#6570).
import NextLink from "next/link.js";
import { forwardRef, type ComponentProps } from "react";
import { useNavigationLinkProgress } from "./use-navigation-link-progress";
import { useLinkIntentPrefetch } from "./use-link-intent-prefetch";

export type NavigationLinkProps = Omit<
  ComponentProps<typeof NextLink>,
  "href" | "prefetch"
> & {
  readonly href: string;
  /** `false` schaltet auch das Vorladen bei Absicht ab. */
  readonly prefetch?: false;
};

/**
 * Der eine Link des Kits für interne Ziele (#6570): Seitenleiste, untere
 * Leiste, Kopfzeile, Seiteninhalt und `ButtonLink` nutzen ihn.
 *
 * Fortschritt: Der Link meldet seinen Wechsel beim Klick, also vor dem
 * Router-Dispatch, und verwirft die Meldung sofort, wenn ein eigener Handler
 * oder `onNavigate` den Klick abbricht.
 *
 * Vorladen erst bei Absicht (#2976, #4987): Ein sichtbarer Link lädt nichts.
 * Bleibt der Zeiger kurz auf ihm oder bekommt er den Fokus, schaltet er
 * `prefetch` auf `true`. Eine Berührung beim Scrollen lädt nichts. Next lädt dann die volle
 * Zielseite samt ihrer JS-Module, nicht nur bis zur Ladehülle; der Klick
 * danach wartet nicht mehr auf den Code der Seite. Der Router hält diese
 * Daten nur im Speicher des Tabs; Logout und Schulwechsel laden die Seite
 * komplett neu und verwerfen ihn damit.
 *
 * In der Entwicklung lädt `next/link` selbst nichts vor, Links in einen neuen
 * Tab und fremde Ziele lässt diese Komponente aus.
 */
const NavigationLink = forwardRef<HTMLAnchorElement, NavigationLinkProps>(
  function NavigationLink(
    {
      href,
      target,
      prefetch: allowPrefetch,
      onClick,
      onNavigate,
      onPointerEnter,
      onPointerLeave,
      onFocus,
      onBlur,
      ...anchorProps
    },
    ref,
  ) {
    const progress = useNavigationLinkProgress(href, onClick, onNavigate);
    const intent = useLinkIntentPrefetch({
      href,
      target,
      prefetch: allowPrefetch,
      onPointerEnter,
      onPointerLeave,
      onFocus,
      onBlur,
    });

    // Jeder Handler steht hier genau einmal; `anchorProps` enthält keinen von
    // ihnen. Die Reihenfolge der Props entscheidet deshalb nichts.
    return (
      <NextLink
        {...anchorProps}
        ref={ref}
        href={href}
        target={target}
        prefetch={intent.prefetch}
        onClick={progress.onClick}
        onNavigate={progress.onNavigate}
        onPointerEnter={intent.onPointerEnter}
        onPointerLeave={intent.onPointerLeave}
        onFocus={intent.onFocus}
        onBlur={intent.onBlur}
      />
    );
  },
);

export default NavigationLink;
