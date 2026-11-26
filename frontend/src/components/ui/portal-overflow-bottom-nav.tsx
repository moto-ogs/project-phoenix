"use client";

import type { ReactNode } from "react";

import { Search } from "lucide-react";
import { useState } from "react";
import {
  PortalBottomNav,
  PortalBottomNavButton,
  PortalBottomNavLink,
  PortalNavSheetLink,
} from "~/components/ui/portal-bottom-nav";
import { PortalMoreBottomNav } from "~/components/ui/portal-more-bottom-nav";
import { SectionLabel } from "~/components/ui/section-label";
import type { MotoConcept } from "~/lib/moto-concepts";

const PADDING = "px-4";
// Das aktive Ziel trägt seinen Namen auf jeder Breite, wie in der Leiste des
// Personal-Portals: es darf schrumpfen, der Name wird notfalls gekürzt.
const LABEL = "truncate text-sm font-semibold whitespace-nowrap";

/**
 * So viele Felder hat die Leiste höchstens. Fünf Icons passen auch auf ein
 * 320 px breites Telefon; ab sechs Zielen stehen die ersten vier in der
 * Leiste und der Rest hinter „Mehr".
 */
const MAX_SLOTS = 5;

export interface PortalOverflowNavItem {
  /** Stabiler Schlüssel für Listen und Tests. */
  readonly key: string;
  /** Die fertige Adresse des Ziels. */
  readonly href: string;
  readonly label: string;
  /**
   * A shorter name for the bar, where the active target's name has about
   * 80 px; the „Mehr“ sheet keeps `label`.
   */
  readonly shortLabel?: string;
  readonly concept: MotoConcept;
  readonly active: boolean;
  /** Ziele außerhalb des Portals (die Hilfe) öffnen in einem neuen Tab. */
  readonly newTab?: boolean;
  /** Eine Linie trennt den Eintrag im „Mehr"-Blatt von den Arbeitsbereichen. */
  readonly separated?: boolean;
  /**
   * Eine Zwischenüberschrift über dem Eintrag im „Mehr"-Blatt, die eine
   * Gruppe von Zielen benennt, etwa die Bereiche des Trägers in den
   * Einstellungen (#8153). In der Leiste selbst steht sie nicht; neben
   * `separated` trägt der Eintrag nur dessen Linie.
   */
  readonly heading?: string;
  /**
   * Ein Zeichen hinter dem Namen im „Mehr"-Blatt, etwa das Schloss eines
   * nicht gebuchten Moduls (#6052). Ein Eintrag mit Zeichen steht nie in
   * der Leiste: dort trägt nur das aktive Ziel seinen Namen, das Zeichen
   * hätte keinen Platz.
   */
  readonly mark?: ReactNode;
}

/**
 * Die mobile Leiste für eine Zielliste, deren Länge nicht feststeht: Passen die
 * Ziele nicht in eine Zeile, stehen die ersten vier in der Leiste und der Rest
 * hinter „Mehr", wie in der Eltern-App. Wie im Schul-Portal trägt nur das aktive
 * Ziel seinen Namen. Das Träger-Portal führt damit seine ganze Navigation, die
 * übrigen Portale ihre Einstellungen (#5750).
 */
