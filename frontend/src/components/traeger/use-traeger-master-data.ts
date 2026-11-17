"use client";

import { useCallback, useRef } from "react";
import { useTraegerResource } from "./use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchTraegerMasterData,
  type TraegerMasterData,
} from "~/lib/traeger-api";

const EMPTY: TraegerMasterData = {
  contact: { name: "", phone: "", email: "" },
  withdrawal: { phone: "", email: "" },
  logo: null,
  bankAccounts: [],
};

/**
 * Die Stammdaten des Trägers (#4653) für die Einstellungsseiten, die sie zeigen.
 * `loaded` gilt erst nach einem vollständigen Lesen: Leere Formulare nach einem
 * Fehler würden gespeicherte Werte überschreiben. Ein fehlgeschlagenes
 * Nachladen lässt die gezeigten Werte stehen und meldet es.
 */
export function useTraegerMasterData(object: string, enabled = true) {
  const resource = useTraegerResource(
    enabled ? traegerKeys.masterData() : null,
    fetchTraegerMasterData,
    object,
  );
  const { mutate } = resource;

  /** Reads again and rejects with its own failure (`useRefreshAfterWrite`). */
  const read = useCallback(async () => {
    await mutate(fetchTraegerMasterData(), { revalidate: false });
  }, [mutate]);

  // SWR drops the answer of an overtaken read but rejects with its failure;
  // only the latest refresh may report one.
  const latest = useRef(0);
  /** Reads again; a failure shows as the load error, the values stay. */
  const refresh = useCallback(async () => {
    const run = ++latest.current;
    try {
      await read();
    } catch {
      if (run === latest.current) await mutate();
    }
  }, [mutate, read]);

  return {
    masterData: resource.data ?? EMPTY,
    loaded: resource.data !== null,
    loading: resource.loading,
    failure: resource.failure,
    error: resource.error,
    read,
    refresh,
  };
}
