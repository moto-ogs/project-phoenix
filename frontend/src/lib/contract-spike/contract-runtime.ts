// Handwritten helpers of the own generator (spike #2342). Variant 1 imports
// them; the generated file holds only shapes.
import { z } from "zod";

const INT64 = /^(0|-?[1-9]\d{0,18})$/;

/** An int64 identifier sent as a JSON string. Kept verbatim. */
export const int64String = z.string().regex(INT64);

/**
 * An int64 identifier an existing route sends as a JSON number. JSON.parse
 * has already rounded anything beyond 2^53, so an unsafe integer fails here
 * instead of naming a different row.
 */
export const legacyInt64 = z.union([
  int64String,
  z
    .number()
    .refine(Number.isSafeInteger, "identifier beyond 2^53 lost precision")
    .transform(String),
]);

/** common.JSONID: number or string on the way in, a string on the way out. */
export const laxInt64 = legacyInt64;

export const safeInt = z
  .number()
  .refine(Number.isSafeInteger, "not a safe integer");

/** calendar.Date: a real day as YYYY-MM-DD. */
export const calendarDate = z.iso.date();

/** time.Time: RFC 3339 with an offset. */
export const instant = z.iso.datetime({ offset: true });

const pagination = z.object({
  current_page: safeInt,
  page_size: safeInt,
  total_pages: safeInt,
  total_records: safeInt,
});

/** common.Response */
export function success<T extends z.ZodType>(data: T) {
  return z.object({
    status: z.literal("success"),
    data,
    message: z.string().optional(),
  });
}

/** common.PaginatedResponse */
export function paginated<T extends z.ZodType>(data: T) {
  return z.object({
    status: z.literal("success"),
    data,
    pagination,
    message: z.string().optional(),
  });
}
