"use client";

import { useTraegerResource } from "./use-traeger-resource";
import { traegerKeys } from "~/lib/swr/traeger-keys";
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
