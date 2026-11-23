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
  contactVersion: "",
  withdrawalVersion: "",
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

  /**
   * Reads again after a refused save and answers the stored master data;
   * rejects when the read fails (ADR 0311, rule 6).
   */
  const reload = useCallback(async () => {
    const next = await fetchTraegerMasterData();
    await mutate(next, { revalidate: false });
    return next;
  }, [mutate]);

  /** Hands a section's save answer to the read (ADR 0311, rule 5). */
  const write = useCallback(
    (change: Partial<TraegerMasterData>) =>
      mutate((current) => (current ? { ...current, ...change } : current), {
        revalidate: false,
      }),
    [mutate],
  );

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
    reload,
    write,
    refresh,
  };
}
