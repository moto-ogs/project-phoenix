"use client";

import { useMemo } from "react";
import { useTraegerResource } from "./use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import type { TraegerBookedModules } from "~/lib/traeger-booked-modules";
import {
  fetchTraegerOrganization,
  type TraegerOrganization,
} from "~/lib/traeger-api";

/**
 * The Träger of the session, for the shell (#5145): its name next to the
 * logo and the test-system strip (#4658). `null` while it loads and after a
 * failed read: the shell then shows the logo alone and no strip, the pages
 * report their own load errors, and the session guard handles a session the
 * backend ended. Silent on purpose: name and strip are extras on top of
 * every page.
 */
export function useTraegerOrganization(): TraegerOrganization | null {
  return useTraegerResource(
    traegerKeys.organization(),
    fetchTraegerOrganization,
    "die Angaben des Trägers",
  ).data;
}

/**
 * The booked moto modules of the Träger for the portal frame (#6052): the
 * list once the Träger is read, and whether that read has answered at all.
 * Shares the read of `useTraegerOrganization`.
 */
export function useTraegerBookedModules(): TraegerBookedModules {
  const organization = useTraegerResource(
    traegerKeys.organization(),
    fetchTraegerOrganization,
    "die Angaben des Trägers",
  );
  const modules = organization.data?.bookedModules ?? null;
  const settled = Boolean(
    organization.data ?? organization.error ?? organization.failure,
  );
  // One object per answer: every page and card reads it through a context.
  return useMemo(() => ({ modules, settled }), [modules, settled]);
}
