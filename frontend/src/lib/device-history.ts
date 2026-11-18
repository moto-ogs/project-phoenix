// Verlauf eines Geräts (Gerätelebenszyklus, #2321): wer das Gerät wann
// angelegt, geändert, gesperrt, entsperrt, übertragen oder entfernt hat.
// Schulportal und Operator-Portal zeigen dieselben Einträge; nur das
// Operator-Portal nennt die Schule, nur das Schulportal den Namen der
// Person aus der Schule.
import { apiErrorFromResponse, transportFetch } from "./api-error";
import {
  berlinTodayISO,
  formatStatusDate,
  formatTime,
  relativeDaysLabel,
} from "./date-helpers";
import {
  getDeviceStatusDisplayName,
  getDeviceTypeDisplayName,
} from "./iot-helpers";

/** What happened to the device; the backend's closed set. */
type DeviceHistoryAction =
  | "created"
  | "updated"
  | "blocked"
  | "unblocked"
  | "status_changed"
  | "key_rotated"
  | "removed"
  | "transferred_out"
  | "transferred_in";

/** One material value before and after; null where it did not exist. */
interface DeviceHistoryChange {
  readonly before: string | null;
  readonly after: string | null;
}

export interface DeviceHistoryEntry {
  readonly id: string;
  readonly action: string;
  /** `school_staff` or `operator`. */
  readonly actorKind: string;
  /** The staff member's name; null for the moto support or an account without a known person. */
  readonly actorName: string | null;
  readonly changes: Readonly<Record<string, DeviceHistoryChange>>;
  readonly occurredAt: string;
  /** The school the entry belongs to; the operator view only. */
  readonly schoolName?: string;
}

interface BackendHistoryEntry {
  id: string;
  action: string;
  actor_kind: string;
  actor_name?: string | null;
  changes?: Record<string, DeviceHistoryChange> | null;
  occurred_at: string;
  school_name?: string;
}

/** Maps the wire entry of either portal to the shared shape. */
export function mapDeviceHistoryEntry(
  raw: BackendHistoryEntry,
): DeviceHistoryEntry {
  return {
    id: raw.id,
    action: raw.action,
    actorKind: raw.actor_kind,
    actorName: raw.actor_name?.trim() ? raw.actor_name.trim() : null,
    changes: raw.changes ?? {},
    occurredAt: raw.occurred_at,
    ...(raw.school_name === undefined ? {} : { schoolName: raw.school_name }),
  };
}

/**
 * Reads the history of one of the school's devices, newest first, through
 * the session-authenticated proxy under /api/iot.
 */
export async function fetchDeviceHistory(
  deviceId: string,
): Promise<DeviceHistoryEntry[]> {
  const response = await transportFetch(
    `/api/iot/${encodeURIComponent(deviceId)}/history`,
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `device history failed (${response.status})`,
    );
  }
  const body = (await response.json()) as
    BackendHistoryEntry[] | { data?: BackendHistoryEntry[] | null };
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return rows.map(mapDeviceHistoryEntry);
}

/** The colour family of an entry's symbol. */
type DeviceHistoryTone = "green" | "red" | "blue" | "orange" | "neutral";

export interface DeviceHistoryDescription {
  /** What happened, in two or three words: „Gesperrt“. */
  readonly title: string;
  readonly tone: DeviceHistoryTone;
  /** The changed values, one line each: „Name: Eingang → Haupteingang“. */
  readonly details: readonly string[];
}

const ACTIONS: Readonly<
  Record<DeviceHistoryAction, { title: string; tone: DeviceHistoryTone }>
> = {
  created: { title: "Angelegt", tone: "green" },
  updated: { title: "Angaben geändert", tone: "blue" },
  blocked: { title: "Gesperrt", tone: "red" },
  unblocked: { title: "Entsperrt", tone: "green" },
  status_changed: { title: "Status geändert", tone: "orange" },
  key_rotated: { title: "Neuer Zugangsschlüssel", tone: "blue" },
  removed: { title: "Entfernt", tone: "red" },
  transferred_out: { title: "An andere Schule gegeben", tone: "orange" },
  transferred_in: { title: "Von anderer Schule übernommen", tone: "blue" },
};

/** The fields in the order a person reads them. */
const FIELDS: readonly { key: string; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "device_id", label: "Geräte-ID" },
  { key: "device_type", label: "Typ" },
  { key: "status", label: "Status" },
];

function isKnownAction(action: string): action is DeviceHistoryAction {
  return Object.hasOwn(ACTIONS, action);
}

function displayValue(field: string, value: string | null): string {
  if (value === null || value === "") return "–";
  if (field === "device_type") return getDeviceTypeDisplayName(value);
  if (field === "status") return getDeviceStatusDisplayName(value);
  return value;
}

/**
 * Describes one entry for the screen. A block, an unblock and a creation
 * already say what changed; their status line would only repeat it. A
 * creation lists the values the device started with.
 */
export function describeDeviceHistoryEntry(
  entry: DeviceHistoryEntry,
): DeviceHistoryDescription {
  const action = isKnownAction(entry.action)
    ? ACTIONS[entry.action]
    : { title: "Geändert", tone: "neutral" as const };
  const hideStatus =
    entry.action === "blocked" ||
    entry.action === "unblocked" ||
    entry.action === "created";
  const details: string[] = [];
  for (const { key, label } of FIELDS) {
    const change = entry.changes[key];
    if (!change || (hideStatus && key === "status")) continue;
    if (entry.action === "created") {
      if (change.after !== null)
        details.push(`${label}: ${displayValue(key, change.after)}`);
      continue;
    }
    details.push(
      `${label}: ${displayValue(key, change.before)} → ${displayValue(key, change.after)}`,
    );
  }
  return { title: action.title, tone: action.tone, details };
}

/**
 * Who made the change, as the reader of `portal` may see it: the school
 * names its own staff, the operator sees only that it was the school.
 */
export function deviceHistoryActor(
  entry: DeviceHistoryEntry,
  portal: "school" | "operator",
): string {
  if (entry.actorKind === "operator") return "moto-Support";
  if (portal === "operator") return "Personal der Schule";
  // The account is gone, or it belongs to no person of the school.
  return entry.actorName ?? "Name nicht verfügbar";
}

/** „14:05 Uhr“ in the school's time. */
export function deviceHistoryTime(entry: DeviceHistoryEntry): string {
  return `${formatTime(entry.occurredAt)} Uhr`;
}

export interface DeviceHistoryDay {
  readonly day: string;
  readonly label: string;
  readonly entries: readonly DeviceHistoryEntry[];
}

/**
 * Groups the entries by their Berlin day, newest first as they come:
 * „Heute“, „Gestern“, then the weekday with its date.
 */
export function groupDeviceHistoryByDay(
  entries: readonly DeviceHistoryEntry[],
): DeviceHistoryDay[] {
  const days: { day: string; label: string; entries: DeviceHistoryEntry[] }[] =
    [];
  for (const entry of entries) {
    const at = new Date(entry.occurredAt);
    const day = Number.isNaN(at.getTime())
      ? entry.occurredAt
      : berlinTodayISO(at);
    const last = days.at(-1);
    if (last && last.day === day) {
      last.entries.push(entry);
      continue;
    }
    const relative = relativeDaysLabel(entry.occurredAt);
    const label =
      relative === "heute"
        ? "Heute"
        : relative === "gestern"
          ? "Gestern"
          : formatStatusDate(day);
    days.push({ day, label, entries: [entry] });
  }
  return days;
}
