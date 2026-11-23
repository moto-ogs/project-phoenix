"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Whether a chat's writing field (`MessageComposer`) is on screen (#7686).
 *
 * Floating helpers in the bottom corner (the parents' „Erste Schritte“, the
 * school setup checklist) sit exactly where a chat puts its send button. They
 * yield while a composer is mounted, whatever page or portal shows the chat:
 * the composer announces itself, so no route list has to know every chat.
 */
let mountedComposers = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const composerOnScreen = () => mountedComposers > 0;
const noComposerOnServer = () => false;

/**
 * Registers a mounted composer for as long as it stays mounted. A layout
 * effect, so a helper already on screen re-renders before the chat paints.
 */
export function useAnnounceMessageComposer(): void {
  useLayoutEffect(() => {
    mountedComposers += 1;
    notify();
    return () => {
      mountedComposers -= 1;
      notify();
    };
  }, []);
}

/** True while at least one chat composer is mounted. */
export function useMessageComposerOnScreen(): boolean {
  return useSyncExternalStore(subscribe, composerOnScreen, noComposerOnServer);
}
