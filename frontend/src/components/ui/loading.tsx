// components/ui/loading.tsx
// Neutral loading state for guards and token flows where the future layout is
// unknown. Pages with a known shape use colocated skeletons instead.

"use client";

import { cn } from "~/lib/utils";
import { Z_LAYER } from "./overlay-styles";
import { SpinnerIcon } from "~/components/ui/icons";

interface LoadingProps {
  readonly message?: string;
  /** Deckt den ganzen Bildschirm ab; nur für Guards und Seiten ohne Gerüst. */
  readonly fullPage?: boolean;
  /** Kompakte Zeile für einen begrenzten Bereich wie einen Picker. */
  readonly compact?: boolean;
  readonly className?: string;
}

export function Loading({
  message = "Lädt...",
  fullPage = false,
  compact = false,
  className,
}: LoadingProps) {
  const containerClasses =
    fullPage && !compact
      ? // Ruhige, deckende Fläche im Grau der Portale statt Milchglas: dahinter steht noch nichts,
        // was durchscheinen sollte. Sie erscheint erst nach einem kurzen
        // Moment (`moto-loading-delayed`): Ein schnelles Neuladen zeigt so
        // keinen weißen Zwischenschirm, der Browser hält die alte Seite, bis
        // die neue steht.
        `moto-loading-delayed fixed inset-0 flex items-center justify-center bg-gray-50 px-4 ${Z_LAYER.sheet}`
      : compact
        ? "flex min-h-0 items-center justify-center py-3"
        : "flex min-h-40 items-center justify-center py-8";

  return (
    <output
      className={cn(containerClasses, className)}
      aria-label={message}
      aria-live="polite"
      aria-busy="true"
    >
      {compact ? (
        <div className="flex items-center gap-3 text-gray-600">
          <SpinnerIcon className="h-6 w-6" />
          <span className="text-sm font-medium">{message}</span>
        </div>
      ) : (
        // In einer Fläche oder über die ganze Seite steht der Satz mittig unter
        // dem Spinner, wie in den Login-Karten; eine Zeile daneben wirkt dort
        // verloren.
        <div className="flex flex-col items-center gap-4 text-center">
          <SpinnerIcon className="h-7 w-7 text-gray-400" />
          <span className="text-sm font-medium text-gray-600">{message}</span>
        </div>
      )}
    </output>
  );
}
