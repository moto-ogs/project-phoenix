"use client";

import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

const subscribe = () => () => undefined;
const clientSnapshot = () => false;
const documentSnapshot = () => true;
const noViewport = () => null;

let viewport: Readonly<{ width: number; height: number }> | null = null;

function browserViewport() {
  const { innerWidth: width, innerHeight: height } = window;
  if (viewport?.width !== width || viewport.height !== height) {
    viewport = { width, height };
  }
  return viewport;
}

/** Keep document markup complete, but let below-the-fold work on a client
 * navigation follow the first commit. The browser can paint and respond to
 * inputs between the primary content and the interruptible second render. */
export function useAfterInitialPaint(restageWhenHidden = false): boolean {
  const isDocument = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    documentSnapshot,
  );
  const [ready, setReady] = useState(isDocument);
  useLayoutEffect(() => {
    if (!restageWhenHidden) return;
    // Activity disconnects layout effects while hiding the page. Prepare the
    // next reveal while there is no roster to lay out on screen.
    return () => setReady(false);
  }, [restageWhenHidden]);
  useEffect(() => {
    if (ready) return;
    // Effects from a navigation can run before its paint. The first frame
    // gives the browser a chance to paint before scheduling the remaining work.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        startTransition(() => setReady(true)),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return ready;
}

/** Layout bounds only for the opening render of a client navigation. */
export function useInitialPaintViewport(restageWhenHidden = false) {
  const ready = useAfterInitialPaint(restageWhenHidden);
  return useSyncExternalStore(
    subscribe,
    ready ? noViewport : browserViewport,
    noViewport,
  );
}
