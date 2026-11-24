// Handwritten helpers of the generated contract (ADR 0270). The files
// `*.generated.ts` next to this one hold only shapes and import from here.
import { z } from "zod";

const INT64 = /^(0|-?[1-9]\d{0,18})$/;

/** An int64 identifier sent as a JSON string. Kept verbatim, never a number. */
export const int64String = z.string().regex(INT64);

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

export { knownEnum } from "./known-enum";

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

/** The page of a paginated list (`common.Pagination`). */
export type Pagination = z.infer<typeof pagination>;

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

/**
 * A value decoder inside a generated shape. The interface next to the shape
 * says what the value is, so these helpers hand the type checker no types to
 * derive (see `object`).
 */
type Field = z.ZodType<unknown, unknown>;

export const str: Field = z.string();
export const bool: Field = z.boolean();
export const num: Field = z.number();
export const json: Field = z.unknown();
// The Go field names the typed form and documents why historical values
// must still travel. An open fallback is JSON, not an unchecked JS value.
const historicalJSON = z.json();
export type LegacyJSON = z.output<typeof historicalJSON>;
export const legacyJSON = (current: Field): Field =>
  // Keep the original value: a current object decoder can accept a
  // historical row but strip keys the review screen still displays.
  z.custom(
    (raw) =>
      current.safeParse(raw).success || historicalJSON.safeParse(raw).success,
  );
export const arr = (item: Field): Field => z.array(item);
export const rec = (value: Field): Field => z.record(z.string(), value);
export const nullable = (value: Field): Field => value.nullable();
export const optional = (value: Field): Field => value.optional();
/** A schema of the same file that is declared further down (a cycle). */
export const lazy = (schema: () => Field): Field => z.lazy(schema);

/** common.Response */
export function success<T>(
  data: z.ZodType<T, unknown>,
): z.ZodType<{ status: "success"; data: T }, unknown> {
  return z.object({ status: z.literal("success"), data });
}

/**
 * A route that answers no data: a 204, which the backend client reads as
 * undefined, or the envelope without a data member. The catalog proxy
 * answers it as `{ status: "success", data: null }`, a DELETE as 204.
 */
export const noData = z
  .union([
    z.undefined(),
    z.object({ status: z.literal("success"), data: z.null().optional() }),
  ])
  .transform(() => ({ status: "success" as const, data: null }));

/**
 * A route that answers a file (`File` in the Go registration): the proxy
 * streams the bytes with their file headers and decodes nothing.
 */
export const fileAnswer = { kind: "file" } as const;

/**
 * A route that takes a multipart/form-data upload (`Multipart`): the proxy
 * streams the body to the backend within the route's `maxBodyBytes`.
 */
export const multipart = { kind: "multipart" } as const;

/** common.PaginatedResponse */
export function paginated<T>(
  data: z.ZodType<T, unknown>,
): z.ZodType<
  { status: "success"; data: T; pagination: z.output<typeof pagination> },
  unknown
> {
  return z.object({ status: z.literal("success"), data, pagination });
}
