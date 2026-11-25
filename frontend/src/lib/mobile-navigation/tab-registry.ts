/**
 * Routen-Register der App-Oberfläche (Prototyp Mobile-Zielbild, #8070).
 *
 * Ein Ort für die Frage „zu welchem Reiter gehört diese Seite?“ statt
 * verstreuter `?from=`-Heuristiken. Drei Arten von Routen:
 *
 *   - Wurzel eines Reiters (`/home`, `/students/search`, …): gehört fest zu
 *     diesem Reiter.
 *   - Geteiltes Detail (`/students/[id]`, `/rooms/[id]`, `/staff/[id]`):
 *     gehört zu dem Reiter, aus dem es geöffnet wurde (`inherit`). Ohne
 *     Herkunft gilt `defaultTab`.
 *   - Alles andere gehört zu „Mehr“.
 *
 * Reiter heißen nach dem Pfad ihrer Wurzel (`/ogs-groups`), wie die Felder
 * der Pill. Welche Reiter eine Person sieht, entscheidet die Pill; das
 * Register kennt nur alle möglichen.
 */

export const MORE_TAB = "more";
export const MORE_PAGE_HREF = "/mehr";

/** Die Wurzeln aller möglichen Reiter in Prüfreihenfolge. */
const TAB_ROOTS: readonly string[] = [
  "/home",
  "/tagesplan",
  "/ogs-groups",
  "/students/search",
  "/active-supervisions",
  "/activities",
  "/rooms",
];

interface InheritRule {
  readonly pattern: RegExp;
  /** Reiter ohne bekannte Herkunft (Direktaufruf, neuer Tab). */
  readonly defaultTab: string;
}

/** Detailseiten, die aus mehreren Reitern geöffnet werden. */
const INHERIT_RULES: readonly InheritRule[] = [
  // Kindakte samt Unterseiten (Historie, Unfallanzeige).
  {
    pattern: /^\/students\/(?!search(?:\/|$))[^/]+/,
    defaultTab: "/students/search",
  },
  { pattern: /^\/rooms\/[^/]+/, defaultTab: "/rooms" },
  { pattern: /^\/staff\/[^/]+/, defaultTab: MORE_TAB },
  { pattern: /^\/parent-attention\/[^/]+/, defaultTab: MORE_TAB },
];

/**
 * Seiten, auf denen die Pill in der App ausgeblendet ist (Produktentscheid,
 * Vorschlag #8070 „Nachrichten“). Eine Regel für alle Geräte: Die Pill fehlt,
 * solange der Chat-Verlauf allein den Bildschirm füllt, wie in Chat-Apps. Er
 * braucht die Höhe, das Schreibfeld klebt unten, und Zurück führt zur Liste,
 * also zum Reiter. Das gilt auf dem Telefon und dem iPad hoch. Auf dem iPad
 * quer (`split`) steht der Verlauf nie allein: `/messages/<id>` öffnet dort
 * die Liste mit dem Verlauf rechts daneben, und diese Ansicht ist die Wurzel
 * des Reiters, also mit Pill.
 */
interface PillHiddenRule {
  readonly pattern: RegExp;
  /** Auch im `split` (iPad quer) ausblenden. */
  readonly inSplit: boolean;
}

const PILL_HIDDEN_RULES: readonly PillHiddenRule[] = [
  { pattern: /^\/messages\/(?!groups(?:\/|$))[^/]+\/?$/, inSplit: false },
];

/** Ob die App auf `pathname` (ohne Mandanten-Präfix) ohne Pill läuft. */
export function hidesPill(
  pathname: string,
  { split }: { readonly split: boolean },
): boolean {
  return PILL_HIDDEN_RULES.some(
    (rule) => rule.pattern.test(pathname) && (!split || rule.inSplit),
  );
}

type TabResolution =
  | { readonly kind: "tab"; readonly tab: string }
  | { readonly kind: "inherit"; readonly defaultTab: string };

function matchesRoot(root: string, pathname: string): boolean {
  if (root === "/home") return pathname === "/home" || pathname === "/";
  return pathname === root || pathname.startsWith(`${root}/`);
}

/** Der Reiter eines Pfads (ohne Mandanten-Präfix) laut Register. */
function resolveTab(pathname: string): TabResolution {
  for (const rule of INHERIT_RULES) {
    if (rule.pattern.test(pathname)) {
      return { kind: "inherit", defaultTab: rule.defaultTab };
    }
  }
  if (pathname === MORE_PAGE_HREF) return { kind: "tab", tab: MORE_TAB };
  const root = TAB_ROOTS.find((candidate) => matchesRoot(candidate, pathname));
  return { kind: "tab", tab: root ?? MORE_TAB };
}

/**
 * Der Reiter einer neu betretenen Seite: fest aus dem Register, sonst der
 * Reiter der Seite, aus der man kam (`fromTab`), sonst die alte
 * `?from=`-Angabe (Direktaufruf), sonst der Standard.
 */
export function tabForEntry(
  pathname: string,
  fromTab: string | null,
  fromParam: string | null,
): string {
  const resolution = resolveTab(pathname);
  if (resolution.kind === "tab") return resolution.tab;
  if (fromTab) return fromTab;
  if (fromParam?.startsWith("/")) {
    const fromResolution = resolveTab(fromParam.split("?")[0] ?? fromParam);
    if (fromResolution.kind === "tab") return fromResolution.tab;
  }
  return resolution.defaultTab;
}

/** Die Wurzel eines Reiters (für „erneut tippen → zur Wurzel“). */
export function isTabRoot(tab: string, pathname: string): boolean {
  if (tab === MORE_TAB) return pathname === MORE_PAGE_HREF;
  if (tab === "/home") return pathname === "/home" || pathname === "/";
  return pathname === tab;
}

/**
 * Welches sichtbare Feld der Pill zu `tab` gehört. Ein Feld kann weitere
 * Bereiche vertreten (`activePaths`, etwa „Suchen“ für Gruppe und Aufsicht
 * bei „Kinder nur über Alle Kinder“). `null`: der Reiter liegt unter „Mehr“.
 */
export function visibleTabFor(
  tab: string,
  items: readonly {
    readonly href: string;
    readonly activePaths?: readonly string[];
  }[],
): string | null {
  const direct = items.find((item) => item.href === tab);
  if (direct) return direct.href;
  const owner = items.find((item) =>
    item.activePaths?.some(
      (path) => tab === path || tab.startsWith(`${path}/`),
    ),
  );
  return owner?.href ?? null;
}
