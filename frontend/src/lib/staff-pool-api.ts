/**
 * Vertretungspool des Trägers (#4709, ADR 0089 §9, ADR 0252).
 *
 * Ein Arbeitsvertrag mit dem Merkmal „Vertretungspool“ macht die Person zum
 * Springer. Jede Schule des Trägers sieht die Springer mit Name, Stand der
 * Nachweise und geblockten Zeiten und blockt sie für einen Tag und eine Zeit.
 * Zwei Blockungen eines Springers überschneiden sich nie. Eine Blockung einer
 * anderen Schule nennt nur diese Schule. Die Personalverwaltung sieht jede
 * Blockung und hebt sie auf. Jede Ansicht steht im Zugriffsprotokoll.
 */
import { bffFile, bffJson } from "~/lib/bff-fetch";
import type * as wire from "~/lib/contract/shared.generated";
import {
  downloadTraegerList,
  type TraegerListFile,
  type TraegerListFormat,
  listExportQuery,
} from "~/lib/traeger-list-export";

type PoolProofState = "complete" | "missing" | "expiring";

export interface PoolProof {
  readonly typeName: string;
  readonly status: PoolProofState;
  /** "YYYY-MM-DD" oder `null` ohne Ablauf. */
  readonly expiresOn: string | null;
}

export interface PoolBlock {
  /** Nur bei eigenen Blockungen (und immer beim Träger). */
  readonly id: string | null;
  readonly schoolId: string;
  readonly schoolName: string;
  /** Die Blockung gehört der lesenden Schule. */
  readonly own: boolean;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "HH:MM" */
  readonly startTime: string;
  /** "HH:MM" */
  readonly endTime: string;
  /** Die Personalverwaltung hat diese eigene Blockung aufgehoben. */
  readonly lifted: boolean;
}

export interface PoolSpringer {
  readonly recordId: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Erster Tag im Pool, "YYYY-MM-DD". */
  readonly poolFrom: string;
  /** Letzter Tag im Pool; `null` ohne Ende. */
  readonly poolUntil: string | null;
  readonly proofs: readonly PoolProof[];
  readonly blocks: readonly PoolBlock[];
}

export interface PoolWeek {
  /** Montag der Woche, "YYYY-MM-DD". */
  readonly weekStart: string;
  readonly today: string;
  /** `false`: der Träger führt sein Personal nicht in moto. */
  readonly available: boolean;
  readonly springers: readonly PoolSpringer[];
}

export interface PoolBlockInput {
  readonly recordId: string;
  /** "YYYY-MM-DD" */
  readonly date: string;
  /** "HH:MM" */
  readonly startTime: string;
  /** "HH:MM" */
  readonly endTime: string;
}

/** A day the contract allows as null; "" never matches a real day. */
const day = (value: string | null | undefined): string =>
  (value ?? "").slice(0, 10);

const proofState = (status: string): PoolProofState =>
  status === "complete" || status === "expiring" ? status : "missing";

function mapPoolBlock(block: wire.PoolBlock): PoolBlock {
  return {
    id: block.id ?? null,
    schoolId: block.school_id,
    schoolName: block.school_name,
    own: block.own,
    date: day(block.date),
    startTime: block.start_time.slice(0, 5),
    endTime: block.end_time.slice(0, 5),
    lifted: block.lifted,
  };
}

export function mapPoolWeek(week: wire.PoolWeek): PoolWeek {
  return {
    weekStart: day(week.week_start),
    today: day(week.today),
    available: week.available,
    springers: (week.springers ?? []).map((springer) => ({
      recordId: springer.staff_record_id,
      firstName: springer.first_name,
      lastName: springer.last_name,
      poolFrom: day(springer.pool_from),
      poolUntil: springer.pool_until ? day(springer.pool_until) : null,
      proofs: (springer.proofs ?? []).map((proof) => ({
        typeName: proof.type_name,
        status: proofState(proof.status),
        expiresOn: proof.expires_on ? day(proof.expires_on) : null,
      })),
      blocks: (springer.blocks ?? []).map(mapPoolBlock),
    })),
  };
}

/** Die Springer der Woche, in der `weekStart` liegt, für die eigene Schule. */
export async function fetchSchoolPoolWeek(
  weekStart: string,
): Promise<PoolWeek> {
  const week = await bffJson("tenant", "GET /api/staff-pool/", {
    query: { week: weekStart },
    errorMessage: "staff pool load failed",
  });
  return mapPoolWeek(week);
}

export async function blockSpringer(input: PoolBlockInput): Promise<PoolBlock> {
  const block = await bffJson("tenant", "POST /api/staff-pool/blocks", {
    body: {
      staff_record_id: input.recordId,
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
    },
    errorMessage: "staff pool block failed",
  });
  return mapPoolBlock(block);
}

export async function liftSchoolBlock(blockId: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/staff-pool/blocks/{id}", {
    params: { id: blockId },
    errorMessage: "staff pool lift failed",
  });
}

/** Der ganze Pool des Trägers in der Woche von `weekStart`. */
export async function fetchTraegerPoolWeek(
  weekStart: string,
): Promise<PoolWeek> {
  const week = await bffJson("org", "GET /traeger/staff-pool/", {
    query: { week: weekStart },
    errorMessage: "staff pool week failed",
  });
  return mapPoolWeek(week);
}

/** Die Blockungen der Woche als PDF, Excel oder CSV (#4718). */
export function downloadTraegerPoolWeek(
  weekStart: string,
  format: TraegerListFormat,
): Promise<TraegerListFile> {
  return downloadTraegerList(
    bffFile("org", "GET /traeger/staff-pool/export", {
      query: listExportQuery(format, {
        week: weekStart,
      }),
    }),
  );
}

export async function liftTraegerBlock(blockId: string): Promise<void> {
  await bffJson("org", "DELETE /traeger/staff-pool/blocks/{id}", {
    params: { id: blockId },
    errorMessage: "staff pool lift failed",
  });
}

/** Der Stand der Nachweise in einem Wort, für das Abzeichen der Zeile. */
export function proofSummary(proofs: readonly PoolProof[]): {
  readonly tone: "success" | "warning" | "danger" | "neutral";
  readonly label: string;
} {
  const missing = proofs.filter((proof) => proof.status === "missing").length;
  const expiring = proofs.filter((proof) => proof.status === "expiring").length;
  if (proofs.length === 0) return { tone: "neutral", label: "Keine Nachweise" };
  if (missing > 0)
    return {
      tone: "danger",
      label: missing === 1 ? "1 Nachweis fehlt" : `${missing} Nachweise fehlen`,
    };
  if (expiring > 0)
    return {
      tone: "warning",
      label:
        expiring === 1
          ? "1 Nachweis läuft ab"
          : `${expiring} Nachweise laufen ab`,
    };
  return { tone: "success", label: "Nachweise vollständig" };
}

/** Der Springer ist an diesem Tag im Pool. */
export function inPool(springer: PoolSpringer, date: string): boolean {
  return (
    springer.poolFrom <= date &&
    (springer.poolUntil === null || date <= springer.poolUntil)
  );
}
