"use client";

import { createContext, useContext } from "react";
import {
  careTermValuesOf,
  type CareTermValues,
} from "~/lib/care-facility-term-value";

export interface CareFacilityTermScopeValue {
  /** The declined name of the scope's school, undefined while unknown. */
  readonly care: CareTermValues | undefined;
  readonly setCare: (care: CareTermValues | undefined) => void;
}

/** The term of a page part's own school (`CareFacilityTermScope`). */
export const CareFacilityTermScopeContext =
  createContext<CareFacilityTermScopeValue | null>(null);

/**
 * The declined term of the tenant in context, set by `TenantProvider`. Code
 * on the shared error path reads it here, so the toast provider every portal
 * mounts does not import the tenant context (#6258).
 */
export const TenantCareFacilityTermContext = createContext<
  CareTermValues | undefined
>(undefined);

const DEFAULT_CARE = careTermValuesOf(undefined);

/**
 * The declined term for an error text (#6258, #8136): the scope's school
 * first, then the tenant in context, else „die OGS“. Same order as
 * `useCareFacilityTerm`.
 */
export function useErrorCareTermValues(): CareTermValues {
  const scope = useContext(CareFacilityTermScopeContext);
  const tenantCare = useContext(TenantCareFacilityTermContext);
  return scope?.care ?? tenantCare ?? DEFAULT_CARE;
}
