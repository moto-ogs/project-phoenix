"use client";

import {
  startTransition,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

const subscribe = () => () => undefined;
const clientSnapshot = () => false;
const documentSnapshot = () => true;

/** Keep document markup complete, but let below-the-fold work on a client
 * navigation follow the first commit. The browser can paint and respond to
 * inputs between the primary content and the interruptible second render. */
export function useAfterInitialPaint(): boolean {
  const isDocument = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    documentSnapshot,
  );
  const [ready, setReady] = useState(isDocument);
  useEffect(() => {
    if (ready) return;
    const frame = requestAnimationFrame(() =>
      startTransition(() => setReady(true)),
    );
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready;
}
