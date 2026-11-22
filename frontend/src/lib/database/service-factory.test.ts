/**
 * The generic CRUD service of the Datenverwaltung: every operation calls the
 * entity's registered route through bffJson (#7806).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));

// The session gate and its renewal are sessionFetch's own tests.
vi.mock("~/lib/session-cache", () => ({ sessionFetch: mockFetch }));

import { createCrudService } from "./service-factory";
import type { EntityConfig } from "./types";
import { ApiError } from "~/lib/api-error";
import { childrenConcept } from "~/lib/concepts/children";

interface TestEntity {
  id: string;
  name: string;
}

const ok = (data: unknown, extra: object = {}) =>
  Response.json({ status: "success", data, ...extra });

const refusal = (status: number, body: object) =>
  Response.json(body, { status });

const config: EntityConfig<TestEntity> = {
  name: { singular: "Raum", plural: "Räume" },
  concept: childrenConcept,
  labels: {},
  api: {
    routes: {
      list: "GET /api/rooms/",
      get: "GET /api/rooms/{id}",
      create: "POST /api/rooms/",
      update: "PUT /api/rooms/{id}",
      delete: "DELETE /api/rooms/{id}",
    },
    listParams: { include_system: "true" },
  },
  form: { sections: [] },
  detail: { sections: [] },
  list: {
    title: "Räume",
    description: "",
    searchPlaceholder: "",
    item: { title: () => "Raum" },
  },
};

const pagination = {
  current_page: 2,
  page_size: 10,
  total_pages: 3,
  total_records: 21,
};

function call(index = 0) {
  const [url, init] = mockFetch.mock.calls[index] ?? [];
  return { url, init };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("getList", () => {
  it("keeps the page of a paginated route and maps every row", async () => {
    mockFetch.mockResolvedValueOnce(
      ok([{ id: "1", name: "A" }], { pagination }),
    );
    const service = createCrudService({
      ...config,
      service: {
        mapResponse: (row) => ({ ...(row as TestEntity), name: "mapped" }),
      },
    });

    await expect(
      service.getList({ page: 2, building: "Alt" }),
    ).resolves.toEqual({
      data: [{ id: "1", name: "mapped" }],
      pagination,
    });
    expect(call().url).toBe(
      "/api/rooms?include_system=true&page=2&building=Alt",
    );
  });

  it("gives a list without pages one page", async () => {
    mockFetch.mockResolvedValueOnce(ok([{ id: "1" }, { id: "2" }]));
    const service = createCrudService({
      ...config,
      api: { routes: { list: "GET /api/activities/" } },
    });

    const result = await service.getList();

    expect(result.pagination).toEqual({
      current_page: 1,
      page_size: 2,
      total_pages: 1,
      total_records: 2,
    });
  });

  it("refuses an answer without data instead of showing an empty list", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ rooms: [] }));

    await expect(createCrudService(config).getList()).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("getOne", () => {
  it("reads the entity's route with its ID", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "7", name: "Aula" }));

    await expect(createCrudService(config).getOne("7")).resolves.toEqual({
      id: "7",
      name: "Aula",
    });
    expect(call().url).toBe("/api/rooms/7");
  });

  it("uses a custom getOne instead", async () => {
    const getOne = vi.fn().mockResolvedValue({ id: "1", name: "custom" });
    const service = createCrudService({
      ...config,
      service: { customMethods: { getOne } },
    });

    await expect(service.getOne("1")).resolves.toEqual({
      id: "1",
      name: "custom",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("sends the mapped body after beforeCreate and calls afterCreate", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "1", name: "Neu" }));
    const afterCreate = vi.fn(() => Promise.resolve());
    const service = createCrudService({
      ...config,
      service: { mapRequest: (data) => ({ room_name: data.name }) },
      hooks: {
        beforeCreate: (data) => Promise.resolve({ ...data, name: "Neu" }),
        afterCreate,
      },
    });

    await service.create({ name: "x" });

    expect(call().init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ room_name: "Neu" }),
    });
    expect(afterCreate).toHaveBeenCalledWith({ id: "1", name: "Neu" });
  });

  it("uses a custom create and still calls afterCreate", async () => {
    const create = vi.fn().mockResolvedValue({ id: "1", name: "c" });
    const afterCreate = vi.fn(() => Promise.resolve());
    const service = createCrudService({
      ...config,
      service: { create },
      hooks: { afterCreate },
    });

    await service.create({ name: "c" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(afterCreate).toHaveBeenCalled();
  });

  it("throws the ApiError with code, details and request ID", async () => {
    mockFetch.mockResolvedValueOnce(
      refusal(409, {
        detail: "quota",
        code: "students.child_quota_reached",
        details: { booked_places: 10, occupied_places: 10 },
        instance: "req-crud",
      }),
    );

    const caught = await createCrudService(config)
      .create({ name: "x" })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 409,
      code: "students.child_quota_reached",
      details: { booked_places: 10, occupied_places: 10 },
      requestId: "req-crud",
    });
  });
});

describe("update", () => {
  it("puts the body to the entity's route after beforeUpdate", async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: "1", name: "Neu" }));
    const afterUpdate = vi.fn(() => Promise.resolve());
    const service = createCrudService({
      ...config,
      hooks: {
        beforeUpdate: (_id, data) => Promise.resolve({ ...data, name: "Neu" }),
        afterUpdate,
      },
    });

    await expect(service.update("1", { name: "x" })).resolves.toEqual({
      id: "1",
      name: "Neu",
    });
    expect(call().url).toBe("/api/rooms/1");
    expect(call().init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ name: "Neu" }),
    });
    expect(afterUpdate).toHaveBeenCalled();
  });

  it("passes the loaded record to a custom update without a request", async () => {
    const current = { id: "1", name: "Alt" };
    const update = vi.fn().mockResolvedValue({ ...current, name: "Neu" });
    const service = createCrudService({ ...config, service: { update } });

    await service.update("1", { name: "Neu" }, current);

    expect(update).toHaveBeenCalledWith("1", { name: "Neu" }, current);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps the body of a refusal for the caller", async () => {
    const problem = {
      detail: "conflict",
      conflicts: [{ student_id: 42, weekdays: ["mon"] }],
    };
    mockFetch.mockResolvedValueOnce(refusal(409, problem));

    const caught = await createCrudService(config)
      .update("1", { name: "x" })
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({ status: 409 });
    expect((caught as ApiError).problem).toEqual(problem);
  });
});

describe("remove", () => {
  it("deletes through the entity's route and calls the hooks", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const afterDelete = vi.fn(() => Promise.resolve());
    const service = createCrudService({
      ...config,
      hooks: { beforeDelete: () => Promise.resolve(true), afterDelete },
    });

    await expect(service.remove("3")).resolves.toBe(true);
    expect(call().url).toBe("/api/rooms/3");
    expect(call().init).toMatchObject({ method: "DELETE" });
    expect(afterDelete).toHaveBeenCalledWith("3");
  });

  it("resolves false when beforeDelete cancels", async () => {
    const service = createCrudService({
      ...config,
      hooks: { beforeDelete: () => Promise.resolve(false) },
    });

    await expect(service.remove("3")).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws the refusal and skips afterDelete", async () => {
    mockFetch.mockResolvedValueOnce(
      refusal(409, {
        detail: "group has students",
        code: "general.business_rejection",
        instance: "req-delete",
      }),
    );
    const afterDelete = vi.fn(() => Promise.resolve());
    const service = createCrudService({ ...config, hooks: { afterDelete } });

    const caught = await service.remove("1").catch((error: unknown) => error);

    expect(caught).toMatchObject({
      status: 409,
      code: "general.business_rejection",
      requestId: "req-delete",
    });
    expect(afterDelete).not.toHaveBeenCalled();
  });

  it("refuses an operation the entity has no route for", async () => {
    const service = createCrudService({
      ...config,
      api: { routes: { list: "GET /api/rooms/" } },
    });

    await expect(service.remove("1")).rejects.toThrow("no delete route");
  });
});
