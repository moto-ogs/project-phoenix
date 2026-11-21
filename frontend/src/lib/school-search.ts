import { bffJson } from "~/lib/bff-fetch";
import type {
  SchoolSearchRequest,
  SearchResult,
} from "~/lib/contract/search.generated";
import { mapSchoolSearchResult } from "~/lib/school-search-wire";
import type { SchoolSearchResult } from "~/lib/school-search-types";

export type {
  SchoolSearchChild,
  SchoolSearchContact,
  SchoolSearchScope,
  SchoolSearchResult,
} from "~/lib/school-search-types";

/** Shortest query the backend searches; shorter input shows only pages. */
export const SCHOOL_SEARCH_MIN_LENGTH = 2;
/** Longest query the backend accepts. */
export const SCHOOL_SEARCH_MAX_LENGTH = 100;

/**
 * Runs one search through the portal's catalog proxy (#7563) and maps the
 * contract's answer. The query stays in the body.
 */
export async function searchSchool(
  query: string,
  signal?: AbortSignal,
): Promise<SchoolSearchResult> {
  const result = await bffJson<SearchResult>("/api/search", {
    method: "POST",
    body: { query } satisfies SchoolSearchRequest,
    signal,
  });
  return mapSchoolSearchResult(result);
}

/** Fewest digits a phone query keeps after its prefixes go. */
const MIN_PHONE_DIGITS = 4;

// Separators between the digits of a number, as the backend's
// isPhoneSeparator: every Unicode space, every dash, the minus sign and
// + / . ( ).
const PHONE_QUERY = /^[0-9\p{White_Space}\p{Pd}\u2212+/.()]+$/u;

/**
 * The digits a phone query is compared with, or "" when the query is no
 * phone number: the backend's schoolsearchview.PhoneSearchKey, with the same
 * cases in both tests. The text is compacted to digits, plus and brackets
 * without the bracketed trunk zero "(0)"; the key drops the international 00,
 * the German country code 49 of an international number and the German trunk
 * zero. A 49 without + or 00 stays (it may be an area code without its 0); a
 * foreign number keeps its country code. The key needs at least four digits.
 */
export function phoneSearchKey(query: string): string {
  if (!PHONE_QUERY.test(query)) return "";
  const compact = query.replace(/[^0-9+()]/g, "").replaceAll("(0)", "");
  let key = compact.replace(/[^0-9]/g, "");
  const international =
    compact.replace(/^[()]+/, "").startsWith("+") || key.startsWith("00");
  if (key.startsWith("00")) key = key.slice(2);
  if (international && key.startsWith("49")) key = key.slice(2);
  if (!international || key.startsWith("0")) key = key.replace(/^0+/, "");
  return key.length >= MIN_PHONE_DIGITS ? key : "";
}

/**
 * Whether the backend reads the query as a phone number. The dialog uses it
 * to explain a phone search the account cannot run.
 */
export function looksLikePhoneNumber(query: string): boolean {
  return phoneSearchKey(query) !== "";
}

/**
 * A registration question as the label in front of its answer: its own end
 * mark goes, so "Mein Kind darf schwimmen." reads "Mein Kind darf schwimmen:
 * Ja" and "Seepferdchen?" reads "Seepferdchen: Ja".
 */
export function answerQuestionLabel(question: string): string {
  return question.replace(/[\s.:?!]+$/, "");
}
