import { routes as roomsRoutes } from "./rooms.generated";
import { routes as studentRoutes } from "./students.generated";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "~/lib/api-error";
import { presentError } from "~/lib/error-presentation";
import { ApiResponseError } from "~/lib/api-response-error.server";
import { suppressConsole } from "~/test/helpers/console";
import { contractGet, contractWrite } from "./client.server";
import { requestBody, success } from "./runtime";

const { mockApiGet, mockApiPost, mockApiPut } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
}));

vi.mock("~/lib/backend-client.server", async (original) => ({
  ...(await original<typeof import("~/lib/backend-client.server")>()),
  sendBackend: async (
    endpoint: string,
    token: string,
    call: { method: string; json?: unknown },
  ) => {
    const value =
      call.method === "GET"
        ? await mockApiGet(endpoint, token)
        : await (call.method === "POST" ? mockApiPost : mockApiPut)(
            endpoint,
            token,
            call.json,
          );
    return Response.json(value);
  },
}));

const schema = success(z.object({ name: z.string() }));
const read = () =>
  contractGet(
    { method: "GET", pattern: "/api/rows/{id}", response: schema },
    { params: { id: "1" }, token: "token" },
  );

it("types the Staff bootstrap query and does not accept an address override", () => {
  const checks = () => {
    const rooms = roomsRoutes["GET /api/rooms/"];
    void contractGet(rooms, { query: { is_open_room: true } });
    // @ts-expect-error: this field is not registered
    void contractGet(rooms, { query: { isOpenRoom: true } });
    // @ts-expect-error: the route itself owns the address
    void contractGet(rooms, { endpoint: "/api/students" });
    void contractGet(studentRoutes["GET /api/students/"], {
      // @ts-expect-error: the route does not register this variant
      query: { view: "compact" },
    });
  };
  expect(checks).toBeTypeOf("function");
});

describe("contractGet", () => {
  const consoleSpies = suppressConsole("error");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes the students names variant selected by the query", async () => {
    const student = {
      id: "9007199254740993",
      first_name: "Ada",
      last_name: "Lovelace",
    };
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: [student],
      pagination: {
        current_page: 1,
        page_size: 20,
        total_pages: 1,
        total_records: 1,
      },
    });
    const result = await contractGet(studentRoutes["GET /api/students/"], {
      token: "token",
      query: { view: "names" },
    });
    expect(mockApiGet).toHaveBeenCalledWith(
      "/api/students/?view=names",
      "token",
    );
    expect(result).toMatchObject({ ok: true, value: { data: [student] } });
    if (result.ok) {
      const checkType = () => {
        // @ts-expect-error: the names variant does not return a school class
        return result.value.data[0]?.school_class;
      };
      expect(checkType).toBeTypeOf("function");
    }
  });

  it("does not accept the names payload when the default students variant was requested", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: [{ id: "1", first_name: "Ada", last_name: "Lovelace" }],
      pagination: {
        current_page: 1,
        page_size: 20,
        total_pages: 1,
        total_records: 1,
      },
    });
    await expect(
      contractGet(studentRoutes["GET /api/students/"], { token: "token" }),
    ).resolves.toMatchObject({ ok: false, error: { status: 502 } });
    expect(mockApiGet).toHaveBeenCalledWith("/api/students/", "token");
  });

  it("hands out the decoded answer", async () => {
    mockApiGet.mockResolvedValueOnce({
      status: "success",
      data: { name: "Ada", more: 1 },
    });
    await expect(read()).resolves.toMatchObject({
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
    expect(result).toMatchObject({
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
  const entry = <M extends "POST" | "PUT", P extends string>(
    method: M,
    pattern: P,
  ) => ({
    method,
    pattern,
    request: requestBody<{ name?: string }>(),
    response: schema,
  });
  const create = entry("POST", "/api/rows");
  const update = entry("PUT", "/api/rows/{id}");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the body and decodes the answer", async () => {
    mockApiPost.mockResolvedValueOnce(answer);
    await expect(
      contractWrite(create, { name: "Ada" }, { token: "token" }),
    ).resolves.toMatchObject({ ok: true, value: answer });
    expect(mockApiPost).toHaveBeenCalledExactlyOnceWith("/api/rows", "token", {
      name: "Ada",
    });
  });

  it("puts the body of a PUT route", async () => {
    mockApiPut.mockResolvedValueOnce(answer);
    const result = await contractWrite(
      update,
      {
        name: "Ada",
      },
      { params: { id: "1" }, token: "token" },
    );
    expect(result.ok).toBe(true);
    expect(mockApiPut).toHaveBeenCalledWith("/api/rows/1", "token", {
      name: "Ada",
    });
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("refuses a body outside the request type at compile time", () => {
    const send = () =>
      contractWrite(
        update,
        {
          // @ts-expect-error the route binds a string name
          name: 7,
        },
        { params: { id: "1" }, token: "token" },
      );
    expect(send).toBeTypeOf("function");
  });

  it("hands a refused write back with status and code", async () => {
    const cause = new ApiResponseError(
      409,
      JSON.stringify({ status: 409, code: "students.companions_changed" }),
      { contentType: "application/problem+json" },
    );
    mockApiPut.mockRejectedValueOnce(cause);
    const result = await contractWrite(
      update,
      {},
      { params: { id: "1" }, token: "token" },
    );
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
    const result = await contractWrite(create, {}, { token: "token" });
    expect(!result.ok && result.error).toMatchObject({
      status: 502,
      code: "general.write_answer_unreadable",
    });
    expect(consoleSpies.error).toHaveBeenCalledWith("contract_decode_failed", {
      route: "POST /api/rows",
      write: true,
      issues: ["data.name: invalid_type"],
    });
  });

  it.each([
    ["a preview", "/api/rows/preview", "a preview saves nothing"],
    [
      "a search",
      "/api/search/",
      "a search reads; the query travels in the body",
    ],
  ])(
    "keeps an unreadable POST the contract marks noCommit retryable: %s",
    async (_name, pattern, noCommit) => {
      mockApiPost.mockResolvedValueOnce({ status: "success", data: {} });
      const result = await contractWrite(
        { ...entry("POST", pattern), noCommit },
        {},
        { token: "token" },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        status: 502,
        code: "general.unavailable",
      });
      expect(
        presentError(
          new ApiError("Bad Gateway", result.error.status, {
            code: result.error.code,
          }),
          "Vorschau",
        ),
      ).toMatchObject({ retryable: true, errorClass: "unavailable" });
      expect(consoleSpies.error).toHaveBeenCalledWith(
        "contract_decode_failed",
        {
          route: `POST ${pattern}`,
          write: false,
          issues: ["data.name: invalid_type"],
        },
      );
    },
  );

  it.each([
    "/api/import/students/import",
    "/auth/staff-preview",
    "/api/rows/preview",
  ])(
    "does not enable retry for a POST without noCommit: %s",
    async (pattern) => {
      mockApiPost.mockResolvedValueOnce({ status: "success", data: {} });
      const result = await contractWrite(
        entry("POST", pattern),
        {},
        { token: "token" },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("general.write_answer_unreadable");
      expect(
        presentError(
          new ApiError("Bad Gateway", result.error.status, {
            code: result.error.code,
          }),
          "Änderung",
        ).retryable,
      ).toBe(false);
    },
  );

  it("lets a failure that is no backend response pass through", async () => {
    mockApiPut.mockRejectedValueOnce(new TypeError("aborted"));
    await expect(
      contractWrite(update, {}, { params: { id: "1" }, token: "token" }),
    ).rejects.toThrow("aborted");
  });
});
