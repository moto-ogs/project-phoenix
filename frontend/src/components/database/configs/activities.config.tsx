// Activity Entity Configuration

import type { EntityConfig, EntityFormConfig } from "@/lib/database/types";
import {
  mapActivityResponse,
  mapSupervisorOption,
  type Activity,
} from "@/lib/activity-helpers";
import type {
  ActivityRequest,
  ActivityUpdateRequest,
} from "~/lib/contract/activities.generated";
import { bffJson } from "~/lib/bff-fetch";
import { activitiesConcept } from "~/lib/concepts/activities";
import { staffConcept } from "~/lib/concepts/staff";

// The available supervisors as select options. A failure rejects with the
// catalog error; an empty list would look like a school without supervisors
// (#2517, #2353).
async function loadSupervisorOptions(): Promise<
  Array<{ value: string; label: string }>
> {
  const supervisors = await bffJson(
    "tenant",
    "GET /api/activities/supervisors/available",
    { errorMessage: "failed to load supervisors" },
  );
  return supervisors.map(mapSupervisorOption).map((sup) => ({
    value: sup.id,
    label: sup.name,
  }));
}

/** The body of an activity write: the contract's names for the form's fields. */
export function toActivityRequest(data: Partial<Activity>): ActivityRequest {
  // A cleared number field holds "" instead of a number.
  const limit: unknown = data.max_participant;
  return {
    name: data.name,
    max_participants: typeof limit === "number" ? limit : null,
    category_id: data.ag_category_id || undefined,
    // Backend expects supervisor_ids as an array even for single primary
    ...(data.supervisor_id ? { supervisor_ids: [data.supervisor_id] } : {}),
  };
}

/**
 * The body of a save from the database form, which shows the name, the
 * limit, the category and the primary supervisor only. The route keeps what
 * the body does not name (opening, planned room, schedules), and a changed
 * primary supervisor travels with the co-supervisors the form read, so they
 * stay. `version` is the stored state the form was filled from (ADR 0311).
 */
export function toActivityUpdateRequest(
  data: Partial<Activity>,
): ActivityUpdateRequest {
  const limit: unknown = data.max_participant;
  const request: ActivityUpdateRequest = {
    name: data.name,
    max_participants: typeof limit === "number" ? limit : null,
    category_id: data.ag_category_id || undefined,
    expected_version: data.version,
  };
  const read = data.supervisors ?? [];
  const readPrimary = read.find((s) => s.is_primary)?.staff_id ?? "";
  const primary = data.supervisor_id ?? "";
  if (primary !== readPrimary) {
    const others = read
      .map((s) => s.staff_id)
      .filter((id) => id !== primary && id !== readPrimary);
    request.supervisor_ids = primary ? [primary, ...others] : others;
  }
  return request;
}

export const activitiesConfig = {
  name: {
    singular: "Aktivität",
    plural: "Aktivitäten",
  },

  api: {
    list: async () =>
      (
        await bffJson("tenant", "GET /api/activities/", {
          // Admin view keeps showing system activities (Schulhof Freispiel,
          // WC) — they are rendered greyed-out via isSystemActivity instead
          // of hidden.
          query: { include_system: true },
        })
      ).map(mapActivityResponse),
    get: async (id) =>
      mapActivityResponse(
        await bffJson("tenant", "GET /api/activities/{id}", { params: { id } }),
      ),
    create: async (data) =>
      mapActivityResponse(
        await bffJson("tenant", "POST /api/activities/", {
          body: toActivityRequest(data),
        }),
      ),
    update: async (id, data) =>
      mapActivityResponse(
        await bffJson("tenant", "PUT /api/activities/{id}", {
          params: { id },
          body: toActivityUpdateRequest(data),
        }),
      ),
    delete: (id) =>
      bffJson("tenant", "DELETE /api/activities/{id}", { params: { id } }),
  },

  form: {
    sections: [
      {
        title: "Grundinformationen",
        concept: activitiesConcept,
        columns: 2,
        fields: [
          {
            name: "name",
            label: "Name",
            type: "text",
            required: true,
            placeholder: "z.B. Fußball AG",
            colSpan: 2,
          },
          {
            name: "ag_category_id",
            label: "Kategorie",
            type: "select",
            required: true,
            optionsResource: "activity-category-choice",
            options: async () => {
              // A failure throws the ApiError: the form shows the catalog
              // text with retry instead of an empty choice (#2517).
              const categories = await bffJson(
                "tenant",
                "GET /api/activities/categories",
                { errorMessage: "failed to load activity categories" },
              );
              return categories.map((cat) => ({
                value: cat.id,
                label: cat.name,
              }));
            },
          },
          {
            name: "max_participant",
            label: "Maximale Teilnehmer (optional)",
            type: "number",
            required: false,
            min: 1,
            placeholder: "Keine Begrenzung",
          },
        ],
      },
      {
        title: "Betreuer",
        concept: staffConcept,
        fields: [
          {
            name: "supervisor_id",
            label: "Hauptbetreuung",
            type: "select",
            required: false,
            placeholder: "Keine Hauptbetreuung",
            optionsResource: "activity-supervisor-choice",
            options: loadSupervisorOptions,
          },
        ],
      },
    ],

    defaultValues: {
      max_participant: 20,
    },
  },

  createTitle: "Neue Aktivität",
} satisfies EntityConfig<Activity> & EntityFormConfig<Activity>;
