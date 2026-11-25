"use client";

// Schnellaktion der Kindakte, die von außen angefordert wird (#8070): Das
// Kind-Blatt der Liste führt mit `?aktion=krank` in die Akte, die Akte öffnet
// dort denselben Dialog wie ihre Kachel. So gibt es die Aktion nur einmal,
// mit ihren Rückfragen, Rechten und Fehlerwegen.

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export const STUDENT_QUICK_ACTION_PARAM = "aktion";

const STUDENT_QUICK_ACTIONS = [
  "abmelden",
  "anmelden",
  "krank",
  "entschuldigen",
] as const;

export type StudentQuickAction = (typeof STUDENT_QUICK_ACTIONS)[number];

export function isStudentQuickAction(
  value: string,
): value is StudentQuickAction {
  return (STUDENT_QUICK_ACTIONS as readonly string[]).includes(value);
}

/** Adresse der Akte, die eine Schnellaktion gleich öffnet. */
export function studentQuickActionHref(
  studentHref: string,
  action: StudentQuickAction,
): string {
  const separator = studentHref.includes("?") ? "&" : "?";
  return `${studentHref}${separator}${STUDENT_QUICK_ACTION_PARAM}=${action}`;
}

/**
 * Führt die angeforderte Aktion einmal aus und nimmt den Parameter aus der
 * Adresse, damit Neuladen oder Zurück den Dialog nicht erneut öffnet. Fehlt
 * das Recht (`run[action]` leer), passiert nichts außer dem Aufräumen.
 */
export function RequestedQuickAction({
  action,
  run,
}: Readonly<{
  action: StudentQuickAction;
  run: Partial<Record<StudentQuickAction, (() => void) | undefined>>;
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const done = useRef(false);
  const handler = run[action];
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    handler?.();
    const query = new URLSearchParams(searchParams.toString());
    query.delete(STUDENT_QUICK_ACTION_PARAM);
    const qs = query.toString();
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `${pathname}?${qs}` : pathname,
    );
  }, [handler, pathname, searchParams]);
  return null;
}
