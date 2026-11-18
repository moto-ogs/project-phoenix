// Handwritten helpers of the generated contract (ADR 0270). The files
// `*.generated.ts` next to this one hold only shapes and import from here.
import { z } from "zod";

const INT64 = /^(0|-?[1-9]\d{0,18})$/;

/** An int64 identifier sent as a JSON string. Kept verbatim, never a number. */
export const int64String = z.string().regex(INT64);

/**
 * An identifier that a route sends as a JSON number today and as a string
 * one release later. JSON.parse has already rounded a number beyond 2^53, so
 * an unsafe integer fails here instead of naming a different row.
 */
export const int64StringOrNumber = z.union([
  int64String,
  z
    .number()
    .refine(Number.isSafeInteger, "identifier beyond 2^53 lost precision")
    .transform(String),
]);

export const safeInt = z.number().refine(Number.isSafeInteger);

/** calendar.Date: a real day as YYYY-MM-DD. */
export const calendarDate = z.iso.date();

/** A wall-clock time of the school day as HH:MM. */
export const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** time.Time: RFC 3339 with an offset, as Go writes a Berlin time. */
export const instant = z.iso.datetime({ offset: true });

/**
 * A registered enum. The type names the values this build knows; the decoder
 * takes any string, because a value Go adds later must not break a frontend
 * that is one release behind.
 */
export type OpenEnum<T extends string> = T | (string & {});

export function openEnum<T extends string>() {
  return z.string() as unknown as z.ZodType<OpenEnum<T>, unknown>;
}

/** Narrows an open enum to the values this build knows. */
export function knownEnum<T extends string>(
  values: readonly T[],
  value: string | undefined,
): T | undefined {
  return values.find((known) => known === value);
}

/**
 * The body a registered route binds. It carries no value: the route entry
 * names the type so that the client can check what it sends. Go checks the
 * body itself (`Bind`) and answers a refusal through the error contract.
 */
export interface RequestBody<T> {
  readonly body?: T;
}

export function requestBody<T>(): RequestBody<T> {
  return {};
}

const pagination = z.object({
  current_page: safeInt,
  page_size: safeInt,
  total_pages: safeInt,
  total_records: safeInt,
});

/**
 * z.object for a generated schema. The generator writes the interface and
 * the shape from one model, so the type checker is handed the interface
 * instead of deriving it from the shape: deriving every object type of the
 * contract cost the build more than a gigabyte of memory (#2352).
 */
export function object<T>(
  shape: Record<string, z.ZodType<unknown, unknown>>,
): z.ZodType<T, unknown> {
  return z.object(shape) as unknown as z.ZodType<T, unknown>;
}

/** common.Response */
export function success<T>(
  data: z.ZodType<T, unknown>,
): z.ZodType<{ status: "success"; data: T }, unknown> {
  return z.object({ status: z.literal("success"), data });
}

/**
 * A route that answers no data: a 204, which the backend client reads as
 * undefined, or the envelope without a data member.
 */
export const noData = z
  .union([
    z.undefined(),
    z.object({ status: z.literal("success"), data: z.null().optional() }),
  ])
  .transform(() => ({ data: null }));

/** common.PaginatedResponse */
export function paginated<T>(
  data: z.ZodType<T, unknown>,
): z.ZodType<
  { status: "success"; data: T; pagination: z.output<typeof pagination> },
  unknown
> {
  return z.object({ status: z.literal("success"), data, pagination });
}
