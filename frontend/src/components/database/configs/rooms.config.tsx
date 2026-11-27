// Room Entity Configuration

import type { EntityConfig, EntityFormConfig } from "@/lib/database/types";
import { CatalogColorField } from "@/components/database/catalog-color-field";
import { mapRoomResponse, prepareRoomForBackend } from "@/lib/room-helpers";
import type { Room } from "@/lib/room-helpers";
import { bffJson } from "~/lib/bff-fetch";

export const roomsConfig = {
  name: {
    singular: "Raum",
    plural: "Räume",
  },

  api: {
    create: async (data) =>
      mapRoomResponse(
        await bffJson("tenant", "POST /api/rooms/", {
          body: prepareRoomForBackend(data),
        }),
      ),
    update: async (id, data) =>
      mapRoomResponse(
        await bffJson("tenant", "PUT /api/rooms/{id}", {
          params: { id },
          body: prepareRoomForBackend(data),
        }),
      ),
    // Kein `delete`: ein Raum wird nur über RoomRemovalModal entfernt, das
    // den Fingerabdruck seiner Vorschau mitschickt (ADR 0311).
  },

  form: {
    sections: [
      {
        title: "Raumdetails",
        columns: 2,
        fields: [
          {
            name: "name",
            label: "Raumname",
            type: "text",
            required: true,
            placeholder: "z.B. Klassenraum 101",
          },
          {
            name: "category",
            label: "Kategorie",
            type: "select",
            required: true,
            options: [
              { value: "Normaler Raum", label: "Normaler Raum" },
              { value: "Gruppenraum", label: "Gruppenraum" },
              { value: "Themenraum", label: "Themenraum" },
              { value: "Sport", label: "Sport" },
            ],
          },
          {
            name: "building",
            label: "Gebäude",
            type: "text",
            placeholder: "z.B. Gebäude A",
          },
          {
            name: "floor",
            label: "Etage",
            type: "text",
            required: false, // Now optional
            placeholder: "z.B. 0, 1, 2",
            validation: (value) => {
              if (value && Number.isNaN(Number.parseInt(value as string, 10))) {
                return "Bitte gib eine gültige Etage ein";
              }
              return null;
            },
          },
          {
            name: "capacity",
            label: "Maximale Belegung",
            type: "number",
            required: false,
            min: 1,
            placeholder: "Keine Begrenzung",
            helperText:
              "Optional. Begrenzt die Anzahl der gleichzeitig eingecheckten Kinder in diesem Raum.",
          },
          {
            name: "color",
            label: "Farbe",
            type: "custom",
            colSpan: 2,
            component: CatalogColorField,
          },
          {
            // "Offener Raum" is the domain term from #3062. The hint names what
            // the switch does and, in one short sentence, what it does not: the
            // most likely wrong reading is "I have taken supervision here".
            name: "isOpenRoom",
            label: "Offener Raum",
            type: "checkbox",
            colSpan: 2,
            helperText:
              "Kinder können diesen Raum jederzeit als Ziel wählen. Das ersetzt keine Aufsicht.",
          },
        ],
      },
    ],

    transformBeforeSubmit: (data) => {
      // - Trim name
      // - Convert floor to number
      // - Pass color through untouched: null/undefined clears it server-side,
      //   the backend uses NULL to mean "fall back to badge default blue"
      return {
        ...data,
        name: typeof data.name === "string" ? data.name.trim() : data.name,
        floor:
          typeof data.floor === "string"
            ? Number.parseInt(data.floor, 10)
            : data.floor,
      };
    },
  },

  createTitle: "Neuer Raum",
} satisfies EntityConfig<Room> & EntityFormConfig<Room>;
