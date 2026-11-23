import "server-only";

/**
 * Drain of one Next.js replica (#7226). On SIGTERM, Next.js closes its
 * listener and waits for the open responses before it exits. An event
 * stream stays open until its client leaves, so the process would wait until
 * the container runtime kills it. The drain ends every open stream cleanly
 * instead: the browser's stream sees EOF and reconnects through the load
 * balancer to another replica. /api/health answers 503 meanwhile.
 *
 * Next.js bundles a module once per route, so the state lives on globalThis:
 * one drain per process, seen by every route bundle.
 */

interface DrainState {
  draining: boolean;
  readonly listeners: Set<() => void>;
  installed: boolean;
}

const STATE_KEY = Symbol.for("moto.process-drain");

function drainState(): DrainState {
  const holder = globalThis as typeof globalThis & {
    [STATE_KEY]?: DrainState;
  };
  holder[STATE_KEY] ??= {
    draining: false,
    listeners: new Set(),
    installed: false,
  };
  return holder[STATE_KEY];
}

/** True once this process started to stop. */
export function isDraining(): boolean {
  return drainState().draining;
}

/**
 * Runs listener when the process starts to stop, at once if it already
 * does. Returns the unsubscribe function.
 */
export function onDrain(listener: () => void): () => void {
  const state = drainState();
  if (state.draining) {
    listener();
    return () => undefined;
  }
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/** Starts the drain; later calls do nothing. */
export function startDrain(): void {
  const state = drainState();
  if (state.draining) return;
  state.draining = true;
  const listeners = [...state.listeners];
  state.listeners.clear();
  for (const listener of listeners) listener();
}

/** Installs the SIGTERM hook once per process, beside Next.js' own. */
export function installProcessDrain(): void {
  const state = drainState();
  if (state.installed) return;
  state.installed = true;
  process.once("SIGTERM", startDrain);
}
