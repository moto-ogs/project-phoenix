"use client";

import type { ReaderOptions } from "~/lib/swr";

import { fetchSettingsSchema, type SettingsSchema } from "~/lib/settings-api";
import { useSWRAuth } from "~/lib/swr";
import { shellResourceKeys } from "~/lib/swr/shell-keys";

/** Reads the settings schema from the active tenant's isolated SWR cache. */
export function useSettingsSchema(
  enabled = true,
  options?: ReaderOptions<SettingsSchema | null, Error>,
) {
  return useSWRAuth<SettingsSchema | null>(
    enabled ? shellResourceKeys.settingsSchema() : null,
    fetchSettingsSchema,
    options,
  );
}
