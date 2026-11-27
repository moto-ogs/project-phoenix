"use client";

import { MoreHorizontal, Search } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button, ButtonLink } from "./button";
import { FIXED_LAYER_SHIFT } from "./hooks/useFixedLayersFollowViewport";
import { Z_LAYER } from "./overlay-styles";
import { ListRow } from "./list-row";
import { MobilePageHelpTarget } from "./mobile-page-help-target";
import NavigationLink from "./navigation-link";
import { OverlaySheet } from "./overlay-sheet";
import type { OverflowMenuEntry } from "./page-header/types";
import { SectionLabel } from "./section-label";

/**
 * Kopf der App-Oberfläche (#8070, TENANT-PAGE-SPEC.md „App“). Die Kopfkarte
 * bleibt Karte, aber einzeilig: Zurück-Pfeil, Titel, höchstens zwei
 * Symbol-Aktionen und ein „…“, das alles Weitere als Blatt öffnet (Info,
 * Hilfe, Textknöpfe, Kebab). Kennzahlen stehen als Chip-Leiste darunter,
 * Reiter, Suche und Filter in einer klebenden Leiste unter der Karte. Ist die
 * Kopfkarte weggescrollt, schwebt oben eine schmale Kopfkarte.
 *
 * Nur die App rendert diesen Kopf (`DeviceSwitch` in `TenantPage`); der
 * Desktop behält seine Kopfkarte unverändert.
 */

/** In der Statuszeile des App-Kopfs: `TenantPageStats` rendert Chips. */
const AppHeadStatsContext = createContext(false);

export function useInAppHeadStats(): boolean {
  return useContext(AppHeadStatsContext);
}

/** Hooks für View Transitions: Kopf und schmale Kopfkarte bleiben stehen. */
const APP_HEAD_ATTR = { "data-app-page-head": "" } as const;
const APP_HEAD_COMPACT_ATTR = {
  "data-app-page-head-compact": "",
} as const;

/** Schwebende Karte im Stil der Pill: weiß, Rand, weicher Schatten. */
const FLOATING_CARD = "moto-content-surface rounded-2xl border";

/** Abstand der schwebenden Teile vom oberen Rand, unter der Statusleiste. */
const TOP_GAP = "calc(env(safe-area-inset-top) + 0.5rem)";
/** Höhe der schmalen Kopfkarte. */
const COMPACT_HEIGHT_PX = 48;

// Ein Pfeil statt „Zurück zu …“: Das Ziel steht im zugänglichen Namen.
// Der Text des Kit-Links bleibt für Vorleseprogramme, sichtbar ist nur der
// Pfeil (Fläche 44 × 44 px).
const ICON_BACK =
  "shrink-0 [&>a]:m-0 [&>a]:h-11 [&>a]:w-11 [&>a]:overflow-hidden [&>a]:px-2.5 [&>a]:whitespace-nowrap [&>a]:text-transparent [&_svg]:size-5 [&_svg]:text-gray-800";

export interface AppHeadProps {
  readonly title: string;
  readonly headRef: RefObject<HTMLElement | null>;
  /** Der Rückweg (`TenantBackLink`), falls die Seite einen hat. */
  readonly backLink?: ReactNode;
  readonly leading?: ReactNode;
  readonly info?: ReactNode;
  readonly actions?: ReactNode;
  readonly overflowMenu?: readonly OverflowMenuEntry[];
  readonly statusLine?: ReactNode;
  /** Kennzahlen in der Titelzeile statt darunter (`appStatsInline`). */
  readonly statsInline?: boolean;
  /** Kurzstatus im schmalen Kopf beim Rollen (`appCompactStats`). */
  readonly compactStats?: ReactNode;
  /**
   * Symbol-Aktionen im schmalen Kopf (`appCompactActions`): `true` behält
   * die Symbol-Aktionen aus `actions`, ein Element steht an ihrer Stelle.
   */
  readonly compactActions?: true | ReactNode;
  /** Suche und Reiter rollen mit weg (`appToolbarScrollsAway`). */
  readonly toolbarScrollsAway?: boolean;
  /**
   * Reiter, Suche und Filter rollen mit der Kopfkarte weg, statt zu kleben
   * (`appShrinkToTitle`): Beim Rollen bleibt nur die schmale Kopfkarte.
   * Trägt die Leiste eine Suche, zeigt sie eine Lupe, die zurück nach oben
   * ins Suchfeld springt.
   */
  readonly shrinkToTitle?: boolean;
  /** Reiter als Chips. */
  readonly tabs?: ReactNode;
  /** Suche, Filter oder ein Bedienband (`searchSlot`). */
  readonly toolbar?: ReactNode;
  readonly printHideHeader?: boolean;
}

