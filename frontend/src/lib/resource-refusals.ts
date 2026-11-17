/** Refusals indexed by the complete school/account-scoped SWR key. */
const refusals = new Map<string, unknown>();
const refusalListeners = new Set<() => void>();

function announceRefusals() {
  for (const listener of refusalListeners) listener();
}

export function refusalFor(key: string) {
  return refusals.get(key);
}

export function subscribeRefusals(listener: () => void) {
  refusalListeners.add(listener);
  return () => refusalListeners.delete(listener);
}

export function markRefused(key: string, error: unknown) {
  refusals.set(key, error);
  announceRefusals();
}

export function liftRefusal(key: string) {
  if (refusals.delete(key)) announceRefusals();
}

export function liftAllRefusals() {
  if (refusals.size === 0) return;
  refusals.clear();
  announceRefusals();
}
