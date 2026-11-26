"use client";

import {
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import {
  CareFacilityTermScopeContext as CareFacilityTermContext,
  type CareFacilityTermScopeValue as ScopeValue,
} from "~/lib/care-facility-term-context";
import {
  careTermValuesOf,
  type CareTermValues,
} from "~/lib/care-facility-term-value";
import { useTenantSafe } from "~/lib/tenant-context";

export { normalizeCareFacilityTerm } from "~/lib/care-facility-term-value";

const DEFAULT_CARE = careTermValuesOf(undefined);

/**
 * A page part whose school is not the tenant in context: the token status
 * page on the parents host, the embedded parent form, the edit form. It holds
 * the term a response named; `useProvideCareFacilityTerm` fills it in once
 * the response arrived. `article` is the school's article for an own name
 * (#8136); `care` takes values that are already declined, such as those of
 * an account with several schools.
 */
export function CareFacilityTermScope({
  term,
  article,
  care,
  children,
}: {
  readonly term?: string;
  readonly article?: string;
  readonly care?: CareTermValues;
  readonly children: ReactNode;
}) {
  const [reported, setCare] = useState<CareTermValues | undefined>(undefined);
  const own = useMemo(
    () =>
      care ??
      (term === undefined ? undefined : careTermValuesOf(term, article)),
    [care, term, article],
  );
  const value = useMemo<ScopeValue>(
    () => ({ care: reported ?? own, setCare }),
    [reported, own],
  );
  return (
    <CareFacilityTermContext.Provider value={value}>
      {children}
    </CareFacilityTermContext.Provider>
  );
}

/** Reports the term a loaded response carries to the surrounding scope. */
export function useProvideCareFacilityTerm(
  term: string | undefined,
  article?: string,
): void {
  const scope = useContext(CareFacilityTermContext);
  const setCare = scope?.setCare;
  useEffect(() => {
    if (term !== undefined) setCare?.(careTermValuesOf(term, article));
  }, [setCare, term, article]);
}

/**
 * The declined term for the texts in view: the scope's school first, then
 * the tenant in context, else „die OGS“ (a page that knows no school yet,
 * such as an invalid status link).
 */
export function useCareTermValues(): CareTermValues {
  const scope = useContext(CareFacilityTermContext);
  const tenant = useTenantSafe()?.tenant;
  const tenantTerm = tenant?.careFacilityTerm;
  const tenantArticle = tenant?.careFacilityArticle;
  const tenantCare = useMemo(
    () =>
      tenantTerm === undefined
        ? DEFAULT_CARE
        : careTermValuesOf(tenantTerm, tenantArticle),
    [tenantTerm, tenantArticle],
  );
  return scope?.care ?? tenantCare;
}

/** The bare term for the texts in view; see `useCareTermValues`. */
export function useCareFacilityTerm(): string {
  return useCareTermValues().careTerm;
}

type Translator = ReturnType<typeof useTranslations>;
type Namespace = NonNullable<Parameters<typeof useTranslations>[0]>;
type TranslationValues = Record<string, unknown> | undefined;

/**
 * `useTranslations` with the school's term as the `{careTerm}` value of
 * every message, and its declined forms (`{careNom}`, `{careAcc}`, …) for
 * the German ones. A value the caller passes keeps its own content; messages
 * without the placeholders ignore them. Each render keeps its own term, so
 * suspended or discarded renders cannot change committed translations.
 */
export function useCareTermTranslations<N extends Namespace>(
  namespace: N,
  /** A term the caller knows better than the scope, such as the school of one loaded record. */
  term?: string | CareTermValues,
): ReturnType<typeof useTranslations<N>> {
  const t = useTranslations(namespace);
  const scopeCare = useCareTermValues();
  const care = useMemo(
    () =>
      term === undefined
        ? scopeCare
        : typeof term === "string"
          ? careTermValuesOf(term)
          : term,
    [term, scopeCare],
  );
  return useMemo(
    () =>
      withCareTerm(t as unknown as Translator, care) as unknown as ReturnType<
        typeof useTranslations<N>
      >,
    [t, care],
  );
}

function withCareTerm(t: Translator, care: CareTermValues): Translator {
  const merge = (values: TranslationValues) => ({
    ...care,
    ...values,
  });
  // The translator's overloads are typed per key; the wrapper forwards the
  // same arguments with one more value, so it keeps the original type.
  const call = t as unknown as (...args: unknown[]) => unknown;
  const source = t as unknown as Record<
    "rich" | "markup" | "raw" | "has",
    (...args: unknown[]) => unknown
  >;
  const wrapped = (
    key: unknown,
    values?: TranslationValues,
    formats?: unknown,
  ) => call(key, merge(values), formats);
  Object.assign(wrapped, {
    rich: (key: unknown, values?: TranslationValues, formats?: unknown) =>
      source.rich(key, merge(values), formats),
    markup: (key: unknown, values?: TranslationValues, formats?: unknown) =>
      source.markup(key, merge(values), formats),
    raw: (key: unknown) => source.raw(key),
    has: (key: unknown) => source.has(key),
  });
  return wrapped as unknown as Translator;
}
