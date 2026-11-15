/**
 * Vertretungspool des Trägers (#4709, ADR 0089 §9, ADR 0248).
 *
 * Ein Arbeitsvertrag mit dem Merkmal „Vertretungspool“ macht die Person zum
 * Springer. Jede Schule des Trägers sieht die Springer mit Name, Stand der
 * Nachweise und geblockten Zeiten und blockt sie für einen Tag und eine Zeit.
 * Zwei Blockungen eines Springers überschneiden sich nie. Eine Blockung einer
 * anderen Schule nennt nur diese Schule. Die Personalverwaltung sieht jede
 * Blockung und hebt sie auf. Jede Ansicht steht im Zugriffsprotokoll.
 */
import { apiErrorFromResponse } from "~/lib/api-error";
import { sessionFetch } from "~/lib/session-cache";
import { traegerRequest } from "~/lib/traeger-api";

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

interface BackendBlock {
  id?: number | string | null;
  school_id: number | string;
  school_name: string;
  own: boolean;
  date: string;
  start_time: string;
  end_time: string;
  lifted: boolean;
}

interface BackendSpringer {
  staff_record_id: number | string;
  first_name: string;
  last_name: string;
  pool_from: string;
  pool_until: string | null;
  proofs:
    { type_name: string; status: string; expires_on?: string | null }[] | null;
  blocks: BackendBlock[] | null;
}

interface BackendWeek {
  week_start: string;
  today: string;
  available: boolean;
  springers: BackendSpringer[] | null;
}

const proofState = (status: string): PoolProofState =>
  status === "complete" || status === "expiring" ? status : "missing";

function mapPoolBlock(block: BackendBlock): PoolBlock {
  return {
    id: block.id === null || block.id === undefined ? null : String(block.id),
    schoolId: String(block.school_id),
    schoolName: block.school_name,
    own: block.own,
    date: block.date.slice(0, 10),
    startTime: block.start_time.slice(0, 5),
    endTime: block.end_time.slice(0, 5),
    lifted: block.lifted,
  };
}

function mapPoolWeek(week: BackendWeek): PoolWeek {
  return {
    weekStart: week.week_start.slice(0, 10),
    today: week.today.slice(0, 10),
    available: week.available,
    springers: (week.springers ?? []).map((springer) => ({
      recordId: String(springer.staff_record_id),
      firstName: springer.first_name,
      lastName: springer.last_name,
      poolFrom: springer.pool_from.slice(0, 10),
      poolUntil: springer.pool_until ? springer.pool_until.slice(0, 10) : null,
      proofs: (springer.proofs ?? []).map((proof) => ({
        typeName: proof.type_name,
        status: proofState(proof.status),
        expiresOn: proof.expires_on ? proof.expires_on.slice(0, 10) : null,
      })),
      blocks: (springer.blocks ?? []).map(mapPoolBlock),
    })),
  };
}

async function tenantRequest<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
  failure: string,
): Promise<T> {
  const response = await sessionFetch(path, {
    method: init.method,
    credentials: "include",
    cache: "no-store",
    headers:
      init.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response, failure);
  }
  const envelope = (await response.json()) as { data?: T } | null;
  return envelope?.data as T;
}

/** Die Springer der Woche, in der `weekStart` liegt, für die eigene Schule. */
export async function fetchSchoolPoolWeek(
  weekStart: string,
): Promise<PoolWeek> {
  const week = await tenantRequest<BackendWeek>(
    `/api/staff-pool?week=${encodeURIComponent(weekStart)}`,
    { method: "GET" },
    "staff pool load failed",
  );
  return mapPoolWeek(week);
}

export async function blockSpringer(input: PoolBlockInput): Promise<PoolBlock> {
  const block = await tenantRequest<BackendBlock>(
    "/api/staff-pool/blocks",
    {
      method: "POST",
      body: {
        staff_record_id: input.recordId,
        date: input.date,
        start_time: input.startTime,
        end_time: input.endTime,
      },
    },
    "staff pool block failed",
  );
  return mapPoolBlock(block);
}

export async function liftSchoolBlock(blockId: string): Promise<void> {
  await tenantRequest<unknown>(
    `/api/staff-pool/blocks/${encodeURIComponent(blockId)}`,
    { method: "DELETE" },
    "staff pool lift failed",
  );
}

/** Der ganze Pool des Trägers in der Woche von `weekStart`. */
export async function fetchTraegerPoolWeek(
  weekStart: string,
): Promise<PoolWeek> {
  const week = await traegerRequest<BackendWeek>(
    `/api/traeger/staff-pool?week=${encodeURIComponent(weekStart)}`,
  );
  return mapPoolWeek(week);
}

export async function liftTraegerBlock(blockId: string): Promise<void> {
  await traegerRequest<unknown>(
    `/api/traeger/staff-pool/blocks/${encodeURIComponent(blockId)}`,
    { method: "DELETE" },
  );
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
