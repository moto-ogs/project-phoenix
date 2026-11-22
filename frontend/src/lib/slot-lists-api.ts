// Client API + types for slot lists (issue #1565): lists from selected
// timetable slots or Ganztag pickup cohorts with three data modes
// (Plan / Ist / Abgleich) and PDF/XLSX export.

import { bffFile, bffJson } from "~/lib/bff-fetch";
import type * as timetableContract from "~/lib/contract/timetable.generated";
import {
  downloadBlob,
  filenameFromDisposition,
  openBlobForPrint,
} from "~/lib/file-download";

export type SlotListTarget = "slots" | "pickup_cohort";

export type SlotListPickupCohort = "short_day" | "long_day";

export type SlotListKind =
  "edge_hours" | "learning_time" | "activity" | "mensa";

export type SlotListSource = "planned" | "actual" | "reconciliation";

export type SlotListGroupBy = "" | "slot" | "room" | "class" | "pickup_time";

export type SlotListFormat = "pdf" | "xlsx";

/**
 * The request of a preview or export: the contract's `slotListRequest` with
 * the closed value sets of the screen. `instance_ids` omitted = all
 * selectable slots, [] = none; `group_ids`/`classes` omitted or empty = all;
 * `group_by` omitted or "" = one flat list. `expected_signature` (export
 * only) is the reviewed preview's `signature`: the backend refuses with 409
 * when its fresh rebuild no longer matches.
 */
export type SlotListRequest = Omit<
  timetableContract.slotListRequest,
  "target" | "pickup_cohort" | "list_kind" | "source" | "group_by" | "format"
> & {
  date: string;
  target: SlotListTarget;
  pickup_cohort?: SlotListPickupCohort;
  list_kind?: SlotListKind;
  source: SlotListSource;
  group_by?: SlotListGroupBy;
};

export const SLOT_LIST_KIND_LABELS: Record<SlotListKind, string> = {
  edge_hours: "Randstunden",
  learning_time: "Lernzeit",
  activity: "AG-Angebote",
  mensa: "Mensa",
};

export const SLOT_LIST_SOURCE_LABELS: Record<SlotListSource, string> = {
  planned: "Plan",
  actual: "Ist",
  reconciliation: "Abgleich",
};

export const SLOT_LIST_GROUP_BY_LABELS: Record<SlotListGroupBy, string> = {
  "": "Keine",
  slot: "Angebot",
  room: "Raum",
  class: "Klasse",
  pickup_time: "Abholzeit",
};

// Valid grouping options per target — mirrors GroupBy.ValidFor on the backend.
export function groupByOptionsFor(target: SlotListTarget): SlotListGroupBy[] {
  return target === "pickup_cohort"
    ? ["", "class", "pickup_time"]
    : ["", "slot", "room", "class"];
}

// Go writes empty lists as null; the screen reads them as empty lists.
type WithLists<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: NonNullable<T[P]>;
};

export type SlotListOptionsResult = WithLists<
  timetableContract.OptionsResult,
  "slots" | "pickup_cohorts" | "list_kinds"
>;

/** `signature` goes back as an export's `expected_signature`. */
export type SlotListResult = WithLists<
  timetableContract.ClassdayResult,
  "slots" | "groups" | "classes" | "rows"
>;

export async function fetchSlotListOptions(
  date: string,
): Promise<SlotListOptionsResult> {
  const options = await bffJson("tenant", "POST /api/timetable/lists/options", {
    body: { date },
    errorMessage: "slot list options failed",
  });
  return {
    ...options,
    slots: options.slots ?? [],
    pickup_cohorts: options.pickup_cohorts ?? [],
    list_kinds: options.list_kinds ?? [],
  };
}

export async function fetchSlotListPreview(
  request: SlotListRequest,
): Promise<SlotListResult> {
  const result = await bffJson("tenant", "POST /api/timetable/lists/preview", {
    body: request,
    errorMessage: "slot list preview failed",
  });
  return {
    ...result,
    slots: result.slots ?? [],
    groups: result.groups ?? [],
    classes: result.classes ?? [],
    rows: result.rows ?? [],
  };
}

export type SlotListExportMode = "download" | "print";

// Thrown when the caller's commitGuard reports the live selection no longer
// matches the exported request AFTER the file has been built but BEFORE it is
// handed out. Distinct from the ApiError of a failed export so the caller can show a
// "selection changed" hint instead of logging an export failure (#1565 review
// pass 10).
export class SlotListExportSupersededError extends Error {
  constructor() {
    super("slot list export superseded by a newer selection");
    this.name = "SlotListExportSupersededError";
  }
}

export async function exportSlotList(
  request: SlotListRequest,
  format: SlotListFormat,
  mode: SlotListExportMode,
  preOpenedPrintTarget?: Window | null,
  expectedSignature?: string,
  // Evaluated after the export response arrives but before the file is handed
  // out (download/print). Returning false aborts the handoff — the caller's
  // selection moved on during the export round-trip, so the built file is stale.
  commitGuard?: () => boolean,
): Promise<void> {
  // The print tab must open synchronously while the click's transient user
  // activation is still valid: after `await fetch` popup blockers (Safari,
  // strict settings) return null from window.open and Drucken always fails.
  // When the caller runs its own async step before export (e.g. the pre-export
  // slot revalidation), it opens the placeholder during the click and hands it
  // in via preOpenedPrintTarget; we reuse it rather than opening a second tab
  // after the activation has lapsed. When no tab is supplied we open one now.
  const printTarget =
    mode === "print"
      ? preOpenedPrintTarget !== undefined
        ? preOpenedPrintTarget
        : globalThis.open("", "_blank")
      : null;
  if (mode === "print" && !printTarget) {
    throw new Error("Der Druckdialog konnte nicht geöffnet werden.");
  }

  try {
    // A refusal is an ApiError with status and code: the caller branches on
    // the 409 drift refusal (the fresh build no longer matches the reviewed
    // preview) without matching the message (#1565 review pass 2).
    const response = await bffFile(
      "tenant",
      "POST /api/timetable/lists/export",
      {
        body: { ...request, format, expected_signature: expectedSignature },
        errorMessage: "slot list export failed",
      },
    );

    const blob = await response.blob();

    // Last gate before the file leaves the building: the backend already
    // verified the signature, but the export round-trip is itself a window in
    // which the user can change the date/filters. If the live selection no
    // longer matches the exported request, abort the handoff rather than
    // download/print a document for a selection the UI has already left. The
    // catch below closes the print tab and rethrows for the caller to surface
    // (#1565 review pass 10).
    if (commitGuard && !commitGuard()) {
      throw new SlotListExportSupersededError();
    }

    if (printTarget) {
      await openBlobForPrint(blob, printTarget);
      return;
    }

    downloadBlob(
      blob,
      filenameFromDisposition(response) ?? fallbackFilename(request, format),
    );
  } catch (error) {
    printTarget?.close();
    throw error;
  }
}

function fallbackFilename(
  request: SlotListRequest,
  format: SlotListFormat,
): string {
  const source =
    request.source === "planned"
      ? "plan"
      : request.source === "actual"
        ? "ist"
        : "abgleich";
  const target =
    request.target === "pickup_cohort"
      ? request.pickup_cohort === "long_day"
        ? "ganztag-1600"
        : "ganztag-1430"
      : request.list_kind
        ? request.list_kind
        : "angebote";
  return `tagesliste-${source}-${target}-${request.date}.${format}`;
}