/** Symbol-Aktionen (`data-icon-only`) bleiben im Kopf, höchstens zwei. */
const ICON_ACTIONS_ONLY =
  "contents [&>*:not([data-icon-only])]:hidden [&>[data-icon-only][aria-haspopup]]:hidden [&>[data-icon-only]:has([aria-haspopup])]:hidden [&>[data-icon-only]~[data-icon-only]~[data-icon-only]]:hidden";
/** Im Menü: alles außer den Symbol-Aktionen, untereinander und voll breit. */
const TEXT_ACTIONS_ONLY =
  "flex flex-col gap-2 [&:not(:has(>:not([data-icon-only])))]:hidden [&>*]:w-full [&>[data-icon-only]]:hidden [&>div>button]:w-full";
/** Im Menü: nur das Kebab der Seite, in einer beschrifteten Zeile. */
const KEBAB_ROW =
  "hidden items-center justify-between gap-3 text-sm font-medium text-gray-900 has-[[aria-haspopup]]:flex";
const KEBAB_ONLY =
  "contents [&>*:not([data-icon-only])]:hidden [&>[data-icon-only]:not([aria-haspopup]):not(:has([aria-haspopup]))]:hidden";

export function AppTenantHead({
  title,
  headRef,
  backLink,
  leading,
  info,
  actions,
  overflowMenu,
  statusLine,
  statsInline = false,
  compactStats,
  compactActions,
  toolbarScrollsAway = false,
  shrinkToTitle = false,
  tabs,
  toolbar,
  printHideHeader = false,
}: AppHeadProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const compactHeadStats =
    compactStats ?? (statsInline && statusLine != null ? statusLine : null);
  // In der Detailspalte einer `SplitView` (iPad quer) scrollt die Spalte,
  // nicht die Seite: Kopfkarte und Leiste kleben oben an der Spalte, die
  // schmale Kopfkarte über die ganze Breite entfällt.
  const splitHeadHeight = useSplitDetailHeadHeight(headRef);
  const inSplitDetail = splitHeadHeight !== null;
  const scrolledAway = useScrolledAway(headRef) && !inSplitDetail;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const statsScroll = useScrollsSideways(statsRef);
  const veiled = useStuck(toolbarRef, scrolledAway);
  const hasMenuEntries = (overflowMenu?.length ?? 0) > 0;
  // „…“ nur, wenn das Blatt etwas zeigt: Aktionen, Menüeinträge oder Info.
  const hasMenu = hasMenuEntries || info != null || actions != null;
  const hasToolbar = tabs != null || toolbar != null;
  // Klebt die Leiste, hängt sie unter der schmalen Kopfkarte. Rollt sie mit
  // weg (`toolbarScrollsAway` oder `shrinkToTitle`), ist die schmale
  // Kopfkarte allein eine ganze Karte; in der Detailspalte klebt sie immer.
  const toolbarSticks =
    hasToolbar && (!(toolbarScrollsAway || shrinkToTitle) || inSplitDetail);
  useStickyOffset(toolbarRef, scrolledAway, toolbarSticks);
  // Die Leiste hängt beim Scrollen ohne Fuge an der schmalen Kopfkarte:
  // eine Karte wie oben auf der Seite, kein Spalt, durch den Inhalt blitzt.
  let stickyTop = scrolledAway
    ? `calc(${TOP_GAP} + ${COMPACT_HEIGHT_PX}px)`
    : TOP_GAP;
  if (inSplitDetail) stickyTop = `${splitHeadHeight + 6}px`;

  const menuButton = hasMenu ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Mehr zu dieser Seite"
      // Über einer dicht darunter gerückten Statuszeile: Die 44-px-
      // Trefferfläche bleibt ganz.
      className={`relative ${Z_LAYER.raised}`}
      tooltip="Zeigt Infos, Hilfe und weitere Aktionen dieser Seite."
      onClick={() => setMenuOpen(true)}
    >
      <MoreHorizontal className="size-5" aria-hidden="true" />
    </Button>
  ) : null;

  return (
    <>
      <header
        ref={headRef}
        {...APP_HEAD_ATTR}
        className={cn(
          "moto-content-surface rounded-2xl border px-2 py-0.5",
          // Abgelöst von der schmalen Kopfkarte: kein Rest bleibt stehen.
          scrolledAway &&
            "opacity-0 transition-opacity duration-200 motion-reduce:transition-none",
          // Telefon: Kopf und Leiste bilden eine Karte (spart Fuge und Rand).
          hasToolbar && "phone:rounded-b-none phone:border-b-0",
          // Die Fuge zur Leiste darunter deckt der Seitengrund.
          inSplitDetail &&
            `sticky top-0 ${Z_LAYER.nav} after:absolute after:inset-x-0 after:top-full after:h-2 after:bg-gray-50! after:content-['']`,
          printHideHeader && "print:hidden",
        )}
      >
        {/* `gap-3`: Zwei 32-px-Symbole nebeneinander brauchen 12 px Abstand,
            sonst überdecken sich ihre 44-px-Trefferflächen (gemessen: 36 px
            für das erste). */}
        <div className="flex min-h-11 items-center gap-3">
          {backLink ? <span className={ICON_BACK}>{backLink}</span> : null}
          {leading ? (
            <span
              data-app-head-leading=""
              className="flex shrink-0 items-center pl-1 empty:hidden"
            >
              {leading}
            </span>
          ) : null}
          <h1
            suppressHydrationWarning
            className={cn(
              "tablet:text-xl min-w-0 truncate text-lg leading-7 font-semibold tracking-tight text-gray-900",
              statsInline && statusLine != null ? "shrink-0" : "flex-1",
              // Bündig: ohne Zurück-Pfeil 16 px vom Rand wie die Chips, nach
              // dem Pfeil ohne zusätzlichen Einzug.
              backLink
                ? "-ml-3 [[data-app-head-leading]:not(:empty)+&]:ml-0"
                : "pl-2",
            )}
          >
            {title}
          </h1>
          {statsInline && statusLine != null ? (
            <AppHeadStatsContext.Provider value={true}>
              <div className="flex min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto text-sm text-gray-600">
                {statusLine}
              </div>
            </AppHeadStatsContext.Provider>
          ) : null}
          <div className={ICON_ACTIONS_ONLY}>{actions}</div>
          {menuButton}
        </div>
        {statusLine != null && !statsInline && (
          <AppHeadStatsContext.Provider value={true}>
            {/* Chips beginnen auf jeder Seite 16 px vom Kartenrand, wie der
                Inhalt der Karten darunter; auch mit Zurück-Pfeil. */}
            {/* Scrollt die Zeile seitlich, erreicht man sie auch per Tastatur
                (axe `scrollable-region-focusable`). */}
            <div
              ref={statsRef}
              role={statsScroll ? "region" : undefined}
              aria-label={statsScroll ? "Kennzahlen" : undefined}
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the chip row holds no control; only while it scrolls sideways it joins the tab order as a labelled region (axe scrollable-region-focusable)
              tabIndex={statsScroll ? 0 : undefined}
              className={cn(
                "-mx-2 [scrollbar-width:none] overflow-x-auto pr-2 pb-1.5 text-sm text-gray-600 focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:outline-none",
                "pl-4",
                // Eine Statuszeile, die mit Reitern darunter in 20 % der
                // Höhe passen muss (Kindakte), rückt dicht unter den Titel.
                // Die Zeile scrollt seitlich und schneidet damit oben ab:
                // Ein negativer Rand am Inhalt allein würde ihn kappen.
                "has-[[data-app-head-status-tight]]:-mt-2",
                // Diese Statuszeile scrollt nicht seitlich, sie kürzt selbst:
                // ohne Abschneiden reicht ihre Trefferfläche über den Titel.
                "has-[[data-app-head-status-tight]]:overflow-visible",
              )}
            >
              {statusLine}
            </div>
          </AppHeadStatsContext.Provider>
        )}
      </header>

      {/* Deckend nur hinter der Statusleiste (Safe Area): Wie unten an Pill
          und Aktionsleiste läuft der Inhalt sichtbar unter der schwebenden
          Kopfkarte weiter, statt an einer Kante abgeschnitten zu werden. */}
      <div
        aria-hidden="true"
        data-app-page-backdrop=""
        className={cn(
          `moto-app-backdrop pointer-events-none fixed inset-x-0 top-0 ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT}`,
          !veiled && "hidden",
          printHideHeader && "print:hidden",
        )}
        style={{ height: "env(safe-area-inset-top, 0px)" }}
      />

      {hasToolbar && (
        <div
          ref={toolbarRef}
          data-app-page-toolbar=""
          className={cn(
            `${toolbarSticks ? "sticky" : "relative"} ${Z_LAYER.nav} mt-1.5 -mb-1 space-y-1.5 px-1.5 py-1`,
            FLOATING_CARD,
            // Telefon: unten an der Kopfkarte, solange sie steht; klebt die
            // Leiste allein, ist sie wieder eine ganze Karte.
            "phone:mt-0 phone:mb-0",
            // Seitlich 16 px: Suchfeld, Reiter und Segmente beginnen bündig
            // mit dem Titel und den Kennzahlen darüber. Unten 8 px wie
            // zwischen Kopfzeile und Leiste.
            "phone:rounded-t-none phone:border-t-0 phone:px-4 phone:pt-0 phone:pb-2",
            printHideHeader && "print:hidden",
          )}
          style={toolbarSticks ? { top: stickyTop } : undefined}
        >
          {tabs}
          {toolbar}
        </div>
      )}

      {/* Schmale Kopfkarte: steht oben, sobald die Kopfkarte weggescrollt
          ist. Für Vorleseprogramme doppelt sie nur den Titel, darum
          versteckt; die Bedienelemente sind erreichbar. */}
      <div
        {...APP_HEAD_COMPACT_ATTR}
        aria-hidden={!scrolledAway || undefined}
        inert={!scrolledAway}
        className={cn(
          `tablet:inset-x-8 fixed inset-x-4 ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT} flex items-center gap-1 px-1.5 transition-[opacity,transform] duration-200 motion-reduce:transition-none`,
          FLOATING_CARD,
          // Mit Leiste bilden schmale Kopfkarte und Leiste eine Karte.
          toolbarSticks && "phone:rounded-b-none phone:border-b-0",
          scrolledAway
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0",
          printHideHeader && "print:hidden",
        )}
        style={{ top: TOP_GAP, height: COMPACT_HEIGHT_PX }}
      >
        {backLink ? <span className={ICON_BACK}>{backLink}</span> : null}
        <p
          className={cn(
            "tablet:text-lg min-w-0 flex-1 truncate text-base font-semibold text-gray-900",
            !backLink && "pl-2.5",
          )}
        >
          {title}
        </p>
        {/* Der wichtigste Status bleibt auch im schmalen Kopf stehen
            (#8070): Kennzahlen der Titelzeile („16 da · 0 krank“) oder ein
            eigener Kurzstatus der Seite. Für Vorleseprogramme steht er
            schon im Kopf. */}
        {compactHeadStats != null ? (
          <AppHeadStatsContext.Provider value={true}>
            <div
              aria-hidden="true"
              className="flex min-w-0 shrink-0 text-sm text-gray-600"
            >
              {compactHeadStats}
            </div>
          </AppHeadStatsContext.Provider>
        ) : null}
        {/* Symbol-Aktionen wie die Lupe bleiben auf Wunsch der Seite auch
            beim Rollen erreichbar. `mr-2` ergänzt `gap-1` auf die 12 px, die
            zwei 44-px-Trefferflächen nebeneinander brauchen. */}
        {shrinkToTitle && toolbar != null ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Suchen"
            // `mr-2` ergänzt `gap-1` auf die 12 px zwischen zwei 44-px-
            // Trefferflächen.
            className={cn(hasMenu && "mr-2")}
            tooltip="Springt nach oben ins Suchfeld."
            onClick={() => {
              const reduce = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
              toolbarRef.current
                ?.querySelector<HTMLInputElement>("input")
                ?.focus({ preventScroll: true });
            }}
          >
            <Search className="size-5" aria-hidden="true" />
          </Button>
        ) : null}
        {compactActions != null && compactActions !== false ? (
          <div
            data-app-head-compact-actions=""
            className={cn(
              "flex shrink-0 items-center gap-3 empty:hidden",
              hasMenu && "mr-2",
            )}
          >
            {compactActions === true ? (
              <div className={ICON_ACTIONS_ONLY}>{actions}</div>
            ) : (
              compactActions
            )}
          </div>
        ) : null}
        {menuButton}
      </div>

      <OverlaySheet open={menuOpen} onOpenChange={setMenuOpen} title={title}>
        <div className="space-y-5 pt-1">
          {actions != null && (
            <>
              <div className={TEXT_ACTIONS_ONLY}>{actions}</div>
              <div className={KEBAB_ROW}>
                <span>Weitere Aktionen</span>
                <div className={KEBAB_ONLY}>{actions}</div>
              </div>
            </>
          )}
          {hasMenuEntries && overflowMenu ? (
            <MenuEntries
              entries={overflowMenu}
              onDone={() => setMenuOpen(false)}
            />
          ) : null}
          {info != null && (
            <section className="space-y-1.5">
              <SectionLabel as="h3">Über diese Seite</SectionLabel>
              <div className="tablet:text-base text-sm leading-6 text-gray-700">
                {info}
              </div>
            </section>
          )}
          {/* Nur das Hilfe-Symbol, auf jeder App-Breite (der Link blendet
              sich sonst ab lg aus): Die Suche hat ihren Platz unter „Mehr“
              und stünde hier ohne Beschriftung. */}
          <div className="hidden items-center justify-between gap-3 text-sm font-medium text-gray-900 has-[a]:flex has-[button]:flex [&_.lg\:hidden]:inline-flex [&_span.lg\:hidden>:not(:last-child)]:hidden">
            <span>Hilfe zu dieser Seite</span>
            <MobilePageHelpTarget />
          </div>
        </div>
      </OverlaySheet>
    </>
  );
}

