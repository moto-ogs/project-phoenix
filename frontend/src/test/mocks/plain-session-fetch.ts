// A session-cache module for client tests that stub `fetch`: the staff
// session gate lets every request through, and a 401 ends like a renewal
// the BFF refused (bff-fetch.test.ts and session-cache.test.ts cover the
// real gate and its renewal).
//
//   vi.mock("~/lib/session-cache", () => import("~/test/mocks/plain-session-fetch"));
//
// Portals without a session gate (public, school, …) need no mock. A case
// may stub plain answer objects ({ ok, status, headers, json }); wrap them in
// `plainResponse` or the stub in `plainFetch`, and they go out as Responses.
import { ApiError } from "~/lib/api-error";

interface PlainAnswer {
  ok?: boolean;
  status?: number;
  headers?: Headers;
  json?: () => unknown;
  text?: () => Promise<string>;
}

/** A Response for a plain answer object; a Response stays as it is. */
export async function plainResponse(
  answer: Response | PlainAnswer,
): Promise<Response> {
  if (answer instanceof Response) return answer;
  const status = answer.status ?? (answer.ok === false ? 500 : 200);
  const headers = answer.headers;
  if (status === 204) return new Response(null, { status, headers });
  const body = answer.json
    ? await Promise.resolve()
        .then(() => answer.json?.())
        .then(
          (value) => JSON.stringify(value) ?? "",
          () => "not JSON",
        )
    : ((await answer.text?.()) ?? "");
  return new Response(body, { status, headers });
}

/** A fetch stub whose plain answers go out as Responses. */
export function plainFetch(
  answer: (input: RequestInfo | URL, init?: RequestInit) => unknown,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) =>
    plainResponse((await answer(input, init)) as Response | PlainAnswer);
}

export async function requireTenantSession(): Promise<void> {}

export async function renewTenantSession(): Promise<void> {
  throw new ApiError("Authentication required", 401, {
    code: "general.permission",
  });
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
