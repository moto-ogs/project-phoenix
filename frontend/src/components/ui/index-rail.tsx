"use client";

import { useRef, useState, type PointerEvent } from "react";

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
 * Sichtbar ist sie 20 px breit, ihre Fläche reicht 28 px weit.
 */
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
      className={`fixed right-0 ${Z_LAYER.raised} ${FIXED_LAYER_SHIFT} flex w-7 touch-none items-center justify-end select-none`}
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
        className="flex max-h-full w-7 flex-col items-center justify-center py-1 pr-1"
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
