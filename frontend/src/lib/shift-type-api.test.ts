import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { ApiError } from "./api-error";
import { shiftTypeService } from "./shift-type-api";

const backendShiftType = {
  id: "12",
  name: "Betreuung",
  color: "#83CD2D",
  description: "Zeit am Kind",
  is_active: true,
};

const mappedShiftType = {
  id: "12",
  name: "Betreuung",
  color: "#83CD2D",
  description: "Zeit am Kind",
  isActive: true,
  archivedAt: null,
};

describe("shiftTypeService requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a list response and hits the correct endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: [backendShiftType] }, { status: 200 }),
    );

    await expect(shiftTypeService.getShiftTypes()).resolves.toEqual([
      mappedShiftType,
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/shift-types", {
      method: "GET",
    });
  });

  it("defaults a missing description to an empty string", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { data: [{ ...backendShiftType, description: undefined }] },
        { status: 200 },
      ),
    );

    await expect(shiftTypeService.getShiftTypes()).resolves.toEqual([
      { ...mappedShiftType, description: "" },
    ]);
  });

  it("serializes the create payload into the backend body", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: backendShiftType }, { status: 201 }),
    );

    await expect(
      shiftTypeService.createShiftType({
        name: "Betreuung",
        color: "#83CD2D",
        description: "Zeit am Kind",
        isActive: true,
      }),
    ).resolves.toEqual(mappedShiftType);

    expect(fetchMock).toHaveBeenCalledWith("/api/shift-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Betreuung",
        color: "#83CD2D",
        description: "Zeit am Kind",
        is_active: true,
      }),
    });
  });

  it("serializes the update payload and targets the id endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: backendShiftType }, { status: 200 }),
    );

    await expect(
      shiftTypeService.updateShiftType("12", {
        name: "Betreuung",
        color: "#83CD2D",
        description: "",
        isActive: false,
      }),
    ).resolves.toEqual(mappedShiftType);

    expect(fetchMock).toHaveBeenCalledWith("/api/shift-types/12", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Betreuung",
        color: "#83CD2D",
        description: "",
        is_active: false,
      }),
    });
  });

  it("includes category_ids (as strings) when the mapping is managed (#1837)", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: backendShiftType }, { status: 200 }),
    );

    await shiftTypeService.updateShiftType("12", {
      name: "Betreuung",
      color: "#83CD2D",
      description: "",
      isActive: true,
      categoryIds: ["3", "7"],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/shift-types/12", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Betreuung",
        color: "#83CD2D",
        description: "",
        is_active: true,
        category_ids: ["3", "7"],
      }),
    });
  });

  it("sends an empty category_ids array to clear the mapping", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: backendShiftType }, { status: 200 }),
    );

    await shiftTypeService.updateShiftType("12", {
      name: "Betreuung",
      color: "#83CD2D",
      description: "",
      isActive: true,
      categoryIds: [],
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.category_ids).toEqual([]);
  });

  it("omits category_ids entirely when categoryIds is undefined", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: backendShiftType }, { status: 201 }),
    );

    await shiftTypeService.createShiftType({
      name: "Betreuung",
      color: "#83CD2D",
      description: "",
      isActive: true,
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty("category_ids");
  });

  it("reports a deletion after a successful delete", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { id: 12, outcome: "deleted" } }, { status: 200 }),
    );

    await expect(shiftTypeService.deleteShiftType("12")).resolves.toBe(
      "deleted",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/shift-types/12", {
      method: "DELETE",
    });
  });

  it("reports an archived type that planned shifts still carry (#6845)", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: { id: 12, outcome: "archived" } }, { status: 200 }),
    );

    await expect(shiftTypeService.deleteShiftType("12")).resolves.toBe(
      "archived",
    );
  });

  it("asks for archived types and usage only when requested", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          data: [
            {
              ...backendShiftType,
              archived_at: "2026-11-13T09:00:00Z",
              usage: { shifts: 4, series: 1 },
            },
          ],
        },
        { status: 200 },
      ),
    );

    await expect(
      shiftTypeService.getShiftTypes({
        includeArchived: true,
        withUsage: true,
      }),
    ).resolves.toEqual([
      {
        ...mappedShiftType,
        archivedAt: "2026-11-13T09:00:00Z",
        usage: { shifts: 4, series: 1 },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shift-types?include_archived=true&with_usage=true",
      { method: "GET" },
    );
  });

  it("seeds the defaults and returns the full list", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: [backendShiftType] }, { status: 200 }),
    );

    await expect(shiftTypeService.createDefaults()).resolves.toEqual([
      mappedShiftType,
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/shift-types/defaults", {
      method: "POST",
    });
  });
});

describe("shiftTypeService errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves backend detail separately from the operation message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "name already exists" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      shiftTypeService.createShiftType({
        name: "Betreuung",
        color: "#83CD2D",
        description: "",
        isActive: true,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Dienstart konnte nicht gespeichert werden",
      detail: "name already exists",
    });
  });

  it("keeps the 409 problem fields in a domain error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: "name already exists",
          code: "workforce.shift_type_name_taken",
          details: { existing_id: "12" },
          errors: [{ field: "name", reason: "duplicate" }],
          instance: "request-shift-409",
        }),
        {
          status: 409,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );

    await expect(
      shiftTypeService.createShiftType({
        name: "Betreuung",
        color: "#83CD2D",
        description: "",
        isActive: true,
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "workforce.shift_type_name_taken",
      details: { existing_id: "12" },
      errors: [{ field: "name", reason: "duplicate" }],
      requestId: "request-shift-409",
    });
  });

  it("classifies non-JSON error bodies by their status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("database timeout", { status: 500 }),
    );

    await expect(shiftTypeService.getShiftTypes()).rejects.toMatchObject({
      status: 500,
      code: "general.server",
    });
  });

  it("falls back to the default message when JSON is malformed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{", {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      shiftTypeService.updateShiftType("12", {
        name: "Betreuung",
        color: "#83CD2D",
        description: "",
        isActive: true,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Dienstart konnte nicht gespeichert werden",
    });
  });

  it("falls back when JSON error bodies omit the detail field", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "wrong shape" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(shiftTypeService.getShiftTypes()).rejects.toMatchObject({
      status: 422,
      message: "Dienstarten konnten nicht geladen werden",
    });
  });

  it("uses the delete fallback message on delete failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));

    await expect(shiftTypeService.deleteShiftType("12")).rejects.toMatchObject({
      status: 403,
      message: "Dienstart konnte nicht gelöscht werden",
    });
  });

  it("surfaces load failures from the defaults endpoint", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(shiftTypeService.createDefaults()).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
