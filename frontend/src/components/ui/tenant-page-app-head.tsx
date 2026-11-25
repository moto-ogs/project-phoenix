"use client";

import { MoreHorizontal } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
export const AppHeadStatsContext = createContext(false);

export function useInAppHeadStats(): boolean {
  return useContext(AppHeadStatsContext);
}

/** Hooks für View Transitions: Kopf und schmale Kopfkarte bleiben stehen. */
export const APP_HEAD_ATTR = { "data-app-page-head": "" } as const;
export const APP_HEAD_COMPACT_ATTR = {
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
  tabs,
  toolbar,
  printHideHeader = false,
}: AppHeadProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // In der Detailspalte einer `SplitView` (iPad quer) scrollt die Spalte,
  // nicht die Seite: Kopfkarte und Leiste kleben oben an der Spalte, die
  // schmale Kopfkarte über die ganze Breite entfällt.
  const splitHeadHeight = useSplitDetailHeadHeight(headRef);
  const inSplitDetail = splitHeadHeight !== null;
  const scrolledAway = useScrolledAway(headRef) && !inSplitDetail;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const veiled = useStuck(toolbarRef, scrolledAway);
  const hasMenuEntries = (overflowMenu?.length ?? 0) > 0;
  // „…“ nur, wenn das Blatt etwas zeigt: Aktionen, Menüeinträge oder Info.
  const hasMenu = hasMenuEntries || info != null || actions != null;
  const hasToolbar = tabs != null || toolbar != null;
  useStickyOffset(toolbarRef, scrolledAway);
  let stickyTop = scrolledAway
    ? `calc(${TOP_GAP} + ${COMPACT_HEIGHT_PX + 8}px)`
    : TOP_GAP;
  if (inSplitDetail) stickyTop = `${splitHeadHeight + 6}px`;

  const menuButton = hasMenu ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Mehr zu dieser Seite"
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
              "tablet:text-xl min-w-0 flex-1 truncate text-lg leading-7 font-semibold tracking-tight text-gray-900",
              // Bündig: ohne Zurück-Pfeil 16 px vom Rand wie die Chips, nach
              // dem Pfeil ohne zusätzlichen Einzug.
              backLink
                ? "-ml-3 [[data-app-head-leading]:not(:empty)+&]:ml-0"
                : "pl-2",
            )}
          >
            {title}
          </h1>
          <div className={ICON_ACTIONS_ONLY}>{actions}</div>
          {menuButton}
        </div>
        {statusLine != null && (
          <AppHeadStatsContext.Provider value={true}>
            {/* Chips beginnen an der Titelkante (ohne Pfeil 16 px, nach
                dem Pfeil 52 px vom Kartenrand). */}
            <div
              className={cn(
                "-mx-2 [scrollbar-width:none] overflow-x-auto pr-2 pb-1.5 text-sm text-gray-600",
                backLink ? "pl-13" : "pl-4",
              )}
            >
              {statusLine}
            </div>
          </AppHeadStatsContext.Provider>
        )}
      </header>

      {/* Deckende Zone hinter Leiste und schmaler Kopfkarte bis zum oberen
          Rand: Darüber scheint keine Liste durch. */}
      <div
        aria-hidden="true"
        data-app-page-backdrop=""
        className={cn(
          `moto-app-backdrop pointer-events-none fixed inset-x-0 top-0 ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT}`,
          !veiled && "hidden",
          printHideHeader && "print:hidden",
        )}
        style={{ height: "var(--app-sticky-offset, 0px)" }}
      />

      {hasToolbar && (
        <div
          ref={toolbarRef}
          data-app-page-toolbar=""
          className={cn(
            `sticky ${Z_LAYER.nav} mt-1.5 -mb-1 space-y-1.5 px-1.5 py-1`,
            FLOATING_CARD,
            printHideHeader && "print:hidden",
          )}
          style={{ top: stickyTop }}
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
          `tablet:inset-x-8 fixed inset-x-3 ${Z_LAYER.nav} ${FIXED_LAYER_SHIFT} flex items-center gap-1 px-1.5 transition-[opacity,transform] duration-200 motion-reduce:transition-none`,
          FLOATING_CARD,
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
          <div className="hidden items-center justify-between gap-3 text-sm font-medium text-gray-900 has-[a]:flex has-[button]:flex">
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
) {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const toolbar = toolbarRef.current;
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
  }, [toolbarRef, scrolledAway]);
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

/** Ob die Kopfkarte ganz aus dem Bild gescrollt ist. */
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
        setAway(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
      },
      { threshold: 0 },
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
    <div className="-mx-2 flex flex-col">
      {entries.map((entry, index) => {
        if ("kind" in entry && entry.kind === "separator") {
          return <hr key={index} className="my-1 border-gray-100" />;
        }
        if ("kind" in entry && entry.kind === "header") {
          return (
            <SectionLabel key={index} as="h3" className="px-2 pt-2 pb-1">
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
              className="flex min-h-11 flex-col justify-center rounded-xl px-2 py-2 text-sm active:bg-gray-100"
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
  const edges = useScrollEdges(navRef, value);
  return (
    <nav
      ref={navRef}
      aria-label={label}
      // `py-1.5 -my-1`: Die Leiste schneidet senkrecht mit ab; so bleibt die
      // 44-px-Trefferfläche der 32 px hohen Reiter ganz.
      className="-mx-2 -my-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-2 py-1.5"
      style={edgeMask(edges)}
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
            aria-pressed={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            noTooltip="Reiter: der Name sagt, was er zeigt."
          >
            {content}
          </Button>
        );
      })}
    </nav>
  );
}

/** Weiche Kante, wo die Reihe weitergeht: Ein Reiter ist nie hart abgeschnitten. */
function edgeMask(edges: { start: boolean; end: boolean }) {
  if (!edges.start && !edges.end) return undefined;
  const mask = `linear-gradient(to right, ${
    edges.start ? "transparent 0, #000 2.5rem" : "#000 0"
  }, ${edges.end ? "#000 calc(100% - 2.5rem), transparent 100%" : "#000 100%"})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * Ob links bzw. rechts noch Reiter verborgen sind. Der aktive Reiter wird
 * beim Wechsel in den sichtbaren Bereich geschoben.
 */
function useScrollEdges(ref: RefObject<HTMLElement | null>, active: string) {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const max = node.scrollWidth - node.clientWidth;
      setEdges({ start: node.scrollLeft > 2, end: node.scrollLeft < max - 2 });
    };
    const current = node.querySelector<HTMLElement>(
      "[aria-pressed='true'],[aria-current='page']",
    );
    if (current && node.scrollWidth > node.clientWidth) {
      const left = current.offsetLeft - node.offsetLeft;
      const right = left + current.offsetWidth;
      if (left < node.scrollLeft || right > node.scrollLeft + node.clientWidth)
        node.scrollLeft = Math.max(0, left - 40);
    }
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref, active]);
  return edges;
}
