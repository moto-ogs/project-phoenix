// Shared serialization for generated route addresses, independent of transport.
type ParamNames<S extends string> =
  S extends `${string}{${infer N}}${infer Rest}` ? N | ParamNames<Rest> : never;

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

export type ParamsOf<R> = R extends { pattern: infer T extends string }
  ? [ParamNames<T>] extends [never]
    ? { params?: never }
    : { params: Record<ParamNames<T>, string> }
  : never;

type VariantQuery<R, V> = R extends { variantParam: infer N extends string }
  ? { [key in N]?: V }
  : unknown;

type QueryScalar = {
  string: string;
  id: string;
  // A YYYY-MM-DD string on the wire. Go validates the calendar date.
  date: string;
  int: number;
  bool: boolean;
};

type ScalarOf<Q> = Q extends { values: readonly (infer Value extends string)[] }
  ? Value
  : Q extends { kind: infer Kind extends keyof QueryScalar }
    ? QueryScalar[Kind]
    : never;

export type QueryOf<R, V> = R extends { query: infer Q }
  ? {
      query?: {
        -readonly [
          K in keyof Q as R extends { variantParam: K } ? never : K
        ]?: Q[K] extends { repeated: true }
          ? readonly ScalarOf<Q[K]>[]
          : ScalarOf<Q[K]>;
      } & VariantQuery<R, V>;
    }
  : { query?: never };

export function fillRoutePath(
  pattern: string,
  params: Readonly<Record<string, string>> = {},
): string {
  return pattern.replaceAll(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new Error(`missing path parameter ${name} of ${pattern}`);
    }
    return encodeURIComponent(value);
  });
}

export function routeSearch(
  query?: Readonly<Record<string, QueryValue>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, String(item));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Forward only registered keys, leaving validation and repeated values to Go. */
export function registeredRouteSearch(
  keys: Readonly<Record<string, unknown>>,
  incoming: URLSearchParams,
): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(keys)) {
    for (const value of incoming.getAll(key)) search.append(key, value);
  }
  return search.size ? `?${search.toString()}` : "";
}
