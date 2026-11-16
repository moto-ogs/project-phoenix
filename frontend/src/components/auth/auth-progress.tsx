"use client";

import { EmptyState } from "~/components/ui/empty-state";
import { CheckIcon, SpinnerIcon } from "~/components/ui/icons";
import { ProgressBar } from "~/components/ui/progress-bar";

interface AuthProgressProps {
  /**
   * `checking`: die Seite klärt noch, ob schon jemand angemeldet ist.
   * `redirecting`: die Anmeldung steht, moto öffnet das Ziel.
   */
  readonly state: "checking" | "redirecting";
  readonly title: string;
  readonly description: string;
}

/**
 * Was eine Login-Karte zeigt, solange niemand etwas eingeben muss: erst das
 * Prüfen der Anmeldung, dann die Weiterleitung. Beide Zustände haben denselben
 * Aufbau (Bildfeld, Satz, Balkenzeile), damit die Karte beim Wechsel nicht
 * springt; nur Bild und Balken wechseln. Der Bereich ist eine höfliche
 * Statusmeldung, damit Screenreader den Wechsel vorlesen.
 */
export function AuthProgress({ state, title, description }: AuthProgressProps) {
  const redirecting = state === "redirecting";
  return (
    <output aria-live="polite" data-auth-progress={state} className="block">
      {/* Der Haken steht im grünen Ergebnis-Medaillon; der Spinner steht frei
          in einem gleich großen Feld, damit die Höhe beim Wechsel bleibt. */}
      <EmptyState
        {...(redirecting
          ? { tone: "success" as const, icon: <CheckIcon /> }
          : {
              icon: (
                <span className="flex h-14 w-14 items-center justify-center">
                  <SpinnerIcon className="h-7 w-7 text-gray-400" />
                </span>
              ),
            })}
        title={title}
        description={description}
        // Die Zeile steht in beiden Zuständen, damit die Höhe gleich bleibt.
        progress={
          <div className="h-1 w-28">
            {redirecting ? (
              <ProgressBar indeterminate label={description} size="xs" />
            ) : null}
          </div>
        }
        className="py-6"
      />
    </output>
  );
}
