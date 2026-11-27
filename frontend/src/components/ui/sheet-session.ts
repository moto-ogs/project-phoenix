"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { markSheetHistoryEvent } from "~/lib/sheet-history-events";

/**
 * Blätter in der App (#8070): immer nur eins offen, und Zurück schließt es.
 *
 * Jedes Blatt der App (`OverlaySheet`, `Drawer`, `SlideOver`, das Blatt von
 * `ResponsivePanel` und von `Modal mobileSheet`) meldet sich hier an, solange
 * es offen ist. Die Sitzung
 *
 *   - legt beim Öffnen einen flachen Eintrag in den Verlauf (gleiche Adresse,
 *     Marker `motoSheet` im State). Zurück entfernt ihn, `popstate` schließt
 *     das Blatt. Schließt das Blatt über die Oberfläche (Wischen, Esc,
 *     Abdunklung, Knopf), baut die Sitzung den Eintrag mit `history.back()`
 *     wieder ab, ohne die Seite zu verlassen;
 *   - schließt beim Öffnen eines zweiten Blatts das erste. Dessen Eintrag
 *     übernimmt das neue Blatt (`replaceState`), der Verlauf wächst nicht.
 *     Ein Blatt, das in einem offenen Blatt aufgeht (Auswahlliste im
 *     Filter-Blatt), ersetzt es nur sichtbar: Das untere bleibt eingehängt,
 *     ist verdeckt (`useSheetCovered`) und kehrt mit Zurück wieder.
 *
 * Next.js verbindet `pushState`/`replaceState` mit seinem Router und behält
 * seinen eigenen State im Eintrag; ein Eintrag mit gleicher Adresse löst
 * keinen Seitenwechsel aus (wie der Wächter in `use-navigation-guard.ts`).
 * Der Wächter fragt `isSheetHistoryEvent`, damit ein Zurück, das nur ein
 * Blatt schließt, nicht als „Seite verlassen“ zählt.
 *
 * Auf dem Desktop meldet sich kein Blatt an (`enabled` false): Dort bleibt
 * alles wie bisher.
 */

const STATE_KEY = "motoSheet";

interface SheetSession {
  readonly id: string;
  readonly parentId: string | null;
  /** Schließt das Blatt (der Aufrufer setzt `open` auf false). */
  close: () => void;
  /** Ob das Blatt einen eigenen Verlaufseintrag trägt. */
  ownsEntry: boolean;
  /** Vom Verlauf oder durch ein neues Blatt geschlossen: kein `back()`. */
  closedExternally: boolean;
}

let sessions: readonly SheetSession[] = [];
const listeners = new Set<() => void>();
/** Eigene `history.back()`, deren `popstate` niemand anderem gehört. */
let expectedPops = 0;
let listening = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state !== null && typeof state === "object"
    ? (state as Record<string, unknown>)
    : {};
}

function currentSheetId(): string | null {
  const value = historyState()[STATE_KEY];
  return typeof value === "string" ? value : null;
}

function isAncestor(candidate: SheetSession, of: SheetSession): boolean {
  let parentId = of.parentId;
  const seen = new Set<string>();
  while (parentId !== null && !seen.has(parentId)) {
    if (parentId === candidate.id) return true;
    seen.add(parentId);
    parentId = sessions.find((s) => s.id === parentId)?.parentId ?? null;
  }
  return false;
}

function onPopState(event: PopStateEvent) {
  if (expectedPops > 0) {
    expectedPops -= 1;
    markSheetHistoryEvent(event);
    return;
  }
  if (sessions.length === 0) return;
  const landedOn = currentSheetId();
  const index =
    landedOn === null ? -1 : sessions.findIndex((s) => s.id === landedOn);
  // Alles über dem Eintrag, auf dem der Verlauf jetzt steht, schließt.
  const closing = sessions.slice(index + 1).filter((s) => s.ownsEntry);
  if (closing.length === 0) return;
  markSheetHistoryEvent(event);
  for (const session of [...closing].reverse()) {
    session.closedExternally = true;
    session.close();
  }
}

