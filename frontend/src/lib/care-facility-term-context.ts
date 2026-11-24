"use client";

import { createContext, useContext } from "react";
import { normalizeCareFacilityTerm } from "~/lib/care-facility-term-value";

export interface CareFacilityTermScopeValue {
  readonly term: string | undefined;
  readonly setTerm: (term: string | undefined) => void;
}

/** The term of a page part's own school (`CareFacilityTermScope`). */
export const CareFacilityTermScopeContext =
  createContext<CareFacilityTermScopeValue | null>(null);

/**
 * The term of the tenant in context, set by `TenantProvider`. Code on the
 * shared error path reads it here, so the toast provider every portal mounts
 * does not import the tenant context (#6258).
 */
export const TenantCareFacilityTermContext = createContext<string | undefined>(
  undefined,
);

/**
 * The term for an error text (#6258): the scope's school first, then the
 * tenant in context, else „OGS“. Same order as `useCareFacilityTerm`.
 */
export function useErrorCareFacilityTerm(): string {
  const scope = useContext(CareFacilityTermScopeContext);
  const tenantTerm = useContext(TenantCareFacilityTermContext);
  return normalizeCareFacilityTerm(scope?.term ?? tenantTerm);
}