/**
 * Unterkante der klebenden Kopfteile als `--app-sticky-offset` am Dokument:
 * Darunter kleben die Gruppenköpfe einer `Collection`.
 */
function useStickyOffset(
  toolbarRef: RefObject<HTMLDivElement | null>,
  scrolledAway: boolean,
  toolbarSticks: boolean,
) {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const toolbar = toolbarSticks ? toolbarRef.current : null;
      const top = toolbar
        ? Number.parseFloat(getComputedStyle(toolbar).top)
        : 0;
      const height = toolbar?.offsetHeight ?? 0;
      const compact = scrolledAway && !toolbar ? COMPACT_HEIGHT_PX + 8 : 0;
      root.style.setProperty(
        "--app-sticky-offset",
        `${(Number.isFinite(top) ? top : 0) + height + compact + 4}px`,
      );
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (toolbarRef.current) observer?.observe(toolbarRef.current);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--app-sticky-offset");
    };
  }, [toolbarRef, scrolledAway, toolbarSticks]);
}

/**
 * Ob die klebenden Teile über Inhalt liegen: Die Kopfkarte ist weg oder
 * die Leiste klebt schon oben.
 */
function useStuck(
  toolbarRef: RefObject<HTMLElement | null>,
  scrolledAway: boolean,
): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const update = () => {
      const toolbar = toolbarRef.current;
      if (toolbar === null || window.scrollY <= 0) {
        setStuck(false);
        return;
      }
      const top = Number.parseFloat(getComputedStyle(toolbar).top);
      setStuck(toolbar.getBoundingClientRect().top <= top + 0.5);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [toolbarRef]);
  return stuck || scrolledAway;
}

