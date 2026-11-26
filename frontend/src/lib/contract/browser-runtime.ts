// Browser-only codecs for the generated SSE and problem details shapes.
// Keep the full Zod route runtime out of the shared portal bundles.
import { isInt64Decimal } from "../compare-ids";
import { isValidISODate } from "../date-helpers";
export type { OpenEnum } from "./runtime";

const invalid = Symbol("invalid wire value");

export interface Decoder<T> {
  read(value: unknown): T | typeof invalid;
  parse(value: unknown): T;
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function decoder<T>(read: Decoder<T>["read"]): Decoder<T> {
  return {
    read,
    parse(value) {
      const data = read(value);
      if (data === invalid) throw new TypeError("Invalid wire value");
      return data;
    },
    safeParse(value) {
      const data = read(value);
      return data === invalid ? { success: false } : { success: true, data };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function object<T>(shape: Record<string, Decoder<unknown>>): Decoder<T> {
  const fields = Object.entries(shape);
  return decoder((value) => {
    if (!isRecord(value)) return invalid;
    const entries: [string, unknown][] = [];
    for (const [key, field] of fields) {
      const data = field.read(
        Object.hasOwn(value, key) ? value[key] : undefined,
      );
      if (data === invalid) return invalid;
      if (data !== undefined) entries.push([key, data]);
    }
    // The generator writes T and every field from the same Go type.
    return Object.fromEntries(entries) as T;
  });
}

const text = (accept: (value: string) => boolean) =>
  decoder((value) =>
    typeof value === "string" && accept(value) ? value : invalid,
  );

export const str = text(() => true);
export const int64String = /*#__PURE__*/ Object.assign(text(isInt64Decimal), {
  orNone: text((value) => value === "" || isInt64Decimal(value)),
});
export const safeInt = decoder((value) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : invalid,
);
export const num = decoder((value) =>
  typeof value === "number" && Number.isFinite(value) ? value : invalid,
);
export const bool = decoder((value) =>
  typeof value === "boolean" ? value : invalid,
);
export const calendarDate = text(isValidISODate);
const rfc3339 =
  /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
export const instant = text(
  (value) => rfc3339.test(value) && isValidISODate(value.slice(0, 10)),
);

export const arr = <T>(item: Decoder<T>): Decoder<T[]> =>
  decoder((value) => {
    if (!Array.isArray(value)) return invalid;
    const items: T[] = [];
    for (const member of value) {
      const data = item.read(member);
      if (data === invalid) return invalid;
      items.push(data);
    }
    return items;
  });

export const rec = <T>(item: Decoder<T>): Decoder<Record<string, T>> =>
  decoder((value) => {
    if (!isRecord(value)) return invalid;
    const entries: [string, T][] = [];
    for (const [key, member] of Object.entries(value)) {
      const data = item.read(member);
      if (data === invalid) return invalid;
      entries.push([key, data]);
    }
    return Object.fromEntries(entries);
  });

export const nullable = <T>(item: Decoder<T>): Decoder<T | null> =>
  decoder((value) => (value === null ? null : item.read(value)));
export const optional = <T>(item: Decoder<T>): Decoder<T | undefined> =>
  decoder((value) => (value === undefined ? undefined : item.read(value)));

export interface PartialResult<T> {
  result: T;
  rejection?: { code: string; details: unknown };
}

/** A PartialError reuses the route's answer and may nest another refusal. */
export function partialResult<T>(
  result: Decoder<T>,
): Decoder<PartialResult<T>> {
  return object<PartialResult<T>>({
    result,
    rejection: optional(
      object({ code: str, details: decoder((value) => value) }),
    ),
  });
}
