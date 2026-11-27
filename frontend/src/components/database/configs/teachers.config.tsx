// Teacher Entity Configuration

import type { EntityConfig } from "@/lib/database/types";
import type { Teacher } from "@/lib/teacher-api";
import { bffJson } from "~/lib/bff-fetch";
import { mapTeacherResponse } from "~/lib/teacher-helpers";

export const teachersConfig = {
  name: {
    singular: "Personal",
    plural: "Personal",
  },

  // The list answers staff records of the contract (#7563).
  api: {
    list: async () =>
      (await bffJson("tenant", "GET /api/staff/")).map(mapTeacherResponse),
  },
} satisfies EntityConfig<Teacher>;
