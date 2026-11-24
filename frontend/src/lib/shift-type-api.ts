// API client for tenant-defined shift types (Schichtarten, #1836).
// Admin CRUD goes through /api/shift-types (time_tracking:manage), served by
// the portal's catalog proxy.

import { bffJson } from "./bff-fetch";
import type { ShiftTypeRequest } from "./contract/shift-types.generated";
import {
  mapShiftType,
  type ShiftType,
  type ShiftTypeRemoval,
} from "./shift-type-helpers";

interface ShiftTypeListOptions {
  /** Also the removed types that planned shifts still carry (Dienstplan). */
  includeArchived?: boolean;
  /** Count the planned shifts and series per type (removal dialog). */
  withUsage?: boolean;
}

interface ShiftTypePayload {
  name: string;
  /** Hex color, e.g. "#83CD2D" */
  color: string;
  description: string;
  isActive: boolean;
  /**
   * Timetable-Kategorien mapped to this shift type (#1837 follow-up). When
   * provided (including an empty array) it replaces the current mapping;
   * omitted leaves the mapping untouched (matches the backend's nil semantics).
   */
  categoryIds?: string[];
  /** The stored state of the type an edit replaces (ADR 0311). */
  expectedVersion?: string;
  /**
   * With `categoryIds`: the link token of every category the editor read,
   * by category id (ADR 0311).
   */
  expectedCategoryLinkVersions?: Readonly<Record<string, string>>;
}

function toBackendBody(payload: ShiftTypePayload): ShiftTypeRequest {
  return {
    name: payload.name,
    color: payload.color,
    description: payload.description,
    is_active: payload.isActive,
    // Only send category_ids when the caller manages the mapping; omitting it
    // leaves the existing Kategorie↔Schichtart links untouched server-side.
    ...(payload.categoryIds !== undefined && {
      category_ids: payload.categoryIds,
    }),
    ...(payload.expectedVersion !== undefined && {
      expected_version: payload.expectedVersion,
    }),
    ...(payload.categoryIds !== undefined &&
      payload.expectedCategoryLinkVersions !== undefined && {
        expected_category_link_versions: {
          ...payload.expectedCategoryLinkVersions,
        },
      }),
  };
}

class ShiftTypeService {
  async getShiftTypes(
    options: ShiftTypeListOptions = {},
  ): Promise<ShiftType[]> {
    const types = await bffJson("tenant", "GET /api/shift-types/", {
      query: {
        include_archived: options.includeArchived || undefined,
        with_usage: options.withUsage || undefined,
      },
      errorMessage: "Dienstarten konnten nicht geladen werden",
    });
    return types.map(mapShiftType);
  }

  async createShiftType(payload: ShiftTypePayload): Promise<ShiftType> {
    const type = await bffJson("tenant", "POST /api/shift-types/", {
      body: toBackendBody(payload),
      errorMessage: "Dienstart konnte nicht gespeichert werden",
    });
    return mapShiftType(type);
  }

  async updateShiftType(
    id: string,
    payload: ShiftTypePayload,
  ): Promise<ShiftType> {
    const type = await bffJson("tenant", "PUT /api/shift-types/{id}", {
      params: { id },
      body: toBackendBody(payload),
      errorMessage: "Dienstart konnte nicht gespeichert werden",
    });
    return mapShiftType(type);
  }

  /**
   * Removes a type. One that planned shifts or series still carry is
   * archived instead of deleted, so they keep it (#6845).
   */
  async deleteShiftType(id: string): Promise<ShiftTypeRemoval> {
    const removal = await bffJson("tenant", "DELETE /api/shift-types/{id}", {
      params: { id },
      errorMessage: "Dienstart konnte nicht gelöscht werden",
    });
    return removal.outcome === "archived" ? "archived" : "deleted";
  }

  /** Seeds the example shift types (idempotent) and returns the full list. */
  async createDefaults(): Promise<ShiftType[]> {
    const types = await bffJson("tenant", "POST /api/shift-types/defaults", {
      errorMessage: "Dienstarten konnten nicht geladen werden",
    });
    return types.map(mapShiftType);
  }
}

export const shiftTypeService = new ShiftTypeService();
