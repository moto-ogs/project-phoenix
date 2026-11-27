// Group Entity Configuration

import type { EntityConfig, EntityFormConfig } from "@/lib/database/types";
import type { Group } from "@/lib/group-helpers";
import { mapGroupResponse } from "@/lib/group-helpers";
import { bffJson } from "~/lib/bff-fetch";
import { groupsConcept } from "~/lib/concepts/groups";
import type * as groupsContract from "~/lib/contract/groups.generated";

/**
 * The body of a group write: only the fields of `GroupRequest`. The form
 * hands in the whole loaded group (room name, supervisors, counts), which the
 * route does not take.
 */
export function toGroupRequest(
  data: Partial<Group>,
): groupsContract.GroupRequest {
  return {
    name: data.name,
    room_id: data.room_id || undefined,
    teacher_ids: data.teacher_ids,
  };
}

/**
 * The body of a group save from the form: the name, the room (null clears
 * it, the route keeps a room the body does not name), the teachers, and the
 * `version` the form was filled from (ADR 0311).
 */
export function toGroupUpdateRequest(
  data: Partial<Group>,
): groupsContract.GroupUpdateRequest {
  return {
    name: data.name,
    room_id: data.room_id || null,
    teacher_ids: data.teacher_ids,
    expected_version: data.version,
  };
}

export const groupsConfig = {
  name: {
    singular: "Gruppe",
    plural: "Gruppen",
  },

  api: {
    create: async (data) =>
      mapGroupResponse(
        await bffJson("tenant", "POST /api/groups/", {
          body: toGroupRequest(data),
        }),
      ),
    update: async (id, data) =>
      mapGroupResponse(
        await bffJson("tenant", "PUT /api/groups/{id}", {
          params: { id },
          body: toGroupUpdateRequest(data),
        }),
      ),
    delete: (id) =>
      bffJson("tenant", "DELETE /api/groups/{id}", { params: { id } }),
  },

  form: {
    sections: [
      {
        title: "Gruppendetails",
        concept: groupsConcept,
        columns: 2,
        fields: [
          {
            name: "name",
            label: "Gruppenname",
            type: "text",
            required: true,
            placeholder: "z.B. Gruppe Blau",
          },
          {
            name: "room_id",
            label: "Gruppenraum",
            type: "select",
            required: false,
            optionsResource: "group-room-choice",
            options: async () => {
              // A failure throws the ApiError: the form shows the catalog
              // text with retry instead of an empty choice (#2517).
              const { data: rooms } = await bffJson(
                "tenant",
                "GET /api/rooms/",
                {
                  errorMessage: "failed to load /api/rooms",
                },
              );
              return [
                { value: "", label: "Kein Gruppenraum" },
                ...rooms.map((room) => ({
                  value: room.id,
                  label: room.name,
                })),
              ];
            },
          },
          {
            name: "teacher_ids",
            label: "Gruppenleitung",
            type: "multiselect",
            required: false,
            colSpan: 2,
            optionsResource: "group-caregiver-choice",
            options: async () => {
              // Fetch active caregivers from the canonical caregiver pool.
              const teachers =
                (await bffJson("tenant", "GET /api/staff/by-role", {
                  query: { role: "user" },
                  errorMessage: "failed to load /api/staff/by-role?role=user",
                })) ?? [];

              // Use teacher_id (not staff id) to match backend group teacher assignments
              return teachers
                .filter((teacher) => teacher.teacher_id)
                .map((teacher) => {
                  const name =
                    teacher.full_name ||
                    `${teacher.first_name} ${teacher.last_name}`.trim();
                  return { value: teacher.teacher_id!, label: name };
                });
            },
            placeholder: "Gruppenleitung auswählen…",
            helperText:
              "Wähle eine oder mehrere Gruppenleitungen für diese Gruppe aus",
          },
        ],
      },
    ],

    transformBeforeSubmit: (data) => ({
      ...data,
      room_id: data.room_id ?? undefined,
    }),
  },

  createTitle: "Neue Gruppe",
} satisfies EntityConfig<Group> & EntityFormConfig<Group>;
