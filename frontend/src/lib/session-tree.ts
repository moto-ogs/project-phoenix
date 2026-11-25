/**
 * The protected tree of this document (#8082): everything a portal renders
 * below its SessionProvider, visible pages, pages React keeps hidden
 * (`Activity`, also Next's kept routes), parallel slots, overlays and the
 * providers that hold a person's data. SessionTreeBoundary renders it under
 * a key; this module holds what decides that key from outside React.
 *
 * `epoch` grows with every discard. `leaving` is set once the document is
 * about to leave: a logout or a school switch whose cookie is in place, a
 * hard navigation to another account's page, `pagehide`. It stays until the
 * document is gone; the next document starts with a fresh tree.
 *
 * Discards decided inside React (a new auth generation, another tab's
 * change) live in the boundary itself, so the old tree never renders with
 * the new session. Both kinds reach `onSessionTreeDiscard`, for state that
 * belongs to the tree but lives above it (toasts).
 */

export type SessionTreeLock = "changed" | "unconfirmed";

interface SessionTreeState {
  readonly epoch: number;
  readonly leaving: boolean;
  /**
   * Ended until the person loads again, and why: another session took the
   * cookie, or the server could not confirm this one. Also for a boundary
   * mounted later.
   */
  readonly locked: SessionTreeLock | null;
}

const initialState: SessionTreeState = {
  epoch: 0,
  leaving: false,
  locked: null,
};
let state = initialState;
const stateListeners = new Set<() => void>();
const discardListeners = new Set<() => void>();

export function subscribeSessionTree(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function sessionTreeState(): SessionTreeState {
  return state;
}

export function serverSessionTreeState(): SessionTreeState {
  return initialState;
}

/**
 * Runs `listener` after every discard of the protected tree, also those
 * the boundary decides. For state above the boundary that the tree filled.
 */
export function onSessionTreeDiscard(listener: () => void): () => void {
  discardListeners.add(listener);
  return () => discardListeners.delete(listener);
}

/** Tells the listeners of onSessionTreeDiscard that the tree went. */
export function announceSessionTreeDiscard(): void {
  for (const listener of discardListeners) listener();
}

/**
 * Discards the protected tree of this document now and keeps it away until
 * the document leaves. Called right before a document navigation that ends
 * the session shown (logout, school switch, another account) and on
 * `pagehide`.
 */
export function discardSessionTree(): void {
  if (state.leaving) return;
  state = { ...state, epoch: state.epoch + 1, leaving: true };
  for (const listener of stateListeners) listener();
  announceSessionTreeDiscard();
}

/**
 * Ends the protected tree of this document until the person loads it
 * again: a boundary mounted later in the same document (a soft navigation
 * back from a page outside the tree) shows the lock too.
 */
export function lockSessionTree(reason: SessionTreeLock): void {
  if (state.locked) return;
  state = { ...state, epoch: state.epoch + 1, locked: reason };
  for (const listener of stateListeners) listener();
}

// Exits of this document's session that run now (a school switch, a
// signout): their own steps are no change to confirm in place; the exit
// navigates.
let exits = 0;

/** Marks an exit of the session as running; the result ends it. */
export function beginSessionExit(): () => void {
  exits += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    exits -= 1;
  };
}

/** Whether an exit of this document's session runs. */
export function sessionExitRunning(): boolean {
  return exits > 0;
}

// Listeners of hideSessionTree.
const hideListeners = new Set<() => void>();

/**
 * Runs `listener` when the tree is hidden for a check (a resumed document):
 * state above it that names the session (toasts) goes, the tree stays.
 */
export function onSessionTreeHidden(listener: () => void): () => void {
  hideListeners.add(listener);
  return () => hideListeners.delete(listener);
}

/** Tells onSessionTreeHidden's listeners that the tree is hidden. */
export function hideSessionTree(): void {
  for (const listener of hideListeners) listener();
}

/**
 * Loads this document again from the server. A page the back-forward cache
 * restored asks the server before anything of it shows.
 */
export function reloadDocument(): void {
  globalThis.location.reload();
}

/** Only for tests: a fresh document. */
export function _resetSessionTreeForTests(): void {
  state = initialState;
  exits = 0;
  for (const listener of stateListeners) listener();
}
