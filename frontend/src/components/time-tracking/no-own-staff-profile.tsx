"use client";

import type { ReactNode } from "react";

import { ButtonLink } from "~/components/ui/button";
import type { PageBodyEmpty } from "~/components/ui/page-body";
import { ApiError } from "~/lib/api-error";
import type { ErrorCode } from "~/lib/error-codes.generated";
import { useHasOwnStaff } from "~/lib/hooks/use-user-context";
import { useTenantAwarePath } from "~/lib/tenant-path";

/**
 * Die Ablehnung der eigenen Zeiten und Termine für eine Person ohne
 * Personalprofil in dieser Schule, etwa über den Träger (#7306).
 */
const NO_OWN_STAFF_PROFILE_CODES: readonly ErrorCode[] = [
  "workforce.no_staff_profile",
  "calendar.no_staff_profile",
];

/** Ist `error` die Ablehnung ohne eigenes Personalprofil? */
function isNoOwnStaffProfile(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code !== undefined &&
    NO_OWN_STAFF_PROFILE_CODES.includes(error.code)
  );
}

/**
 * Der Leerzustand der Seiten „Zeiterfassung“, „Mein Dienstplan“ und „Mein
 * Kalender“ ohne eigenes Personalprofil: statt Fehler oder Umleitung ein
 * Hinweis mit dem Weg zur Startseite. `null`, solange die Person ein Profil
 * hat und keine Ablehnung kam; der Kontext entscheidet vor dem ersten Abruf,
 * die Ablehnung danach (`errors`).
 */
export function useNoOwnStaffProfileEmpty(
  icon: ReactNode,
  errors: readonly unknown[] = [],
): PageBodyEmpty {
  const hasOwnStaff = useHasOwnStaff();
  const tenantPath = useTenantAwarePath();
  if (hasOwnStaff && !errors.some(isNoOwnStaffProfile)) return null;
  return {
    icon,
    title: "Kein eigenes Personalprofil",
    description:
      "Diese Seite zeigt Ihre eigenen Zeiten und Termine. Dafür brauchen Sie in dieser Schule ein Personalprofil. Die Leitung kann es anlegen.",
    action: (
      <ButtonLink
        href={tenantPath("/home")}
        variant="outline"
        size="md"
        tooltip="Öffnet die Startseite von moto."
      >
        Zur Startseite
      </ButtonLink>
    ),
  };
}
