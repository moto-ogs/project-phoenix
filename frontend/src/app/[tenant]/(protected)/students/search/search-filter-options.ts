import { STUDENT_SEARCH_YEAR_OPTIONS } from "~/lib/student-search-url";

export type StatusFilter =
  | "all"
  | "anwesend"
  | "schule"
  | "unterricht"
  | "abwesend"
  | "unterwegs"
  | "schulhof"
  | "krank"
  | "klassenfahrt"
  | "entschuldigt"
  | "entschuldigt-klassenfahrt";
export type BooleanFilter = "all" | "yes" | "no";
export type PickupStatusFilter = "all" | "self" | "pickedUp" | "none";
export type DayStatusFilter = "all" | "comes_today" | "not_coming_today";
export type SortMode = "name" | "arrival" | "pickup";
export type GroupMode =
  | "none"
  | "status"
  | "room"
  | "arrival"
  | "pickup"
  | "pickup-status"
  | "companions";

export const STATUS_FILTER_OPTIONS: Array<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "all", label: "Alle" },
  { value: "anwesend", label: "Anwesend" },
  { value: "schule", label: "Schule" },
  { value: "unterricht", label: "Im Unterricht" },
  { value: "abwesend", label: "Zuhause" },
  { value: "krank", label: "Krank" },
  { value: "klassenfahrt", label: "Klassenfahrt" },
  { value: "entschuldigt", label: "Entschuldigt" },
  {
    value: "entschuldigt-klassenfahrt",
    label: "Entschuldigt oder Klassenfahrt",
  },
  { value: "unterwegs", label: "Unterwegs" },
  { value: "schulhof", label: "Schulhof" },
];

export const DAY_STATUS_FILTER_OPTIONS: Array<{
  value: DayStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Alle Kinder" },
  { value: "comes_today", label: "Kommt heute" },
  { value: "not_coming_today", label: "Kommt heute nicht" },
];

// Same wire values evaluated for a non-today planning date (#1939) — the UI
// must not say "heute" when the selection refers to another day, so the label
// drops it ("Kommt" / "Kommt nicht") while staying the same Kommt/-nicht filter.
export const DAY_STATUS_FILTER_OPTIONS_OTHER_DAY: Array<{
  value: DayStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Alle Kinder" },
  { value: "comes_today", label: "Kommt" },
  { value: "not_coming_today", label: "Kommt nicht" },
];

export const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "name", label: "Name A-Z" },
  { value: "arrival", label: "Nächste Ankunft" },
  { value: "pickup", label: "Nächste Abholung" },
];

export const GROUP_OPTIONS: Array<{ value: GroupMode; label: string }> = [
  // Nicht „Liste“: so heißt seit #3834 der Umschalter Kacheln/Liste.
  { value: "none", label: "Nicht gruppiert" },
  { value: "status", label: "Nach Status" },
  { value: "room", label: "Nach Raum" },
  { value: "arrival", label: "Nach Ankunftszeit" },
  { value: "pickup", label: "Nach Gehzeit" },
  { value: "pickup-status", label: "Nach Abholregelung" },
  { value: "companions", label: "Nach Laufgemeinschaft" },
];

// The "Stufe" filter is a multi-select (#2218): an empty selection already
// means "alle Stufen", so the neutral pseudo-option would be a second way to
// say the same thing — and a checkable one at that.
export const SCHOOL_YEAR_MULTI_OPTIONS = STUDENT_SEARCH_YEAR_OPTIONS.map(
  (option) => ({
    value: option.value,
    label: `Stufe ${option.label}`,
  }),
);

export const BUS_FILTER_OPTIONS: Array<{
  value: BooleanFilter;
  label: string;
}> = [
  { value: "all", label: "Alle Kinder" },
  { value: "yes", label: "Buskind" },
  { value: "no", label: "Kein Buskind" },
];

export const PHOTO_CONSENT_FILTER_OPTIONS: Array<{
  value: BooleanFilter;
  label: string;
}> = [
  { value: "all", label: "Alle Kinder" },
  { value: "yes", label: "Fotoerlaubnis liegt vor" },
  { value: "no", label: "Keine Fotoerlaubnis" },
];

export const PICKUP_STATUS_FILTER_OPTIONS: Array<{
  value: PickupStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Alle Kinder" },
  { value: "self", label: "Geht alleine nach Hause" },
  { value: "pickedUp", label: "Wird abgeholt" },
  { value: "none", label: "Keine Abholregelung" },
];

// Status options split by what they read: the location-derived buckets only
// answer for today, the absence buckets come from the status days of whichever
// date is selected (#1939).
export const LIVE_STATUS_FILTER_OPTIONS = [
  { value: "anwesend", label: "Anwesend" },
  { value: "schule", label: "Schule" },
  { value: "unterricht", label: "Im Unterricht" },
  { value: "abwesend", label: "Zuhause" },
  { value: "unterwegs", label: "Unterwegs" },
  { value: "schulhof", label: "Schulhof" },
] as const;

export const PLANNED_ABSENCE_STATUS_FILTER_OPTIONS = [
  { value: "krank", label: "Krank" },
  { value: "klassenfahrt", label: "Klassenfahrt" },
  { value: "entschuldigt", label: "Entschuldigt" },
  {
    value: "entschuldigt-klassenfahrt",
    label: "Entschuldigt oder Klassenfahrt",
  },
] as const;

export function isPlannedAbsenceStatusFilter(filter: StatusFilter): boolean {
  return PLANNED_ABSENCE_STATUS_FILTER_OPTIONS.some(
    (option) => option.value === filter,
  );
}

export const STATUS_FILTER_LABELS = Object.fromEntries(
  STATUS_FILTER_OPTIONS.map((option) => [option.value, option.label]),
) as Record<StatusFilter, string>;
