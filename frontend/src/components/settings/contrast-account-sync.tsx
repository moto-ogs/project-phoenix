"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import {
  accountContrastMutationGeneration,
  applyContrastPreference,
  currentContrastPreference,
  hasPendingAccountContrastMutation,
  subscribeToAccountContrastMutation,
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
  const isSavingAccountContrast = useSyncExternalStore(
    subscribeToAccountContrastMutation,
    hasPendingAccountContrastMutation,
    () => false,
  );
  const lastSynced = useRef<
    Readonly<{ accountId: string; portal: PortalKey }> | undefined
  >(undefined);
  const mustSyncAfterSave = useRef(false);

  useEffect(() => {
    if (!accountId) {
      lastSynced.current = undefined;
      mustSyncAfterSave.current = false;
      return;
    }
    if (isPreview) return;
    const wasSyncedForThisAccount =
      lastSynced.current?.accountId === accountId &&
      lastSynced.current.portal === portal;
    if (isSavingAccountContrast) {
      // Der Abgleich dieser Sitzung wurde wegen einer fremden, noch laufenden
      // Speicherung übersprungen. Sobald sie endet, muss diese Sitzung laden.
      mustSyncAfterSave.current ||= !wasSyncedForThisAccount;
      return;
    }
    if (wasSyncedForThisAccount && !mustSyncAfterSave.current) return;
    mustSyncAfterSave.current = false;
    lastSynced.current = { accountId, portal };
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
      // Ohne Antwort bleibt die Darstellung des Geräts; die nächste Änderung
      // der Sitzung oder des Portals fragt erneut.
      .catch(() => {
        if (
          !cancelled &&
          lastSynced.current?.accountId === accountId &&
          lastSynced.current.portal === portal
        )
          lastSynced.current = undefined;
      });
    return () => {
      cancelled = true;
    };
  }, [portal, accountId, isPreview, isSavingAccountContrast]);

  return null;
}
