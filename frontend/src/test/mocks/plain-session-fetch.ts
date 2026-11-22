// A session-cache module for client tests that stub `fetch`: sessionFetch
// sends straight through transportFetch, without the session gate and its
// renewal (sessionFetch's own tests cover those). A case may stub plain
// answer objects ({ ok, status, headers, json }); they go on as Responses.
//
//   vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));
//
// Portals without a session (public, school, ...) send through transportFetch
// directly; a test of such a call replaces it with `plainTransportFetch`.
import { transportFetch } from "~/lib/api-error";

interface PlainAnswer {
  ok: boolean;
  status?: number;
  headers?: Headers;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

async function asResponse(answer: Response | PlainAnswer): Promise<Response> {
  if (answer instanceof Response) return answer;
  const status = answer.status ?? (answer.ok === false ? 500 : 200);
  const headers = answer.headers;
  if (status === 204) return new Response(null, { status, headers });
  const body = answer.json
    ? await answer.json().then(
        (value) => JSON.stringify(value) ?? "",
        () => "not JSON",
      )
    : ((await answer.text?.()) ?? "");
  return new Response(body, { status, headers });
}

/** transportFetch with the plain answers of a stubbed fetch as Responses. */
export const plainTransportFetch: typeof transportFetch = async (input, init) =>
  asResponse((await transportFetch(input, init)) as Response | PlainAnswer);

export function sessionFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return plainTransportFetch(url, init);
}

export function clearSessionCache(): void {}

/** The answer of a paginated list route with all rows on one page. */
export function pagedJson(rows: readonly unknown[]): {
  status: "success";
  data: readonly unknown[];
  pagination: {
    current_page: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
} {
  return {
    status: "success",
    data: rows,
    pagination: {
      current_page: 1,
      page_size: Math.max(rows.length, 1),
      total_pages: 1,
      total_records: rows.length,
    },
  };
}
