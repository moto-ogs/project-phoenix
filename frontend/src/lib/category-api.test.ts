import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-cache", () => import("~/test/mocks/plain-session-fetch"));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { mapActivityCategoryResponse } from "./activity-helpers";
import { ApiError } from "./api-error";
import { categoryService } from "./category-api";
import type { ActivityCategoryResponse } from "./contract/activities.generated";

// The catalog proxy answers the contract's shape; the client maps it once.
const category: ActivityCategoryResponse = {
  id: "7",
  name: "Essen",
  description: "Mittagessen",
  color: "#F78C10",
  is_system: false,
  usage_count: 3,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};
const mapped = mapActivityCategoryResponse(category);

const payload = {
  name: "Essen",
  description: "Mittagessen",
  color: "#F78C10",
};

describe("categoryService requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always asks for archived and system rows with usage counts", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: [category] }, { status: 200 }),
    );

    await expect(categoryService.getManagedCategories()).resolves.toEqual([
      mapped,
    ]);
    // Archived rows are what the restore action needs; system rows are shown
    // read-only; the usage counts drive the "wird verwendet" hint. The
    // pickers use the plain list instead, which skips the extra aggregate
    // server-side.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/activities/categories?include_archived=true&include_system=true&with_usage=true",
      { method: "GET" },
    );
  });

  it("creates a category", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: category }, { status: 200 }),
    );

    await expect(categoryService.createCategory(payload)).resolves.toEqual(
      mapped,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/activities/categories",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("updates a category", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: category }, { status: 200 }),
    );

    await expect(categoryService.updateCategory("7", payload)).resolves.toEqual(
      mapped,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/activities/categories/7",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("archives via DELETE and resolves without a payload", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(categoryService.archiveCategory("7")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/activities/categories/7", {
      method: "DELETE",
    });
  });

  it("restores a category", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ data: category }, { status: 200 }),
    );

    await expect(categoryService.restoreCategory("7")).resolves.toEqual(mapped);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/activities/categories/7/restore",
      { method: "POST" },
    );
  });
});

describe("categoryService error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a backend diagnostic separate from the operation message", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { detail: "Eine Kategorie mit diesem Namen existiert bereits" },
        { status: 409 },
      ),
    );

    await expect(categoryService.createCategory(payload)).rejects.toMatchObject(
      {
        status: 409,
        message: "Kategorie konnte nicht angelegt werden",
        detail: "Eine Kategorie mit diesem Namen existiert bereits",
      },
    );
  });

  it("classifies a plain text error body by its status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream exploded", { status: 500 }),
    );

    await expect(categoryService.getManagedCategories()).rejects.toMatchObject({
      status: 500,
      code: "general.server",
    });
  });

  it("falls back to the operation message when the body is unusable", async () => {
    // Content-Type claims JSON but the body is not parseable — the fallback
    // message is what the user would otherwise never get.
    fetchMock.mockResolvedValueOnce(
      new Response("<html>", {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      categoryService.updateCategory("7", payload),
    ).rejects.toMatchObject({
      status: 502,
      message: "Kategorie konnte nicht gespeichert werden",
    });
  });

  it("reports a failed archive", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }));

    await expect(categoryService.archiveCategory("7")).rejects.toMatchObject({
      status: 403,
      message: "Kategorie konnte nicht archiviert werden",
    });
  });

  it("reports a failed restore", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "" }, { status: 409 }),
    );

    await expect(categoryService.restoreCategory("7")).rejects.toMatchObject({
      status: 409,
      message: "Kategorie konnte nicht wiederhergestellt werden",
    });
  });

  it("throws an ApiError so callers can narrow", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "nope" }, { status: 400 }),
    );

    await expect(categoryService.getManagedCategories()).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
