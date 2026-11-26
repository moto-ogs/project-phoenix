import type { Session } from "next-auth";
import { hasPermission, isAdmin } from "~/lib/auth-utils";

/**
 * Wer den ganzen Betreuungsplan als eigene Seite hat (#8134).
 *
 * Der Plan sagt, wer aus dem Team wann wo ist. Lesen darf ihn deshalb, wer
 * den Plan UND das Team sieht: `schedules:read` ist das Gate der Leserouten,
 * `users:read` das des Personals. Die AG-Leitung (ADR 0091) hält nur
 * `schedules:read`; für ihre Termine hat sie „Heute“ und bekommt den
 * schulweiten Plan nicht in die Leiste.
 *
 * Seitenleiste, Mehr-Menü, Suche und die Karte „Betreuungsplan heute“ lesen
 * dieselbe Regel von hier.
 */
const CARE_PLAN_READ_PERMISSIONS = ["schedules:read", "users:read"] as const;

/**
 * Wer plant, hat den Eintrag immer: bis #8134 hing er allein an diesem Recht,
 * und eine Leitungsrolle der Schule (#3469) soll ihn nicht verlieren.
 */
const CARE_PLAN_MANAGE_PERMISSION = "schedules:manage";

/** Ob die Person den Betreuungsplan als Seite öffnet (Plan oder Leseansicht). */
export function canOpenCarePlan(session: Session | null): boolean {
  return (
    isAdmin(session) ||
    hasPermission(session, CARE_PLAN_MANAGE_PERMISSION) ||
    CARE_PLAN_READ_PERMISSIONS.every((permission) =>
      hasPermission(session, permission),
    )
  );
}
