"use client";

import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { hasPermission } from "~/lib/auth-utils";
import { useSettingsSchema } from "~/lib/hooks/use-settings-schema";
import { useNFCEnabled } from "~/lib/tenant-context";
import {
  settingsSelectionFor,
  type SettingsSections,
} from "./settings-sections";

export {
  activeSettingsSectionId,
  schemaTabsForPage,
  settingsSectionHref,
  settingsSectionsFor,
  type SettingsSection,
  type SettingsSections,
} from "./settings-sections";

/**
 * The sections of the school's settings; `null` while the schema loads. When
 * the schema fetch failed, placeholder sections keep the page mounted so it
 * can show its own retry instead of silently dropping them.
 */
export function useSettingsSections(): SettingsSections | null {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { data: schema, error: schemaError, isLoading } = useSettingsSchema();
  const nfcEnabled = useNFCEnabled();
  const canManageHomeBlocks = hasPermission(session, "config:update");

  if (isLoading) {
    return null;
  }

  return settingsSelectionFor(
    schema,
    {
      schemaFailed: Boolean(schemaError),
      nfcEnabled,
      canManageHomeBlocks,
    },
    searchParams.get("highlight"),
  );
}
