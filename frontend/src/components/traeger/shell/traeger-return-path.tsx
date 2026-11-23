"use client";

import {
  SettingsReturnPathMemory,
  useSettingsReturnHref,
} from "~/components/ui/settings-return-path";
import { useSession } from "next-auth/react";
import { traegerHomeHref } from "~/lib/traeger-home";
import { isTraegerSettingsPath } from "./traeger-nav-active";

const RETURN_PATH_KEY = "traeger-settings-return-path";

/** Merkt sich die aktuelle Seite, solange sie außerhalb der Einstellungen liegt. */
export function TraegerReturnPathMemory() {
  return (
    <SettingsReturnPathMemory
      storageKey={RETURN_PATH_KEY}
      isSettingsPath={isTraegerSettingsPath}
    />
  );
}

/**
 * Das Ziel von „Zurück zur App"; ohne gemerkte Seite das Startziel (#7646):
 * das Dashboard mit seinem Recht, sonst die Schulliste.
 */
export function useTraegerReturnHref(): string {
  const { data: session } = useSession();
  return useSettingsReturnHref(
    RETURN_PATH_KEY,
    traegerHomeHref(session ?? null),
  );
}
