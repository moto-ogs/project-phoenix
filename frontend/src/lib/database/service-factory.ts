// Generic CRUD service of the Datenverwaltung. Every call goes through
// bffJson with the entity's registered routes (#7806): the route decides
// whether a list is paginated, and an answer without `data` is an error.

import { bffJson } from "~/lib/bff-fetch";
import { createLogger } from "~/lib/logger";
import type { CrudService, EntityConfig, PaginatedResponse } from "./types";

const logger = createLogger({ component: "ServiceFactory" });

type QueryValue = string | number | boolean;

/**
 * bffJson without its per-route types: the factory serves every entity, and
 * each config names its routes as typed keys.
 */
const callRoute = bffJson as unknown as (
  portal: "tenant",
  route: string,
  options?: {
    params?: Record<string, string>;
    query?: Record<string, QueryValue>;
    body?: unknown;
  },
) => Promise<unknown>;

function requireRoute(entity: string, operation: string, route?: string) {
  if (!route) throw new Error(`${entity}: no ${operation} route`);
  return route;
}

function onePage(length: number): PaginatedResponse<never>["pagination"] {
  return {
    current_page: 1,
    page_size: length,
    total_pages: 1,
    total_records: length,
  };
}

function listQuery(
  listParams: Record<string, string> | undefined,
  filters: Record<string, unknown> | undefined,
): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = { ...listParams };
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null) continue;
    query[key] =
      typeof value === "object" ? JSON.stringify(value) : (value as QueryValue);
  }
  return query;
}

export function createCrudService<T>(config: EntityConfig<T>): CrudService<T> {
  const { api, service } = config;
  const entity = config.name.singular;
  const map = (item: unknown): T =>
    service?.mapResponse ? service.mapResponse(item) : (item as T);
  const body = (data: Partial<T>) =>
    service?.mapRequest ? service.mapRequest(data) : data;

  return {
    async getList(
      filters?: Record<string, unknown>,
    ): Promise<PaginatedResponse<T>> {
      try {
        const answer = await callRoute("tenant", api.routes.list, {
          query: listQuery(api.listParams, filters),
        });
        // A paginated route answers its page beside the data (#2353).
        if (Array.isArray(answer)) {
          return { data: answer.map(map), pagination: onePage(answer.length) };
        }
        const page = answer as PaginatedResponse<unknown>;
        return { data: page.data.map(map), pagination: page.pagination };
      } catch (error) {
        logger.error("error fetching entities", {
          entity: config.name.plural,
          error: String(error),
        });
        throw error;
      }
    },

    async getOne(id: string): Promise<T> {
      try {
        if (service?.customMethods?.getOne) {
          return (await service.customMethods.getOne(id)) as T;
        }
        const route = requireRoute(entity, "get", api.routes.get);
        return map(await callRoute("tenant", route, { params: { id } }));
      } catch (error) {
        logger.error("error fetching entity", {
          entity,
          id,
          error: String(error),
        });
        throw error;
      }
    },

    async create(data: Partial<T>): Promise<T> {
      try {
        let result: T;
        if (service?.create) {
          result = await service.create(data);
        } else {
          const input = config.hooks?.beforeCreate
            ? await config.hooks.beforeCreate(data)
            : data;
          const route = requireRoute(entity, "create", api.routes.create);
          result = map(await callRoute("tenant", route, { body: body(input) }));
        }
        if (config.hooks?.afterCreate) await config.hooks.afterCreate(result);
        return result;
      } catch (error) {
        logger.error("error creating entity", {
          entity,
          error: String(error),
        });
        throw error;
      }
    },

    async update(id: string, data: Partial<T>, current?: T): Promise<T> {
      try {
        let result: T;
        if (service?.update) {
          result =
            current === undefined
              ? await service.update(id, data)
              : await service.update(id, data, current);
        } else {
          const input = config.hooks?.beforeUpdate
            ? await config.hooks.beforeUpdate(id, data)
            : data;
          const route = requireRoute(entity, "update", api.routes.update);
          result = map(
            await callRoute("tenant", route, {
              params: { id },
              body: body(input),
            }),
          );
        }
        if (config.hooks?.afterUpdate) await config.hooks.afterUpdate(result);
        return result;
      } catch (error) {
        logger.error("error updating entity", {
          entity,
          id,
          error: String(error),
        });
        throw error;
      }
    },

    async remove(id: string): Promise<boolean> {
      if (config.hooks?.beforeDelete) {
        const shouldDelete = await config.hooks.beforeDelete(id);
        if (!shouldDelete) return false;
      }
      try {
        const route = requireRoute(entity, "delete", api.routes.delete);
        await callRoute("tenant", route, { params: { id } });
      } catch (error) {
        logger.warn("entity_delete_failed", {
          entity,
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (config.hooks?.afterDelete) await config.hooks.afterDelete(id);
      return true;
    },
  };
}
