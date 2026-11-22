// Group Entity Configuration

import { defineEntityConfig } from "@/lib/database/types";
import type { Group, GroupWire } from "@/lib/group-helpers";
import { mapGroupResponse } from "@/lib/group-helpers";
import { bffJson } from "~/lib/bff-fetch";
import { groupsConcept } from "~/lib/concepts/groups";

export const groupsConfig = defineEntityConfig<Group>({
  name: {
    singular: "Gruppe",
    plural: "Gruppen",
  },

  concept: groupsConcept,

  backUrl: "/database",

  api: {
    routes: {
      list: "GET /api/groups/",
      get: "GET /api/groups/{id}",
      create: "POST /api/groups/",
      update: "PUT /api/groups/{id}",
      delete: "DELETE /api/groups/{id}",
    },
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

    defaultValues: {},

    transformBeforeSubmit: (data) => ({
      ...data,
      room_id: data.room_id ?? undefined,
    }),
  },

  detail: {
    header: {
      title: (group: Group) => group.name,
      subtitle: (group: Group) => group.room_name ?? "Kein Raum zugewiesen",
      avatar: {
        text: (group: Group) => group.name?.[0] ?? "G",
        size: "lg",
      },
    },

    sections: [
      {
        title: "Gruppendetails",
        items: [
          {
            label: "Gruppenname",
            value: (group: Group) => group.name,
          },
          {
            label: "Gruppenraum",
            value: (group: Group) =>
              group.room_name ?? "Kein Gruppenraum zugewiesen",
          },
          {
            label: "Gruppenleitung",
            value: (group: Group) => {
              if (!group.supervisors || group.supervisors.length === 0) {
                return "Keine Gruppenleitung zugewiesen";
              }
              // Return supervisor names as a formatted string
              return group.supervisors
                .map((supervisor) => supervisor.name)
                .join(", ");
            },
          },
          {
            label: "Anzahl Kinder",
            value: (group: Group) => group.student_count?.toString() ?? "0",
          },
          {
            label: "IDs",
            value: (group: Group) => (
              <div className="flex flex-col text-xs text-gray-600">
                <span>Gruppe: {group.id}</span>
                {group.room_id && <span>Raum: {group.room_id}</span>}
                {group.supervisors && group.supervisors.length > 0 && (
                  <span>
                    Gruppenleitung:{" "}
                    {group.supervisors.map((s) => s.id).join(", ")}
                  </span>
                )}
              </div>
            ),
          },
        ],
      },
    ],
  },

  list: {
    title: "Gruppe auswählen",
    description: "Verwalte Gruppen und deren Zuordnungen",
    searchPlaceholder: "Gruppe suchen…",

    // Frontend search configuration (loads all data at once)
    searchStrategy: "frontend",
    searchableFields: ["name", "room_name"],
    minSearchLength: 0, // Start searching immediately

    filters: [
      {
        id: "room_id",
        label: "Raum",
        type: "select",
        options: "dynamic", // Will extract from data
      },
    ],

    item: {
      title: (group: Group) => group.name,
      subtitle: (group: Group) => {
        const supervisorCount = group.supervisors?.length ?? 0;
        if (supervisorCount === 0) return "Keine Gruppenleitung";
        const suffix = supervisorCount === 1 ? "" : "en";
        return `${supervisorCount} Gruppenleitung${suffix}`;
      },
      description: (group: Group) => {
        const parts = [];
        if (group.room_name) parts.push(`Raum: ${group.room_name}`);
        if (group.student_count !== undefined)
          parts.push(`${group.student_count} Kinder`);
        return parts.join(" • ");
      },
      avatar: {
        text: (group: Group) => group.name?.[0] ?? "G",
      },
    },
  },

  service: {
    mapResponse: (data: unknown): Group => mapGroupResponse(data as GroupWire),

    mapRequest: (data: Partial<Group>) => {
      const mapped: Record<string, unknown> = {
        ...data,
        room_id: data.room_id || undefined,
      };

      return mapped;
    },
  },

  labels: {
    createButton: "Neue Gruppe erstellen",
    createModalTitle: "Neue Gruppe",
    detailModalTitle: "Gruppendetails",
    deleteConfirmation:
      "Bist du sicher, dass du diese Gruppe löschen möchtest?",
  },
});
