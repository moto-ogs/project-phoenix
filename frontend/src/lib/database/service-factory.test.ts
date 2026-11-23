/**
 * The generic CRUD service of the Datenverwaltung: every operation runs the
 * entity's call, which reaches its registered route through bffJson (#7806).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "~/lib/session-cache",
  () => import("~/test/mocks/plain-session-fetch"),
);

const fetchMock =
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

import { createCrudService } from "./service-factory";
import type { EntityConfig } from "./types";
import { ApiError } from "~/lib/api-error";
import { bffJson } from "~/lib/bff-fetch";
import { childrenConcept } from "~/lib/concepts/children";

interface TestEntity {
  id: string;
  name: string;
}

const ok = (data: unknown, extra: object = {}) =>
  Response.json({ status: "success", data, ...extra });

const refusal = (status: number, body: object) =>
  Response.json(body, { status });

const entity = (room: { id: string; name: string }): TestEntity => ({
  id: room.id,
  name: room.name,
});

const config: EntityConfig<TestEntity> = {
  name: { singular: "Raum", plural: "Räume" },
  concept: childrenConcept,
  labels: {},
  api: {
    list: async () => {
      const page = await bffJson("tenant", "GET /api/rooms/", {
        query: { include_system: true },
      });
      return { data: page.data.map(entity), pagination: page.pagination };
    },
    get: async (id) =>
      entity(
        await bffJson("tenant", "GET /api/rooms/{id}", { params: { id } }),
      ),
    create: async (data) =>
      entity(
        await bffJson("tenant", "POST /api/rooms/", {
          body: { name: data.name },
        }),
      ),
    update: async (id, data) =>
      entity(
        await bffJson("tenant", "PUT /api/rooms/{id}", {
          params: { id },
          body: { name: data.name },
        }),
      ),
    // The room route confirms its removal preview (ADR 0311).
    delete: (id) =>
      bffJson("tenant", "DELETE /api/rooms/{id}", {
        params: { id },
        body: { expected_fingerprint: "vorschau" },
      }),
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
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return { url, init };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getList", () => {
  it("keeps the page of a paginated route and maps every row", async () => {
    fetchMock.mockResolvedValueOnce(
      ok([{ id: "1", name: "A", building: "Alt" }], { pagination }),
    );

    await expect(createCrudService(config).getList()).resolves.toEqual({
      data: [{ id: "1", name: "A" }],
      pagination,
    });
    expect(call().url).toBe("/api/rooms?include_system=true");
  });

  it("gives a list without pages one page", async () => {
    const service = createCrudService({
      ...config,
      api: {
        list: () =>
          Promise.resolve([
            { id: "1", name: "A" },
            { id: "2", name: "B" },
          ]),
      },
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
    fetchMock.mockResolvedValueOnce(Response.json({ rooms: [] }));

    await expect(createCrudService(config).getList()).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("getOne", () => {
  it("reads the entity's route with its ID", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "7", name: "Aula" }));

    await expect(createCrudService(config).getOne("7")).resolves.toEqual({
      id: "7",
      name: "Aula",
    });
    expect(call().url).toBe("/api/rooms/7");
  });
});

describe("create", () => {
  it("sends the mapped body after beforeCreate and calls afterCreate", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "1", name: "Neu" }));
    const afterCreate = vi.fn(() => Promise.resolve());
    const service = createCrudService({
      ...config,
      hooks: {
        beforeCreate: (data) => Promise.resolve({ ...data, name: "Neu" }),
        afterCreate,
      },
    });

    await service.create({ name: "x" });

    expect(call().init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "Neu" }),
    });
    expect(afterCreate).toHaveBeenCalledWith({ id: "1", name: "Neu" });
  });

  it("hands the result of a custom create call to afterCreate", async () => {
    const create = vi.fn().mockResolvedValue({ id: "1", name: "c" });
    const afterCreate = vi.fn(() => Promise.resolve());
    const service = createCrudService({
      ...config,
      api: { ...config.api, create },
      hooks: { afterCreate },
    });

    await service.create({ name: "c" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterCreate).toHaveBeenCalledWith({ id: "1", name: "c" });
  });

  it("throws the ApiError with code, details and request ID", async () => {
    fetchMock.mockResolvedValueOnce(
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
    fetchMock.mockResolvedValueOnce(ok({ id: "1", name: "Neu" }));
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
    const service = createCrudService({
      ...config,
      api: { ...config.api, update },
    });

    await service.update("1", { name: "Neu" }, current);

    expect(update).toHaveBeenCalledWith("1", { name: "Neu" }, current);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the body of a refusal for the caller", async () => {
    const problem = {
      detail: "conflict",
      conflicts: [{ student_id: 42, weekdays: ["mon"] }],
    };
    fetchMock.mockResolvedValueOnce(refusal(409, problem));

    const caught = await createCrudService(config)
      .update("1", { name: "x" })
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({ status: 409 });
    expect((caught as ApiError).problem).toEqual(problem);
  });
});

describe("remove", () => {
  it("deletes through the entity's route and calls the hooks", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws the refusal and skips afterDelete", async () => {
    fetchMock.mockResolvedValueOnce(
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
      api: { list: config.api.list },
    });

    await expect(service.remove("1")).rejects.toThrow("no delete route");
  });
});
