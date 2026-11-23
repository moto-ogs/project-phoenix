// API client for tenant-defined activity categories (#2131).
//
// Admin CRUD goes through /api/activities/categories (backend
// activities:manage_categories). Archiving is a DELETE — the backend never
// removes a category, so existing Termine and Aktivitäten keep theirs.

import { bffJson } from "./bff-fetch";
import type { ActivityCategoryRequest } from "./contract/activities.generated";
import {
  mapActivityCategoryResponse,
  type ActivityCategory,
} from "./activity-helpers";

class CategoryService {
  /**
   * Lists the categories for the manage screen: archived ones included so they
   * can be restored, system rows included for their read-only display, and
   * usage counts opted into. The pickers deliberately do NOT use this — a
   * plain list skips the extra usage aggregate server-side.
   */
  async getManagedCategories(): Promise<ActivityCategory[]> {
    const categories = await bffJson(
      "tenant",
      "GET /api/activities/categories",
      {
        query: {
          include_archived: true,
          include_system: true,
          with_usage: true,
        },
        errorMessage: "Kategorien konnten nicht geladen werden",
      },
    );
    return categories.map(mapActivityCategoryResponse);
  }

  async createCategory(
    payload: ActivityCategoryRequest,
  ): Promise<ActivityCategory> {
    const category = await bffJson(
      "tenant",
      "POST /api/activities/categories",
      {
        body: payload,
        errorMessage: "Kategorie konnte nicht angelegt werden",
      },
    );
    return mapActivityCategoryResponse(category);
  }

  async updateCategory(
    id: string,
    payload: ActivityCategoryRequest,
  ): Promise<ActivityCategory> {
    const category = await bffJson(
      "tenant",
      "PUT /api/activities/categories/{categoryId}",
      {
        params: { categoryId: id },
        body: payload,
        errorMessage: "Kategorie konnte nicht gespeichert werden",
      },
    );
    return mapActivityCategoryResponse(category);
  }

  /** Archives the category. Nothing is deleted server-side. */
  async archiveCategory(id: string): Promise<void> {
    await bffJson("tenant", "DELETE /api/activities/categories/{categoryId}", {
      params: { categoryId: id },
      errorMessage: "Kategorie konnte nicht archiviert werden",
    });
  }

  async restoreCategory(id: string): Promise<ActivityCategory> {
    const category = await bffJson(
      "tenant",
      "POST /api/activities/categories/{categoryId}/restore",
      {
        params: { categoryId: id },
        errorMessage: "Kategorie konnte nicht wiederhergestellt werden",
      },
    );
    return mapActivityCategoryResponse(category);
  }
}

export const categoryService = new CategoryService();