/**
 * Höhe der Kopfkarte, wenn sie in der Detailspalte einer `SplitView` steht
 * (sonst `null`). Darunter klebt die Leiste.
 */
function useSplitDetailHeadHeight(
  ref: RefObject<HTMLElement | null>,
): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node?.closest("[data-split-detail]") == null) {
      setHeight(null);
      return undefined;
    }
    const update = () => setHeight(node.offsetHeight);
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [ref]);
  return height;
}

/** Ob die Kopfkarte oben aus dem Bild gescrollt ist, auch nur teilweise. */
function useScrolledAway(ref: RefObject<HTMLElement | null>): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        // Schon angeschnitten zählt als weg: Die schmale Kopfkarte löst
        // die Kopfkarte ab, statt sie oben abgeschnitten stehen zu lassen.
        setAway(
          entry.intersectionRatio < 0.98 && entry.boundingClientRect.top < 0,
        );
      },
      { threshold: [0, 0.98, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return away;
}

/** Die Kebab-Einträge als Zeilen im Blatt. */
function MenuEntries({
  entries,
  onDone,
}: Readonly<{
  entries: readonly OverflowMenuEntry[];
  onDone: () => void;
}>) {
  const run = (fn: () => void, keepOpen = false) => {
    if (!keepOpen) onDone();
    fn();
  };
  return (
    // `-mx-3`: Die Zeilen haben 12 px Innenabstand; so beginnt ihr Text
    // bündig mit dem Blatttitel und „Über diese Seite“ (Runde 17), die
    // Tippfläche reicht trotzdem fast bis an den Blattrand.
    <div className="-mx-3 flex flex-col">
      {entries.map((entry, index) => {
        if ("kind" in entry && entry.kind === "separator") {
          return <hr key={index} className="my-1 border-gray-100" />;
        }
        if ("kind" in entry && entry.kind === "header") {
          return (
            <SectionLabel key={index} as="h3" className="px-3 pt-2 pb-1">
              {entry.label}
            </SectionLabel>
          );
        }
        if ("kind" in entry) {
          return (
            <ListRow
              key={index}
              density="compact"
              className="min-h-11 bg-transparent"
              onClick={() =>
                run(entry.onClick, entry.kind === "checkbox" && entry.keepOpen)
              }
              trailing={entry.checked ? "✓" : undefined}
              aria-label={entry.label}
            >
              {entry.label}
            </ListRow>
          );
        }
        if (entry.href && !entry.external) {
          return (
            <NavigationLink
              key={index}
              href={entry.href}
              onClick={() => run(entry.onClick)}
              className="flex min-h-11 flex-col justify-center rounded-xl px-3 py-2 text-sm active:bg-gray-100"
            >
              <span
                className={
                  entry.destructive ? "text-moto-red-strong" : "text-gray-900"
                }
              >
                {entry.label}
              </span>
              {entry.description ? (
                <span className="text-xs text-gray-500">
                  {entry.description}
                </span>
              ) : null}
            </NavigationLink>
          );
        }
        return (
          <ListRow
            key={index}
            density="compact"
            className="min-h-11 bg-transparent"
            onClick={() => {
              if (entry.disabled) return;
              if (entry.href) window.open(entry.href, "_blank", "noopener");
              run(entry.onClick);
            }}
            tone={entry.destructive ? "danger" : undefined}
            trailing={entry.badge}
          >
            <span className="flex flex-col">
              <span>{entry.label}</span>
              {entry.description ? (
                <span className="text-xs text-gray-500">
                  {entry.description}
                </span>
              ) : null}
            </span>
          </ListRow>
        );
      })}
    </div>
  );
}

export interface AppTabsProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly items: readonly {
    readonly value: string;
    readonly label: string;
    readonly badge?: number;
    readonly disabled?: boolean;
    readonly href?: string;
  }[];
  readonly label?: string;
}

