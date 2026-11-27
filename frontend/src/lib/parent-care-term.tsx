"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  CareFacilityTermScope,
  useCareTermValues,
} from "~/lib/care-facility-term";
import {
  careFacilityName,
  careTermValues,
  careTermValuesOf,
  type CareFacilityName,
  type CareTermValues,
} from "~/lib/care-facility-term-value";
import {
  useParentChildren,
  useParentFeatures,
} from "~/lib/hooks/use-parent-resources";

interface ParentCareTerms {
  /** The declined term for texts without a child (#8136). */
  readonly accountCare: CareTermValues | undefined;
  /** The declined term of one child's school, else the account's. */
  readonly careForChild: (
    studentId: string | undefined,
  ) => CareTermValues | undefined;
  /** The declined term of one school, else the account's. */
  readonly careForSchool: (
    schoolName: string | undefined,
  ) => CareTermValues | undefined;
  /** Every care placeholder for one child's row: spread it into the values. */
  readonly valuesOf: (studentId: string | undefined) => CareTermValues;
  /** Every care placeholder for a row that names a school. */
  readonly valuesOfSchool: (schoolName: string | undefined) => CareTermValues;
}

const DEFAULT_CARE = careTermValuesOf(undefined);

/** Outside the parents shell no school is known: every text says „OGS“. */
const NO_TERMS: ParentCareTerms = {
  accountCare: undefined,
  careForChild: () => undefined,
  careForSchool: () => undefined,
  valuesOf: () => DEFAULT_CARE,
  valuesOfSchool: () => DEFAULT_CARE,
};

const ParentCareTermsContext = createContext<ParentCareTerms>(NO_TERMS);

/**
 * The care term of every linked child, from the child features the shell
 * already loads for each child (same cache entry, no extra request).
 */
function useLoadedParentCareTerms(enabled: boolean): ParentCareTerms {
  const { data: children } = useParentChildren(enabled);
  const { data: features } = useParentFeatures(enabled ? children : undefined);
  return useMemo(() => {
    const byChild = new Map<string, CareTermValues>();
    const bySchool = new Map<string, CareTermValues>();
    const names: CareFacilityName[] = [];
    for (const child of children ?? []) {
      const childFeatures = features?.[child.student_id];
      const term = childFeatures?.care_facility_term;
      if (term === undefined) continue;
      const name = careFacilityName(term, childFeatures?.care_facility_article);
      const care = careTermValues(name);
      names.push(name);
      byChild.set(child.student_id, care);
      bySchool.set(child.school_name, care);
    }
    // Every form names each school once: „die OGS/der Hort“ (#6082, #8136).
    const accountCare = names.length > 0 ? careTermValues(names) : undefined;
    const careForChild = (studentId: string | undefined) =>
      (studentId === undefined ? undefined : byChild.get(studentId)) ??
      accountCare;
    const careForSchool = (schoolName: string | undefined) =>
      (schoolName === undefined ? undefined : bySchool.get(schoolName)) ??
      accountCare;
    const valuesOf = (studentId: string | undefined) =>
      careForChild(studentId) ?? DEFAULT_CARE;
    const valuesOfSchool = (schoolName: string | undefined) =>
      careForSchool(schoolName) ?? DEFAULT_CARE;
    return {
      accountCare,
      careForChild,
      careForSchool,
      valuesOf,
      valuesOfSchool,
    };
  }, [children, features]);
}

/** The care terms the parents shell loaded, for rows of several children. */
export function useParentCareTerms(): ParentCareTerms {
  return useContext(ParentCareTermsContext);
}

/**
 * Loads the care terms once for the parents shell and gives every text
 * inside the account's term.
 */
export function ParentCareTermScope({
  enabled,
  children,
}: {
  readonly enabled: boolean;
  readonly children: ReactNode;
}) {
  const terms = useLoadedParentCareTerms(enabled);
  return (
    <ParentCareTermsContext.Provider value={terms}>
      <CareFacilityTermScope care={terms.accountCare}>
        {children}
      </CareFacilityTermScope>
    </ParentCareTermsContext.Provider>
  );
}

/**
 * Gives every text inside the care term of one child's school. Until the
 * term loaded it keeps the inherited one; the provider stays mounted, so a
 * late term never remounts the subtree (an unsent draft survives).
 */
export function ParentChildCareTermScope({
  studentId,
  children,
}: {
  readonly studentId: string | undefined;
  readonly children: ReactNode;
}) {
  const inherited = useCareTermValues();
  const care = useParentCareTerms().careForChild(studentId) ?? inherited;
  return <CareFacilityTermScope care={care}>{children}</CareFacilityTermScope>;
}

/**
 * Gives every text inside the care term of one school, for a part that
 * belongs to a school rather than a child: a parent letter and the refusals
 * of its answer (#6258). Until the term loaded it keeps the inherited one.
 */
export function ParentSchoolCareTermScope({
  schoolName,
  children,
}: {
  readonly schoolName: string | undefined;
  readonly children: ReactNode;
}) {
  const inherited = useCareTermValues();
  const care = useParentCareTerms().careForSchool(schoolName) ?? inherited;
  return <CareFacilityTermScope care={care}>{children}</CareFacilityTermScope>;
}
