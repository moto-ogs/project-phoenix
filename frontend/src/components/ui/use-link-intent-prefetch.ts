"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { isInternalPath } from "./navigation-url";

/**
 * So lange muss die Maus auf dem Link bleiben, bevor er vorlädt. Wer mit der
 * Maus nur über die Seitenleiste fährt, löst damit nichts aus (#4987).
 */
export const HOVER_PREFETCH_DELAY_MS = 80;

type IntentPrefetchProps = Pick<
  ComponentProps<"a">,
  "target" | "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur"
> & {
  readonly href: string;
  readonly prefetch?: boolean | "auto" | null;
};

/** Shared intent policy, without portal progress or router dependencies. */
export function useLinkIntentPrefetch({
  href,
  target,
  prefetch: allowed,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
}: IntentPrefetchProps) {
  const [intent, setIntent] = useState({ href, target, prefetch: false });
  const sameDestination = intent.href === href && intent.target === target;
  const prefetch = sameDestination && intent.prefetch;
  // Reset before rendering next/link so a reused link never inherits intent.
  if (!sameDestination) setIntent({ href, target, prefetch: false });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canPrefetch =
    allowed !== false && target !== "_blank" && isInternalPath(href);

  const cancelHover = () => {
    if (hoverTimer.current === null) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => cancelHover, [href, target, allowed]);

  const startPrefetch = () => {
    cancelHover();
    if (canPrefetch) {
      setIntent({ href, target, prefetch: true });
    }
  };

  return {
    prefetch: prefetch && canPrefetch,
    onPointerEnter: (event: PointerEvent<HTMLAnchorElement>) => {
      onPointerEnter?.(event);
      if (event.defaultPrevented || !canPrefetch) return;
      if (prefetch || event.pointerType === "touch") return;
      cancelHover();
      hoverTimer.current = setTimeout(startPrefetch, HOVER_PREFETCH_DELAY_MS);
    },
    onPointerLeave: (event: PointerEvent<HTMLAnchorElement>) => {
      onPointerLeave?.(event);
      cancelHover();
    },
    onBlur: (event: FocusEvent<HTMLAnchorElement>) => {
      onBlur?.(event);
      cancelHover();
    },
    onFocus: (event: FocusEvent<HTMLAnchorElement>) => {
      onFocus?.(event);
      if (event.defaultPrevented) return;
      startPrefetch();
    },
  };
}
