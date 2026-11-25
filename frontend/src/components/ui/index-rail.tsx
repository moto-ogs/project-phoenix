"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { cn } from "~/lib/utils";
import { FIXED_LAYER_SHIFT } from "./hooks/useFixedLayersFollowViewport";
import { Z_LAYER } from "./overlay-styles";

/**
 * Buchstaben-Sprungleiste am rechten Rand einer langen, alphabetisch
 * gruppierten Liste (#8070). Tippen oder Ziehen springt zur Gruppe; eine
 * Blase zeigt den Buchstaben unter dem Finger.
 *
 * Eine reine Finger-Abkürzung: Vorleseprogramme und Tastatur springen über
 * die Gruppenköpfe (Überschriften), darum ist die Leiste `aria-hidden`.
 * Sichtbar ist sie 20 px breit, ihre Fläche reicht 28 px weit. Sie steht
 * innen am rechten Rand der Listenkarte (Seitenrand 16 px), oben unter der
 * Such- und Filterleiste, auf jedem Telefon an derselben Stelle.
 *
 * Wie ein Schnell-Scroller erscheint sie, sobald die Liste rollt, und
 * verschwindet kurz danach wieder: In Ruhe hat die Liste rechts denselben
 * Rand wie links, und kein Abzeichen liegt unter der Leiste.
 */
/** So lange bleibt die Leiste nach dem letzten Rollen sichtbar, wie die Scroll-Anzeige des Systems. */
const RAIL_LINGER_MS = 700;

export function IndexRail({
  letters,
  onJump,
}: Readonly<{
  /** Die Buchstaben der vorhandenen Gruppen, in Listenreihenfolge. */
  letters: readonly string[];
  /** Springt zur Gruppe mit diesem Index. */
  onJump: (index: number) => void;
}>) {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setScrolling(true);
      clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), RAIL_LINGER_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);
  const shown = scrolling || active !== null;

  const pick = (clientY: number) => {
    const node = railRef.current;
    if (!node || letters.length === 0) return;
    const rect = node.getBoundingClientRect();
    const ratio = (clientY - rect.top) / Math.max(1, rect.height);
    const index = Math.min(
      letters.length - 1,
      Math.max(0, Math.floor(ratio * letters.length)),
    );
    setActive(index);
    if (last.current !== index) {
      last.current = index;
      onJump(index);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    last.current = null;
    pick(event.clientY);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (active === null) return;
    pick(event.clientY);
  };
  const end = () => {
    setActive(null);
    last.current = null;
  };

  if (letters.length < 2) return null;
  return (
    <div
      aria-hidden="true"
      data-index-rail=""
      data-shown={shown ? "" : undefined}
      className={cn(
        `fixed right-4 ${Z_LAYER.raised} ${FIXED_LAYER_SHIFT} flex w-7 touch-none items-start justify-end transition-opacity duration-200 select-none motion-reduce:transition-none`,
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{
        // Nie über der Such- und Filterleiste, auch solange die Seite oben steht.
        top: "max(calc(var(--app-sticky-offset, 1rem) + 0.5rem), 9.5rem)",
        bottom:
          "calc(env(safe-area-inset-bottom) + 6.5rem + var(--app-action-bar-space, 0px))",
      }}
    >
      <div
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        className="flex max-h-full w-7 flex-col items-center justify-start py-1 pr-1"
      >
        <div className="flex w-5 flex-col items-center rounded-full bg-white/85 py-1 shadow-sm ring-1 ring-gray-200">
          {letters.map((letter, index) => (
            <span
              key={letter}
              className={cn(
                "flex h-4 w-5 items-center justify-center text-xs leading-none font-semibold",
                index === active ? "text-gray-900" : "text-gray-500",
              )}
            >
              {letter}
            </span>
          ))}
        </div>
      </div>
      {active !== null ? (
        <span className="pointer-events-none absolute top-1/2 right-12 flex size-16 -translate-y-1/2 items-center justify-center rounded-2xl bg-gray-900/85 text-3xl font-semibold text-white">
          {letters[active]}
        </span>
      ) : null}
    </div>
  );
}
