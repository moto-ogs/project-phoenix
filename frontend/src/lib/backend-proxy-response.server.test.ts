import { describe, expect, it } from "vitest";
import { forwardBackendResponse } from "./backend-proxy-response.server";

describe("forwardBackendResponse", () => {
  // undici cancels the body of a fetch Response that is garbage collected
  // while its stream is still unlocked; a forwarded 401 then answered an
  // empty 500 once the session renewal after it ran long enough for a GC.
  it("takes the backend body at once, so its collection cannot cancel it", async () => {
    const backend = new Response('{"code":"identity.mfa_session_required"}', {
      status: 401,
      headers: { "Content-Type": "application/problem+json" },
    });

    const response = forwardBackendResponse(backend);

    expect(backend.body?.locked).toBe(true);
    expect(await response.text()).toBe(
      '{"code":"identity.mfa_session_required"}',
    );
  });

  it("preserves a structured backend conflict byte-for-byte", async () => {
    const body =
      '{"code":"item_conflict","details":{"id":"42"},"errors":[{"field":"name"}],"instance":"/api/items/42"}';
    const response = forwardBackendResponse(
      new Response(body, {
        status: 409,
        headers: {
          "Content-Type": "application/problem+json",
          "Retry-After": "17",
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(await response.text()).toBe(body);
  });

  it("replaces a backend 5xx body with a safe problem envelope", async () => {
    const response = forwardBackendResponse(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: "database at db.internal refused the connection",
          code: "iot.schulhof_not_configured",
          details: { host: "db.internal" },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "iot.schulhof_not_configured",
    });
    expect(body).not.toContain("db.internal");
    expect(body).not.toContain("refused the connection");
  });

  // The saved part of an import whose later batch failed is written for the
  // person who imported (#3184); its detail text stays on the server.
  it("keeps the details of a failed import batch, not its diagnostics", async () => {
    const errors = [
      "creation_failed",
      "update_failed",
      "duplicate_check_failed",
      "existing_lookup_failed",
      "rfid_lookup_failed",
      "role_lookup_failed",
      "opening_preflight_failed",
      "vacation_opening_preflight_failed",
    ].map((code, index) => ({
      row_number: index + 4,
      data: { first_name: "Ada", last_name: "Test" },
      errors: [
        {
          field: "write",
          code,
          severity: "error",
          message: "database db.internal: constraint failed",
        },
      ],
    }));
    const result = {
      total_rows: errors.length + 3,
      created_count: 2,
      updated_count: 1,
      error_count: errors.length,
      errors,
    };
    const response = forwardBackendResponse(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: "batch 2 failed at db.internal",
          code: "import.import_batch_failed",
          details: { result },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "import.import_batch_failed",
      details: {
        result: {
          ...result,
          errors: errors.map((row) => ({
            ...row,
            errors: [
              {
                ...row.errors[0],
                message: expect.stringMatching(
                  /^Die (?:Zeile|Karte|Rolle|Übernahme) konnte nicht/,
                ),
              },
            ],
          })),
        },
      },
    });
    expect(body).not.toContain("db.internal");
  });

  it("adds the request ID to a sanitized backend error", async () => {
    const response = forwardBackendResponse(
      new Response("upstream diagnostics", { status: 502 }),
      new Request("https://frontend.test/api/example", {
        headers: { "X-Request-ID": "request-502" },
      }),
    );

    expect(await response.json()).toMatchObject({
      status: 502,
      instance: "request-502",
    });
  });

  it("replaces an unregistered backend code with the status class", async () => {
    const response = forwardBackendResponse(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          detail: "database at db.internal refused the connection",
          code: "upstream.unknown_code",
        }),
        { status: 500 },
      ),
    );

    expect(await response.json()).toMatchObject({
      status: 500,
      detail: "Internal Server Error",
      code: "general.server",
    });
  });

  it("keeps a no-content response bodyless", async () => {
    const response = forwardBackendResponse(
      new Response(null, { status: 204 }),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  describe("cache policy (#4999)", () => {
    it.each([
      [200, '{"data":{"id":1}}', "application/json"],
      [404, '{"status":404}', "application/problem+json"],
      [502, "upstream diagnostics", "text/html"],
    ])(
      "marks a forwarded %i JSON answer private, no-store",
      (status, body, type) => {
        const response = forwardBackendResponse(
          new Response(body, { status, headers: { "Content-Type": type } }),
        );

        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      },
    );

    it("does not take over a backend cache header", () => {
      const response = forwardBackendResponse(
        Response.json(
          { data: [] },
          { headers: { "Cache-Control": "public, max-age=3600" } },
        ),
      );

      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("leaves a forwarded file without a cache header", () => {
      const response = forwardBackendResponse(
        new Response("a;b", { headers: { "Content-Type": "text/csv" } }),
      );

      expect(response.headers.get("Content-Type")).toBe("text/csv");
      expect(response.headers.has("Cache-Control")).toBe(false);
    });
  });
});
