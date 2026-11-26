import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "./logger";
import type { routes } from "./contract/settings.generated";
import type { output } from "zod";
import {
  sanitizeHomeBlockPlacements,
  sanitizeHomeBlockPolicies,
  sanitizeHomeLayoutOverrides,
  type HomeBlockPlacement,
  type HomeBlockPolicies,
  type HomeLayoutOverrides,
} from "./home-blocks";

const logger = createLogger({ component: "HomeLayoutApi" });

/** Was die Startseite zum Rendern braucht: eigene Auswahl und Vorgabe der Schule. */
export interface HomeLayoutState {
  /** Die eigene Anordnung: Reihenfolge und Breite. Leer = Standardansicht. */
  blocks: readonly HomeBlockPlacement[];
  overrides: HomeLayoutOverrides;
  policies: HomeBlockPolicies;
  /** Darf diese Person die Vorgabe der Schule ändern? */
  canManagePolicies: boolean;
  /** Der gelesene Stand der Vorgabe (ADR 0311); ein Speichern sendet ihn. */
  policiesVersion: string;
}

const EMPTY_STATE: HomeLayoutState = {
  blocks: [],
  overrides: {},
  policies: {},
  canManagePolicies: false,
  policiesVersion: "",
};

/**
 * Liest Auswahl und Vorgabe in einem Zug.
 *
 * Bei einer fehlenden Anmeldung gilt die empfohlene Ansicht. Andere Fehler
 * werden an SWR weitergereicht, damit die Startseite ihren Standard rendert
 * und SWR die Auswahl erneut laden kann.
 */
export async function fetchHomeLayout(): Promise<HomeLayoutState> {
  let layout;
  try {
    layout = await bffJson("tenant", "GET /api/settings/home-layout");
  } catch (error) {
    // Ohne Recht oder Sitzung zeigt die Startseite ihre Voreinstellung.
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return EMPTY_STATE;
    }
    logger.error("fetch_home_layout_failed", {
      status: error instanceof ApiError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return mapHomeLayout(layout);
}

type HomeLayoutAnswer = output<
  (typeof routes)["GET /api/settings/home-layout"]["response"]
>["data"];

export function mapHomeLayout(layout: HomeLayoutAnswer): HomeLayoutState {
  return {
    blocks: sanitizeHomeBlockPlacements(layout.blocks),
    overrides: sanitizeHomeLayoutOverrides(layout.overrides),
    policies: sanitizeHomeBlockPolicies(layout.policies),
    canManagePolicies: layout.can_manage_policies === true,
    policiesVersion: layout.policies_version,
  };
}

/** Speichert die eigene Auswahl. Wirft einen ApiError für den Anzeigeweg. */
export async function saveHomeLayout(
  overrides: HomeLayoutOverrides,
  blocks: readonly HomeBlockPlacement[],
): Promise<void> {
  try {
    await bffJson("tenant", "PUT /api/settings/home-layout", {
      body: { overrides, blocks: [...blocks] },
      errorMessage: "Home layout save failed",
    });
  } catch (error) {
    logger.error("save_home_layout_failed", {
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

/** Stellt die empfohlene Startseite wieder her. */
export async function resetHomeLayout(): Promise<void> {
  try {
    await bffJson("tenant", "DELETE /api/settings/home-layout", {
      errorMessage: "Home layout reset failed",
    });
  } catch (error) {
    logger.error("reset_home_layout_failed", {
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}

/** Speichert, was die Einrichtung für alle vorgibt. */
export async function saveHomeBlockPolicies(
  policies: HomeBlockPolicies,
  expectedVersion: string,
): Promise<void> {
  try {
    // Die Vorgabe ruht auf dem gelesenen Stand; hat sie inzwischen jemand
    // geändert, lehnt der Server ab (ADR 0311).
    await bffJson("tenant", "PUT /api/settings/home-layout/policies", {
      body: { policies, expected_version: expectedVersion },
      errorMessage: "Home block policies save failed",
    });
  } catch (error) {
    logger.error("save_home_block_policies_failed", {
      status: error instanceof ApiError ? error.status : undefined,
    });
    throw error;
  }
}
