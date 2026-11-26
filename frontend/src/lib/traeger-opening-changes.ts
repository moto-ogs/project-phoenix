// Geänderte Öffnungszeiten des Trägers (#8202): das Träger-Büro plant einen
// Tag mit anderen Öffnungszeiten für einige oder alle seine Schulen. Lesen
// braucht „Übersicht sehen“, Planen „Einstellungen verwalten“. Eine Änderung
// trägt die gelesene Version (ADR 0311).
import { bffJson } from "~/lib/bff-fetch";
import type * as contract from "~/lib/contract/traeger-opening-changes.generated";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "TraegerOpeningChanges" });

/** Ein Zeitraum mit anderen Öffnungszeiten an den genannten Schulen. */
export interface TraegerOpeningChange {
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly reason: string;
  readonly schoolIds: readonly string[];
  readonly version: string;
}

/** Was das Formular sendet. */
export interface TraegerOpeningChangeInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly reason: string;
  readonly schoolIds: readonly string[];
}

export function mapTraegerOpeningChange(
  raw: contract.OpeningChange,
): TraegerOpeningChange {
  return {
    id: raw.id,
    startDate: raw.start_date ?? "",
    endDate: raw.end_date ?? "",
    opensAt: raw.opens_at,
    closesAt: raw.closes_at,
    reason: raw.reason,
    schoolIds: raw.school_ids ?? [],
    version: raw.version,
  };
}

function requestBody(
  input: TraegerOpeningChangeInput,
): contract.TraegerOpeningChangeRequest {
  return {
    start_date: input.startDate,
    end_date: input.endDate,
    opens_at: input.opensAt,
    closes_at: input.closesAt,
    reason: input.reason,
    school_ids: [...input.schoolIds],
  };
}

export async function fetchTraegerOpeningChanges(
  from: string,
  to: string,
): Promise<TraegerOpeningChange[]> {
  const rows = await bffJson("org", "GET /traeger/opening-changes/", {
    query: { from, to },
  });
  return rows.map(mapTraegerOpeningChange);
}

export async function createTraegerOpeningChange(
  input: TraegerOpeningChangeInput,
): Promise<TraegerOpeningChange> {
  const raw = await bffJson("org", "POST /traeger/opening-changes/", {
    body: requestBody(input),
  });
  logger.info("traeger_opening_change_created", { opening_change_id: raw.id });
  return mapTraegerOpeningChange(raw);
}

/** Ändert einen gespeicherten Tag in der Version, die das Büro gelesen hat. */
export async function updateTraegerOpeningChange(
  id: string,
  input: TraegerOpeningChangeInput,
  expectedVersion: string,
): Promise<TraegerOpeningChange> {
  const raw = await bffJson("org", "PUT /traeger/opening-changes/{id}", {
    params: { id },
    body: { ...requestBody(input), expected_version: expectedVersion },
  });
  logger.info("traeger_opening_change_updated", { opening_change_id: raw.id });
  return mapTraegerOpeningChange(raw);
}

export async function deleteTraegerOpeningChange(id: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/opening-changes/{id}", {
    params: { id },
  });
  logger.info("traeger_opening_change_deleted", { opening_change_id: id });
}
