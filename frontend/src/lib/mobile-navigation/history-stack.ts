"use client";

/**
 * Der Verlaufsstack der App-Oberfläche (Prototyp Mobile-Zielbild, #8070).
 *
 * Merkt sich je Verlaufseintrag, dass er innerhalb der App liegt, unter
 * welcher Adresse und in welchem Reiter. Daraus folgen „Zurück ist ein
 * Verlaufsschritt“ (`useStackBack`) und Scroll-Positionen je Eintrag statt
 * je Pfad (`NavigationScrollPosition`).
 *
 * Zwei Quellen für die Identität eines Eintrags:
 *   - Navigation API (`navigation.currentEntry.key`, Chrome, Safari ab 26.2):
 *     der Browser kennt jeden Eintrag samt Reihenfolge, auch nach Neuladen.
 *   - sonst ein eigener Stack in `sessionStorage`: Vorwärts-Wechsel legen
 *     einen Eintrag an, `popstate` sucht den passenden Nachbarn.
 *
 * Rein: kein Mandanten- oder Fachwissen. Den Reiter eines Eintrags setzt die
 * Pill (`setEntryTab`), die das Register kennt.
 */

const STORAGE_KEY = "moto:nav-stack:v1";
const MAX_ENTRIES = 80;

export interface StackEntry {
  readonly id: string;
  /** Pfad + Query, wie im Browser. */
  readonly url: string;
  readonly tab?: string;
}

interface NavigationEntryLike {
  readonly key: string;
  readonly index: number;
  readonly url: string | null;
}

interface NavigationLike {
  readonly currentEntry: NavigationEntryLike | null;
  entries(): NavigationEntryLike[];
}

interface StoredState {
  /** Eigener Stack (ohne Navigation API). */
  entries: StackEntry[];
  index: number;
  /** Navigation API: Daten je Eintragsschlüssel. */
  meta: Record<string, { url: string; tab?: string }>;
}

let state: StoredState | null = null;
let pendingTab: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

function navigationApi(): NavigationLike | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { navigation?: NavigationLike })
    .navigation;
  return candidate?.currentEntry && typeof candidate.entries === "function"
    ? candidate
    : null;
}

function load(): StoredState {
  if (state) return state;
  let parsed: StoredState | null = null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    parsed = raw ? (JSON.parse(raw) as StoredState) : null;
  } catch {
    // Privater Modus oder kaputter Eintrag: der Stack beginnt leer.
    parsed = null;
  }
  state = parsed ?? { entries: [], index: -1, meta: {} };
  return state;
}

function persist() {
  version += 1;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ohne Speicher gilt der Stack nur bis zum Neuladen.
  }
  for (const listener of listeners) listener();
}

function randomId(): string {
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

function relativeUrl(absolute: string | null): string | null {
  if (!absolute) return null;
  try {
    const parsed = new URL(absolute);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Meldet einen bestätigten Seitenwechsel (Pfad oder Query). `traversal`:
 * der Wechsel kam aus `popstate` (Zurück/Vor des Browsers oder `router.back`).
 */
export function recordCommit(url: string, traversal: boolean): void {
  const current = load();
  const nav = navigationApi();
  if (nav?.currentEntry) {
    const key = nav.currentEntry.key;
    const known = current.meta[key];
    current.meta[key] = { url, tab: known?.tab };
    // Nur Einträge behalten, die der Browser noch kennt.
    const alive = new Set(nav.entries().map((entry) => entry.key));
    for (const stored of Object.keys(current.meta)) {
      if (!alive.has(stored)) delete current.meta[stored];
    }
    persist();
    return;
  }

  const here = current.entries[current.index];
  if (traversal) {
    const candidates = [current.index - 1, current.index + 1];
    for (let distance = 2; distance < current.entries.length; distance++) {
      candidates.push(current.index - distance, current.index + distance);
    }
    const match = candidates.find(
      (index) => current.entries[index]?.url === url,
    );
    if (match !== undefined) {
      current.index = match;
      persist();
      return;
    }
  } else if (here && pathOf(here.url) === pathOf(url)) {
    // Query-Wechsel (Filter, Reiter) ersetzt den Eintrag, wie `replaceState`.
    current.entries[current.index] = { ...here, url };
    persist();
    return;
  }
  const entries = current.entries.slice(0, current.index + 1);
  entries.push({ id: randomId(), url });
  current.entries = entries.slice(-MAX_ENTRIES);
  current.index = current.entries.length - 1;
  persist();
}

function entryAt(offset: number): StackEntry | null {
  if (typeof window === "undefined") return null;
  const current = load();
  const nav = navigationApi();
  if (nav?.currentEntry) {
    const target = nav.entries()[nav.currentEntry.index + offset];
    if (!target) return null;
    const meta = current.meta[target.key];
    // Ein Eintrag ohne Daten liegt außerhalb der App (Anmeldung, fremde
    // Seite) oder vor dem ersten Laden dieser Sitzung.
    if (!meta) return null;
    return {
      id: target.key,
      url: relativeUrl(target.url) ?? meta.url,
      tab: meta.tab,
    };
  }
  return current.entries[current.index + offset] ?? null;
}

/** Der aktuelle Eintrag, `null` vor dem ersten Wechsel. */
export function currentEntry(): StackEntry | null {
  return entryAt(0);
}

/** Der vorige Eintrag, wenn er innerhalb der App liegt. */
export function previousEntry(): StackEntry | null {
  return entryAt(-1);
}

/** Ordnet dem aktuellen Eintrag seinen Reiter zu (einmal, dann fest). */
export function setEntryTab(id: string, tab: string): void {
  const current = load();
  const nav = navigationApi();
  if (nav?.currentEntry) {
    const meta = current.meta[id];
    if (!meta || meta.tab === tab) return;
    current.meta[id] = { ...meta, tab };
  } else {
    const index = current.entries.findIndex((entry) => entry.id === id);
    const entry = current.entries[index];
    if (!entry || entry.tab === tab) return;
    current.entries[index] = { ...entry, tab };
  }
  persist();
}

/** Ein Tipp auf einen Reiter: der nächste Eintrag gehört zu ihm. */
export function setPendingTab(tab: string): void {
  pendingTab = tab;
}

export function takePendingTab(): string | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}

export function subscribeStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function stackVersion(): number {
  return version;
}
