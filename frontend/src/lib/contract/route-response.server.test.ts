import { expect, it } from "vitest";
import { ApiResponseError } from "../api-response-error.server";
import { contractError } from "./route-response.server";

it("replaces malformed upstream errors while keeping Retry-After", async () => {
  const body = "upstream diagnostic";
  const headers = {
    "Content-Type": "text/plain",
    "Retry-After": "5",
  };
  const response = contractError(
    {
      ok: false,
      backend: new Response(body, { status: 429, headers }),
      error: {
        status: 429,
        code: undefined,
        requestId: undefined,
        cause: new ApiResponseError(429, body, {
          contentType: headers["Content-Type"],
          retryAfter: headers["Retry-After"],
        }),
      },
    },
    new Request("http://localhost:3000/api/example"),
  );

  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("5");
  expect(await response.json()).toMatchObject({
    status: 429,
    detail: "Too Many Requests",
  });
});