/** Seitenreiter in der App: eine scrollbare Chip-Reihe in der Leiste. */
export function AppTenantTabs({
  value,
  onChange,
  items,
  label = "Seitenbereiche",
}: AppTabsProps) {
  const navRef = useRef<HTMLElement>(null);
  useScrollActiveIntoView(navRef, value);
  const chipPadding = useTabPeekPadding(navRef, items);
  // Reiter ohne eigene Adresse sind echte Reiter (`tablist`): Pfeiltasten
  // wechseln reihum, nur der gewählte liegt in der Tab-Reihenfolge (#6579).
  const asTabs = items.every((item) => !item.href);
  const enabled = items.filter((item) => !item.disabled);
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const current = event.currentTarget.dataset.tabValue;
    const index = enabled.findIndex((item) => item.value === current);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    navRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-tab-value="${CSS.escape(next.value)}"]`,
      )
      ?.focus();
  };
  return (
    <div className="relative">
      <nav
        ref={navRef}
        aria-label={label}
        role={asTabs ? "tablist" : undefined}
        // `py-1.5 -mt-1`: Die Leiste schneidet senkrecht mit ab; so bleibt die
        // 44-px-Trefferfläche der 32 px hohen Reiter ganz. Unten kein
        // negativer Rand: Sonst ragt das Suchfeld darunter in sie hinein.
        // Telefon: Die Reihe scrollt bis zum Kartenrand (Leiste `px-4`), der
        // erste Reiter beginnt bündig mit dem Titel. Am Kartenrand schaut
        // nur der Rand des nächsten Reiters hervor: Die Reihe geht sichtbar
        // weiter, ohne dass ein Wort halb ausgeblendet ist.
        className="phone:-mx-4 phone:px-4 -mx-2 -mt-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-2 py-1.5"
        style={
          chipPadding === null
            ? undefined
            : ({ "--app-tab-px": `${chipPadding}px` } as CSSProperties)
        }
      >
        {items.map((item) => {
          const active = item.value === value;
          const content = (
            <>
              {item.label}
              {item.badge ? (
                <span className="tabular-nums opacity-80">{item.badge}</span>
              ) : null}
            </>
          );
          if (item.href && !item.disabled) {
            return (
              <ButtonLink
                key={item.value}
                href={item.href}
                variant="chip"
                size="md"
                className={TAB_CHIP_PADDING}
                aria-current={active ? "page" : undefined}
                noTooltip="Reiter: der Name sagt, wohin er führt."
              >
                {content}
              </ButtonLink>
            );
          }
          return (
            <Button
              key={item.value}
              type="button"
              variant="chip"
              size="md"
              className={TAB_CHIP_PADDING}
              {...(asTabs
                ? {
                    role: "tab",
                    "aria-selected": active,
                    tabIndex: active ? 0 : -1,
                    "data-tab-value": item.value,
                    onKeyDown: onTabKeyDown,
                  }
                : { "aria-pressed": active })}
              disabled={item.disabled}
              onClick={() => onChange(item.value)}
              noTooltip="Reiter: der Name sagt, was er zeigt."
            >
              {content}
            </Button>
          );
        })}
      </nav>
    </div>
  );
}

// Innenabstand der Reiter; `useTabPeekPadding` passt ihn an, solange die
// Reihe seitlich scrollt (Grundwert wie `variant="chip"`: 14 px).
const TAB_CHIP_PADDING = "px-[var(--app-tab-px,0.875rem)]";
const TAB_BASE_PADDING_PX = 14;
// Mindestens so weit schaut der erste nicht ganz sichtbare Reiter am Rand
// hervor: sein Rahmen und ein Stück Innenabstand, kein angeschnittener
// Buchstabe.
const TAB_PEEK_MIN_PX = 10;
const TAB_MIN_PADDING_PX = 10;
const TAB_MAX_PADDING_PX = 24;

/**
 * Innenabstand der Reiter, wenn die Reihe breiter als die Karte ist: Alle
 * Reiter im ersten Bild stehen ganz da, vom nächsten schaut nur der Rand
 * hervor. `null`, solange alle Reiter passen oder kein Wert in den Grenzen
 * das schafft.
 */
function useTabPeekPadding(
  ref: RefObject<HTMLElement | null>,
  items: AppTabsProps["items"],
): number | null {
  const [padding, setPadding] = useState<number | null>(null);
  const labels = items.map((item) => `${item.label}${item.badge ?? ""}`);
  const key = labels.join("\u0000");
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const chips = [...node.children] as HTMLElement[];
      if (chips.length === 0) return;
      const current =
        Number.parseFloat(getComputedStyle(chips[0]!).paddingLeft) ||
        TAB_BASE_PADDING_PX;
      // Breiten beim Grundabstand, unabhängig vom zuletzt gesetzten Wert.
      const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
      const start = Number.parseFloat(getComputedStyle(node).paddingLeft) || 0;
      const widths = chips.map(
        (chip) => chip.offsetWidth - 2 * current + 2 * TAB_BASE_PADDING_PX,
      );
      const total =
        start + widths.reduce((sum, width) => sum + width + gap, -gap);
      if (total <= node.clientWidth) {
        setPadding(null);
        return;
      }
      // Für jede Zahl ganz sichtbarer Reiter (k) die Innenabstände, bei denen
      // vom nächsten Reiter mindestens `TAB_PEEK_MIN_PX`, aber nur Rahmen und
      // Innenabstand hervorschauen (kein Buchstabe). Gewählt wird der Wert,
      // der dem Grundwert am nächsten liegt und in den Grenzen bleibt.
      const contents = widths.map((width) => width - 2 * TAB_BASE_PADDING_PX);
      let best: number | null = null;
      let used = start;
      for (let k = 1; k < contents.length; k += 1) {
        used += contents[k - 1]! + gap;
        const room = node.clientWidth - used;
        // Rand: 1 px Rahmen, danach beginnt der Text.
        const low = Math.max(TAB_MIN_PADDING_PX, (room - 1) / (2 * k + 1));
        const high = Math.min(
          TAB_MAX_PADDING_PX,
          (room - TAB_PEEK_MIN_PX) / (2 * k),
        );
        if (low > high) continue;
        const candidate = Math.min(high, Math.max(low, TAB_BASE_PADDING_PX));
        if (
          best === null ||
          Math.abs(candidate - TAB_BASE_PADDING_PX) <
            Math.abs(best - TAB_BASE_PADDING_PX)
        )
          best = candidate;
      }
      setPadding(best === null ? null : Math.round(best * 10) / 10);
    };
    measure();
    // Auch die Reiter selbst: Nach dem Laden der Schrift werden sie breiter.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const chip of node.children) observer.observe(chip);
    return () => observer.disconnect();
  }, [ref, key]);
  return padding;
}

/** Schiebt den aktiven Reiter beim Wechsel in den sichtbaren Bereich. */
function useScrollActiveIntoView(
  ref: RefObject<HTMLElement | null>,
  active: string,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const current = node.querySelector<HTMLElement>(
      "[aria-pressed='true'],[aria-current='page'],[aria-selected='true']",
    );
    if (current && node.scrollWidth > node.clientWidth) {
      const left = current.offsetLeft - node.offsetLeft;
      const right = left + current.offsetWidth;
      if (left < node.scrollLeft || right > node.scrollLeft + node.clientWidth)
        node.scrollLeft = Math.max(0, left - 40);
    }
  }, [ref, active]);
}

/** Ob ein Element seitlich scrollt (Inhalt breiter als die Fläche). */
function useScrollsSideways(ref: RefObject<HTMLElement | null>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const measure = () =>
      setScrolls(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return scrolls;
}