function ensureListening() {
  if (listening) return;
  listening = true;
  // Capture: läuft vor den Zuhörern ohne Capture am selben Ziel (Wächter).
  window.addEventListener("popstate", onPopState, { capture: true });
}

function open(session: SheetSession) {
  ensureListening();
  // Ein neues Blatt ersetzt jedes offene, das nicht sein Vorfahr ist.
  const replaced = sessions.filter((s) => !isAncestor(s, session));
  for (const other of replaced) other.closedExternally = true;
  const kept = sessions.filter((s) => !replaced.includes(s));
  // Der oberste Eintrag gehört einem ersetzten oder schon geschlossenen
  // Blatt (auch: Reacts Doppel-Effekt im Strict Mode): übernehmen.
  const top = currentSheetId();
  const reuse = top !== null && !kept.some((s) => s.id === top);
  sessions = [...kept, session];
  const state = { ...historyState(), [STATE_KEY]: session.id };
  if (reuse) {
    window.history.replaceState(state, "", window.location.href);
  } else {
    window.history.pushState(state, "", window.location.href);
  }
  session.ownsEntry = true;
  for (const other of replaced) other.close();
  emit();
}

function release(session: SheetSession) {
  if (!sessions.includes(session)) return;
  // Kinder gehen mit: Ihr Eintrag liegt über dem des Eltern-Blatts.
  const children = sessions.filter(
    (s) => s !== session && isAncestor(session, s),
  );
  for (const child of children) {
    child.closedExternally = true;
    child.close();
  }
  sessions = sessions.filter((s) => s !== session && !children.includes(s));
  emit();
  if (session.closedExternally || !session.ownsEntry) return;
  const ownCount = 1 + children.filter((c) => c.ownsEntry).length;
  const href = window.location.href;
  // Einen Takt warten: Schloss das Blatt, weil ein Eintrag darin eine Seite
  // öffnet, hat der Router den Eintrag inzwischen ersetzt oder überdeckt.
  window.setTimeout(() => {
    const topIsOurs =
      currentSheetId() === session.id ||
      children.some((c) => c.id === currentSheetId());
    if (!topIsOurs || window.location.href !== href) return;
    // Gleich wieder geöffnet (Strict Mode, neu eingehängt): Eintrag bleibt.
    if (sessions.some((s) => s.id === currentSheetId())) return;
    expectedPops += 1;
    window.history.go(-ownCount);
  }, 0);
}

const SheetParentContext = createContext<string | null>(null);

/** Gibt die Sitzung an Blätter weiter, die im Blatt aufgehen. */
export const SheetSessionProvider = SheetParentContext.Provider;

/**
 * Meldet ein Blatt an, solange `open` und `enabled`. `onClose` setzt den
 * offenen Zustand des Aufrufers auf false. Gibt die ID zurück, die der
 * Aufrufer mit `SheetSessionProvider` an seinen Inhalt weitergibt.
 */
export function useSheetSession(
  open_: boolean,
  onClose: () => void,
  enabled: boolean,
): string {
  const id = useId();
  const parentId = useContext(SheetParentContext);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  const active = open_ && enabled;
  useEffect(() => {
    if (!active) return undefined;
    const session: SheetSession = {
      id,
      parentId,
      close: () => onCloseRef.current(),
      ownsEntry: false,
      closedExternally: false,
    };
    open(session);
    return () => release(session);
  }, [active, id, parentId]);
  return id;
}

function isCoveredSnapshot(id: string): boolean {
  return sessions.some((s) => s.parentId === id);
}

/** Ob über diesem Blatt gerade ein Kind-Blatt offen ist. */
export function useSheetCovered(id: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (id === null ? false : isCoveredSnapshot(id)),
    () => false,
  );
}

/** Die Sitzung des umgebenden Blatts, oder null. */
export function useParentSheetId(): string | null {
  return useContext(SheetParentContext);
}

/** Nur für Tests. */
export function resetSheetSessionsForTest() {
  sessions = [];
  expectedPops = 0;
  emit();
}
