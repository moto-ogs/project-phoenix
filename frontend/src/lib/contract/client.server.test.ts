import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { suppressConsole } from "~/test/helpers/console";
import { contractGet } from "./client.server";
import { success } from "./runtime";

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }));

vi.mock("~/lib/api-helpers.server", () => ({ apiGet: mockApiGet }));

const schema = success(z.object({ name: z.string() }));
const read = () =>
  contractGet("GET /api/rows/{id}", schema, "/api/rows/1", "token");

describe("contractGet", () => {
  const consoleSpies = suppressConsole("error");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands out the decoded answer", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: { name: "Ada", more: 1 },
    });
    await expect(read()).resolves.toEqual({
      ok: true,
      value: { status: "success", data: { name: "Ada" } },
    });
  });

  it("names status, registry code and request ID of a backend error", async () => {
    const cause = new ApiResponseError(
      404,
      JSON.stringify({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "student not found",
        instance: "req-123",
        code: "general.input",
      }),
      { contentType: "application/problem+json" },
    );
    mockApiGet.mockRejectedValueOnce(cause);
    const result = await read();
    expect(result).toEqual({
      ok: false,
      error: {
        status: 404,
        code: "general.input",
        requestId: "req-123",
        cause,
      },
    });
  });

  it("carries no code for an error body that is no envelope", async () => {
    mockApiGet.mockRejectedValueOnce(new ApiResponseError(502, "<html>"));
    const result = await read();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({
      status: 502,
      code: undefined,
      requestId: undefined,
    });
  });

  it("answers 502 for an answer outside the contract and logs no values", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: { name: 7, secret: "Ada Beispiel" },
    });
    const result = await read();
    expect(!result.ok && result.error.status).toBe(502);
    expect(consoleSpies.error).toHaveBeenCalledWith("contract_decode_failed", {
      route: "GET /api/rows/{id}",
      issues: ["data.name: invalid_type"],
    });
  });

  it("does not turn the empty answer of a bodyless response into a value", async () => {
    mockApiGet.mockResolvedValueOnce({});
    expect((await read()).ok).toBe(false);
  });

  it("lets a failure that is no backend response pass through", async () => {
    mockApiGet.mockRejectedValueOnce(new TypeError("aborted"));
    await expect(read()).rejects.toThrow("aborted");
  });
});
