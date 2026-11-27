// Permission Entity Configuration

import type { EntityConfig } from "@/lib/database/types";
import type { Permission } from "@/lib/auth-helpers";
import { bffJson } from "~/lib/bff-fetch";
import { mapPermissionResponse } from "@/lib/auth-helpers";
export const permissionsConfig = {
  name: {
    singular: "Berechtigung",
    plural: "Berechtigungen",
  },

  api: {
    list: async () =>
      (await bffJson("tenant", "GET /auth/permissions/")).map(
        mapPermissionResponse,
      ),
  },
} satisfies EntityConfig<Permission>;
