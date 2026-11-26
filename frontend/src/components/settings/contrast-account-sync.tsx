"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  accountContrastMutationGeneration,
  applyContrastPreference,
  currentContrastPreference,
  hasPendingAccountContrastMutation,
} from "~/lib/contrast-preference";
import type { PortalKey } from "~/lib/portal-paths";

/**
 * Holt nach der Anmeldung die Kontrast-Wahl des Kontos und übernimmt sie in
 * dieses Gerät, falls sie vom Cookie abweicht (`~/lib/contrast-account`).
 * Ohne Wahl am Konto gilt wieder die Systemeinstellung. Eine Vorschau trägt
 * fremde Identität und behält die Darstellung des Geräts. Zeichnet nichts.
 */
export function ContrastAccountSync({
  portal,
}: Readonly<{ portal: PortalKey }>) {
  const { data: session, status } = useSession();
  const accountId = status === "authenticated" ? session?.user?.id : undefined;
  const isPreview = session?.user?.isPreview === true;

  useEffect(() => {
    if (!accountId || isPreview || hasPendingAccountContrastMutation()) return;
    let cancelled = false;
    const generation = accountContrastMutationGeneration();
    // Erst nach der Anmeldung geladen: die Anmeldeseiten jedes Portals tragen
    // den Konto-Abruf nicht mit (Bundle-Obergrenzen der Login-Routen).
    import("~/lib/contrast-account")
      .then(async ({ contrastOfAccount, readAccountContrast }) => ({
        contrastOfAccount,
        moreContrast: await readAccountContrast(portal),
      }))
      .then(({ contrastOfAccount, moreContrast }) => {
        if (
          cancelled ||
          generation !== accountContrastMutationGeneration() ||
          hasPendingAccountContrastMutation()
        )
          return;
        const wanted = contrastOfAccount(moreContrast);
        if (wanted !== currentContrastPreference()) {
          applyContrastPreference(wanted);
        }
      })
      // Ohne Antwort bleibt die Darstellung des Geräts; die nächste Seite
      // fragt wieder.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [portal, accountId, isPreview]);

  return null;
}
