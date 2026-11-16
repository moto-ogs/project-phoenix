"use client";

// Der Hinweis auf ein bekanntes Kind in der Prüfung der Ferienanmeldungen
// (#6683, ADR 0214): Eine Schule des Trägers führt heute genau ein Kind mit
// gleichem Namen und Geburtsdatum. moto verknüpft nichts und zeigt keine
// Daten der Schule, nur ihren Namen. Jeder Abgleich steht im Protokoll, die
// Seite fragt deshalb nur, was sie zeigt.

import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import type { StatusBadgeTone } from "~/components/ui/status-badge";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchHolidayKnownChildren,
  type HolidayRegistrationChild,
} from "~/lib/traeger-holiday-registrations-api";

const NO_KNOWN_CHILDREN: ReadonlyMap<string, string> = new Map();

/** What the screen says about a known child. */
export interface KnownChildView {
  /** The school the parents named is the one that knows the child. */
  readonly sameSchool: boolean;
  readonly schoolName: string;
  readonly tone: StatusBadgeTone;
  readonly label: string;
  readonly title: string;
}

/**
 * The hint of one child; null when no school of the Träger knows it, or
 * when the school is gone from the Träger's list.
 */
export function knownChildView(
  child: HolidayRegistrationChild,
  knownSchoolId: string | undefined,
  names: ReadonlyMap<string, string>,
): KnownChildView | null {
  if (!knownSchoolId) return null;
  const schoolName = names.get(knownSchoolId);
  if (!schoolName) return null;
  if (child.homeSchoolId === knownSchoolId) {
    return {
      sameSchool: true,
      schoolName,
      tone: "green",
      label: "An der Schule bekannt",
      title: `Die Schule „${schoolName}“ führt ein Kind mit gleichem Namen und Geburtsdatum.`,
    };
  }
  return {
    sameSchool: false,
    schoolName,
    // Blue like „Ferienwunsch prüfen“: a check for the office, no warning.
    tone: "blue",
    label: `Bekannt an ${schoolName}`,
    title: `${registeredAs(child)} Die Schule „${schoolName}“ führt ein Kind mit gleichem Namen und Geburtsdatum.`,
  };
}

/** How the parents registered the child, as one sentence. */
function registeredAs(child: HolidayRegistrationChild): string {
  return child.homeSchoolId === null
    ? "Angemeldet als Feriengast."
    : "In der Anmeldung steht eine andere Schule.";
}

/**
 * The names and dates of birth of the children, the only details the
 * comparison depends on: a key that asks again after they changed, and
 * not after every other change of the registration.
 */
export function knownChildrenKey(
  children: readonly HolidayRegistrationChild[] | undefined,
): string {
  return (children ?? [])
    .map(
      (child) =>
        `${child.id}:${child.firstName}:${child.lastName}:${child.birthDate}`,
    )
    .join("|");
}

/**
 * The known children of a period, or of one registration: child ID to
 * school ID. Empty while it loads and when the comparison fails. With
 * `children` (see knownChildrenKey) it waits for the children and asks again
 * when they change.
 */
export function useHolidayKnownChildren(
  periodId: string,
  registrationId?: string,
  children?: string,
): ReadonlyMap<string, string> {
  // Silent on purpose: without the comparison the screen shows no hint.
  const known = useTraegerResource(
    periodId && children !== ""
      ? traegerKeys.holidayKnownChildren(periodId, registrationId, children)
      : null,
    () => fetchHolidayKnownChildren(periodId, registrationId),
    "den Abgleich mit den Schulen",
  ).data;
  return known ?? NO_KNOWN_CHILDREN;
}
