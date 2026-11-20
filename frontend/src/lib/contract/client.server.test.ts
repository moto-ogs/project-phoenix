import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { suppressConsole } from "~/test/helpers/console";
import { contractGet, contractWrite } from "./client.server";
import { requestBody, success } from "./runtime";

const { mockApiGet, mockApiPost, mockApiPut } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
}));

vi.mock("~/lib/api-helpers.server", () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
}));

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
    expect(!result.ok && result.error).toMatchObject({
      status: 502,
      code: "general.unavailable",
    });
    expect(consoleSpies.error).toHaveBeenCalledWith("contract_decode_failed", {
      route: "GET /api/rows/{id}",
      write: false,
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

describe("contractWrite", () => {
  const consoleSpies = suppressConsole("error");
  const answer = { status: "success", data: { name: "Ada" } };
  const entry = <M extends "POST" | "PUT">(method: M, pattern: string) => ({
    method,
    pattern,
    request: requestBody<{ name?: string }>(),
    response: schema,
  });
  const create = entry("POST", "/api/rows/");
  const update = entry("PUT", "/api/rows/{id}");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the body and decodes the answer", async () => {
    mockApiPost.mockResolvedValueOnce(answer);
    await expect(
      contractWrite(create, "/api/rows", "token", { name: "Ada" }),
    ).resolves.toEqual({ ok: true, value: answer });
    expect(mockApiPost).toHaveBeenCalledExactlyOnceWith("/api/rows", "token", {
      name: "Ada",
    });
  });

  it("puts the body of a PUT route", async () => {
    mockApiPut.mockResolvedValueOnce(answer);
    const result = await contractWrite(update, "/api/rows/1", "token", {
      name: "Ada",
    });
    expect(result.ok).toBe(true);
    expect(mockApiPut).toHaveBeenCalledWith("/api/rows/1", "token", {
      name: "Ada",
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("refuses a body outside the request type at compile time", () => {
    const send = () =>
      // @ts-expect-error the route binds a string name
      contractWrite(update, "/api/rows/1", "token", { name: 7 });
    expect(send).toBeTypeOf("function");
  });

  it("hands a refused write back with status and code", async () => {
    const cause = new ApiResponseError(
      409,
      JSON.stringify({ status: 409, code: "students.companions_changed" }),
      { contentType: "application/problem+json" },
    );
    mockApiPut.mockRejectedValueOnce(cause);
    const result = await contractWrite(update, "/api/rows/1", "token", {});
    expect(!result.ok && result.error).toMatchObject({
      status: 409,
      code: "students.companions_changed",
      cause,
    });
  });

  it("answers 502 for a written answer outside the contract without inviting a resend", async () => {
    // The backend has stored the write; general.unavailable would offer
    // to send it again (#7563).
    mockApiPost.mockResolvedValueOnce({ status: "success", data: {} });
    const result = await contractWrite(create, "/api/rows", "token", {});
    expect(!result.ok && result.error).toMatchObject({
      status: 502,
      code: "general.write_answer_unreadable",
    });
    expect(consoleSpies.error).toHaveBeenCalledWith("contract_decode_failed", {
      route: "POST /api/rows/",
      write: true,
      issues: ["data.name: invalid_type"],
    });
  });

  it("lets a failure that is no backend response pass through", async () => {
    mockApiPut.mockRejectedValueOnce(new TypeError("aborted"));
    await expect(
      contractWrite(update, "/api/rows/1", "token", {}),
    ).rejects.toThrow("aborted");
  });
});
