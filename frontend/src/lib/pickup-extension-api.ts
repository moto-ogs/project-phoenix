import { bffJson } from "./bff-fetch";
import type * as timetableContract from "./contract/timetable.generated";
/**
 * Client for the later-pickup block decisions (#3261). A child who is picked
 * up later than before may be on no block for the extra time; the backend
 * keeps an open task until the Leitung picks one or more blocks, or none.
 * Calls the catalog BFF under /api/timetable/pickup-extensions.
 */

type PickupExtensionKind = "day" | "weekday";

interface PickupExtensionBlock {
  readonly id: string;
  readonly title: string;
  readonly startTime: string;
  readonly endTime: string;
}

export interface PickupExtension {
  readonly id: string;
  readonly studentId: string;
  readonly studentName: string;
  readonly kind: PickupExtensionKind;
  /** YYYY-MM-DD, day tasks only. */
  readonly date?: string;
  /** ISO weekday 1-5, weekday tasks only. */
  readonly weekday?: number;
  /** YYYY-MM-DD, weekday tasks only. */
  readonly effectiveFrom?: string;
  /** HH:MM */
  readonly previousPickupTime: string;
  /** HH:MM */
  readonly pickupTime: string;
  readonly blocks: readonly PickupExtensionBlock[];
}

export type PickupExtensionReminder = Pick<
  PickupExtension,
  "studentName" | "kind" | "date" | "weekday" | "effectiveFrom" | "pickupTime"
>;

export function mapPickupExtensionReminder(
  task: PickupExtension,
): PickupExtensionReminder {
  const { studentName, kind, date, weekday, effectiveFrom, pickupTime } = task;
  return { studentName, kind, date, weekday, effectiveFrom, pickupTime };
}

export function mapPickupExtension(
  raw: timetableContract.pickupExtensionResponse,
): PickupExtension {
  return {
    id: raw.id,
    studentId: raw.student_id,
    studentName: raw.student_name,
    kind: raw.kind === "weekday" ? "weekday" : "day",
    ...(raw.date ? { date: raw.date } : {}),
    ...(raw.weekday ? { weekday: raw.weekday } : {}),
    ...(raw.effective_from ? { effectiveFrom: raw.effective_from } : {}),
    previousPickupTime: raw.previous_pickup_time,
    pickupTime: raw.pickup_time,
    blocks: (raw.blocks ?? []).map((block) => ({
      id: block.id,
      title: block.title,
      startTime: block.start_time,
      endTime: block.end_time,
    })),
  };
}

/** Open tasks of the school, or of one child when studentId is given. */
export async function fetchPickupExtensions(
  studentId?: string,
): Promise<PickupExtension[]> {
  const data = await bffJson(
    "tenant",
    "GET /api/timetable/pickup-extensions/",
    {
      query: { student_id: studentId || undefined },
      errorMessage: "pickup extension request failed",
    },
  );
  return (data.tasks ?? []).map(mapPickupExtension);
}

/**
 * Adds the child to the chosen blocks and closes the task. No block IDs
 * closes it without a change ("Keinem Block zuordnen").
 */
export async function resolvePickupExtension(
  taskId: string,
  blockIds: readonly string[],
): Promise<void> {
  await bffJson(
    "tenant",
    "POST /api/timetable/pickup-extensions/{id}/resolve",
    {
      params: { id: taskId },
      body: { block_ids: [...blockIds] },
      errorMessage: "pickup extension request failed",
    },
  );
}