export function PortalOverflowBottomNav({
  items,
  navItemAttribute,
  moreConcept,
  moreLabel = "Mehr",
  moreDescription = "Weitere Bereiche",
  activeInMore = false,
  moreIcon,
  search,
}: {
  readonly items: readonly PortalOverflowNavItem[];
  /** Das Attribut, das jeden Eintrag für Touren und Tests benennt. */
  readonly navItemAttribute: `data-${string}`;
  /** Das Bild des Felds „Mehr“ (`moreConcept` aus `~/lib/concepts/more`). */
  readonly moreConcept: MotoConcept;
  readonly moreLabel?: string;
  readonly moreDescription?: string;
  /**
   * Opt-in: ist eine Seite hinter „Mehr“ offen, zeigt das Feld „Mehr“ neben
   * seinen Punkten ihren Namen; der zugängliche Name lautet „Mehr: …“. Sonst
   * stünde auf jeder dieser Seiten nur ein graues „Mehr“ markiert, und ohne
   * die Punkte sähe das Feld nicht mehr nach den übrigen Bereichen aus.
   */
  readonly activeInMore?: boolean;
  /**
   * Opt-in: ein eigenes Symbol für „Mehr“ statt der Punkte, etwa das
   * Listen-Symbol des OGS-Portals. Ohne Angabe bleiben die Punkte.
   */
  readonly moreIcon?: ReactNode;
  /**
   * Opt-in: eine Lupe, die die Suche des Portals öffnet (Träger-Portal,
   * #7648), wie „Suchen“ in der Leiste der OGS-App. Sie steht hinter den
   * Zielen vor „Mehr“ und belegt eines der fünf Felder.
   */
  readonly search?: {
    readonly label: string;
    readonly onOpen: () => void;
  };
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  const slots = search ? MAX_SLOTS - 1 : MAX_SLOTS;
  const marked = items.some((item) => item.mark);
  const crowded = marked || items.length > slots;
  // With a marked target the bar takes the first work areas without a mark;
  // what follows the separating line (the help) never moves up for it. The
  // sheet keeps the order of the list for everything else.
  const separatedAt = items.findIndex((item) => item.separated);
  const barPool = marked
    ? items
        .slice(0, separatedAt === -1 ? items.length : separatedAt)
        .filter((item) => !item.mark)
    : items;
  const barItems = crowded ? barPool.slice(0, slots - 1) : items;
  const moreItems = crowded
    ? items.filter((item) => !barItems.includes(item))
    : [];

  const linkProps = (item: PortalOverflowNavItem) => ({
    href: item.href,
    label: item.label,
    concept: item.concept,
    active: item.active,
    newTab: item.newTab === true,
    [navItemAttribute]: item.key,
  });

  const barLinks = [
    ...barItems.map((item) => (
      <PortalBottomNavLink
        key={item.key}
        {...linkProps(item)}
        shortLabel={item.shortLabel}
        paddingClassName={PADDING}
        labelClassName={LABEL}
        shrinkActive
      />
    )),
    search ? (
      <PortalBottomNavButton
        key="search"
        {...{ [navItemAttribute]: "search" }}
        label={search.label}
        icon={<Search className="h-5 w-5 flex-shrink-0" aria-hidden="true" />}
        active={false}
        onClick={search.onOpen}
        aria-haspopup="dialog"
        paddingClassName={PADDING}
        labelClassName={LABEL}
        shrinkActive
      />
    ) : null,
  ];

  const moreAttribute: Record<`data-${string}`, string> = {
    [navItemAttribute]: "more",
  };

  if (!crowded) {
    return <PortalBottomNav listClassName="gap-0">{barLinks}</PortalBottomNav>;
  }

  const shownInMore = activeInMore
    ? moreItems.find((item) => item.active)
    : undefined;

  return (
    <PortalMoreBottomNav
      listClassName="gap-0"
      open={moreOpen}
      onOpenChange={setMoreOpen}
      moreItemActive={moreItems.some((item) => item.active)}
      more={{
        ...moreAttribute,
        label: shownInMore ? `${moreLabel}: ${shownInMore.label}` : moreLabel,
        shortLabel: shownInMore
          ? (shownInMore.shortLabel ?? shownInMore.label)
          : undefined,
        // The dots stay: beside the open page's name they keep saying that
        // this field opens the other areas.
        ...(moreIcon ? { icon: moreIcon } : { concept: moreConcept }),
        paddingClassName: PADDING,
        labelClassName: LABEL,
        shrinkActive: true,
      }}
      sheetTitle={moreLabel}
      sheetDescription={moreDescription}
      sheet={
        // Auf einem quer gehaltenen Telefon ist die Schublade niedriger als
        // die Liste: die Liste scrollt in ihr, sonst lägen die unteren Ziele
        // außer Reichweite.
        <ul className="min-h-0 space-y-2 overflow-y-auto px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {moreItems.map((item) => (
            <li
              key={item.key}
              className={
                item.separated
                  ? "mt-5 border-t border-gray-200 pt-5"
                  : item.heading
                    ? "pt-4"
                    : undefined
              }
            >
              {item.heading ? (
                <SectionLabel className="mb-2 px-4">
                  {item.heading}
                </SectionLabel>
              ) : null}
              <PortalNavSheetLink
                {...linkProps(item)}
                badge={item.mark}
                onClick={() => setMoreOpen(false)}
              />
            </li>
          ))}
        </ul>
      }
    >
      {barLinks}
    </PortalMoreBottomNav>
  );
}
