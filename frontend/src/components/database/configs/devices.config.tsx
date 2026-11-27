// Device Entity Configuration

import type { EntityConfig, EntityFormConfig } from "@/lib/database/types";
import type { Device } from "@/lib/iot-helpers";
import { bffJson } from "~/lib/bff-fetch";
import {
  mapDeviceResponse,
  prepareDeviceForBackend,
  generateDefaultDeviceName,
  DEVICE_TYPE_OPTIONS,
} from "@/lib/iot-helpers";
import { devicesConcept } from "~/lib/concepts/devices";
import type * as iotContract from "~/lib/contract/iot.generated";

/**
 * The body of a device edit: the fields of the form and the `version` of the
 * stored device the form was filled from (ADR 0311).
 */
function toDeviceUpdateRequest(
  data: Partial<Device>,
): iotContract.DeviceUpdateRequest {
  return { ...prepareDeviceForBackend(data), expected_version: data.version };
}

export const devicesConfig = {
  name: {
    singular: "Gerät",
    plural: "Geräte",
  },

  // The catalog proxy hands on the contract's device; the client maps it
  // once (#7563).
  api: {
    list: async () =>
      (await bffJson("tenant", "GET /api/iot/")).map(mapDeviceResponse),
    create: async (data) =>
      mapDeviceResponse(
        await bffJson("tenant", "POST /api/iot/", {
          body: prepareDeviceForBackend(data),
        }),
      ),
    update: async (id, data) =>
      mapDeviceResponse(
        await bffJson("tenant", "PUT /api/iot/{id}", {
          params: { id },
          body: toDeviceUpdateRequest(data),
        }),
      ),
    delete: (id) =>
      bffJson("tenant", "DELETE /api/iot/{id}", { params: { id } }),
  },

  form: {
    sections: [
      {
        title: "Geräteinformationen",
        concept: devicesConcept,
        columns: 2,
        fields: [
          {
            name: "device_id",
            label: "Geräte-ID",
            type: "text",
            required: true,
            placeholder: "z.B. T-001",
            helperText: "Eindeutige Kennung für das Gerät",
          },
          {
            name: "device_type",
            label: "Gerätetyp",
            type: "select",
            required: true,
            options: Object.entries(DEVICE_TYPE_OPTIONS).map(
              ([value, label]) => ({ value, label }),
            ),
            helperText: "Art des Geräts",
          },
          {
            name: "name",
            label: "Gerätename",
            type: "text",
            placeholder: "z.B. Eingangsbereich Terminal",
            helperText: "Optionaler Name zur besseren Identifikation",
          },
        ],
      },
    ],

    defaultValues: {
      device_type: "terminal",
    },

    transformBeforeSubmit: (data) => {
      // Auto-generate name if not provided
      if (!data.name && data.device_id && data.device_type) {
        return {
          ...data,
          name: generateDefaultDeviceName(data.device_type, data.device_id),
        };
      }
      return data;
    },
  },

  createTitle: "Neues Gerät",
} satisfies EntityConfig<Device> & EntityFormConfig<Device>;
