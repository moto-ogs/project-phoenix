// Generic CRUD service of the Datenverwaltung. Each entity's config calls
// bffJson with its registered routes and their generated types (#7806); the
// factory adds logging and one page for an unpaginated list.

import { createLogger } from "~/lib/logger";
import type {
  CrudService,
  EntityApi,
  EntityConfig,
  PaginatedResponse,
} from "./types";

const logger = createLogger({ component: "ServiceFactory" });

function onePage(length: number): PaginatedResponse<never>["pagination"] {
  return {
    current_page: 1,
    page_size: length,
    total_pages: 1,
    total_records: length,
  };
}

export function createCrudService<T>(config: EntityConfig<T>): CrudService<T> {
  const { api } = config;
  const entity = config.name.singular;

  function missing(operation: keyof EntityApi<T>): never {
    throw new Error(`${entity}: no ${operation} route`);
  }

  return {
    async getList(): Promise<PaginatedResponse<T>> {
      try {
        const answer = await (api.list ?? missing("list"))();
        // A paginated route answers its page beside the data (#2353).
        return Array.isArray(answer)
          ? { data: answer, pagination: onePage(answer.length) }
          : answer;
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
        return await (api.get ?? missing("get"))(id);
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
        return await (api.create ?? missing("create"))(data);
      } catch (error) {
        logger.error("error creating entity", {
          entity,
          error: String(error),
        });
        throw error;
      }
    },

    async update(id: string, data: Partial<T>, current?: T): Promise<T | null> {
      try {
        return await (api.update ?? missing("update"))(id, data, current);
      } catch (error) {
        logger.error("error updating entity", {
          entity,
          id,
          error: String(error),
        });
        throw error;
      }
    },

    async remove(id: string): Promise<void> {
      try {
        await (api.delete ?? missing("delete"))(id);
      } catch (error) {
        logger.warn("entity_delete_failed", {
          entity,
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}
