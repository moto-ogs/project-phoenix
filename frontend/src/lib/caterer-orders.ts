import { knownEnum } from "./contract/known-enum";
import type * as catererSchoolsContract from "./contract/caterer-schools.generated";

// Go does not register these sets; the contract types them as string. A value
// this build does not know stays undefined instead of passing as a known one.
const ORDER_STATUS_VALUES = [
  "open",
  "ordered",
  "confirmed",
  "unordered",
] as const;
const RHYTHM_VALUES = ["daily", "weekly"] as const;
const DETAIL_VALUES = ["total", "by_class"] as const;

type CatererOrderStatus = (typeof ORDER_STATUS_VALUES)[number];

export interface CatererSchool {
  id: string;
  name: string;
}

export interface CatererSchools {
  catererName: string;
  schools: CatererSchoolSummary[];
}

export interface CatererSummaryDay extends Pick<
  CatererOrderDay,
  "date" | "closed" | "deadline" | "status" | "orderId" | "total"
> {
  added: number;
  removed: number;
}

export interface CatererSchoolSummary extends CatererSchool {
  days: CatererSummaryDay[];
  failure: { code: string; status: number } | null;
  grant: string;
  deliveryAddress: string;
}

/** A child in an order: a name only while the school shows names. */
export interface CatererOrderChild {
  firstName: string;
  lastName: string;
  schoolClass: string;
}

interface CatererOrderChange {
  sequence: number;
  child: CatererOrderChild;
  delta: number;
  detectedAt: string;
}

export interface CatererOrderDay {
  date: string;
  closed: boolean;
  deadline: string;
  /** undefined: a status this build does not know. */
  status: CatererOrderStatus | undefined;
  orderId: string | null;
  confirmedAt: string | null;
  total: number;
  classes: { schoolClass: string; count: number }[];
  children: CatererOrderChild[];
  changes: CatererOrderChange[];
}

export interface CatererOrders {
  school: CatererSchool;
  deliveryAddress: string;
  /** undefined: a value this build does not know. */
  rhythm: (typeof RHYTHM_VALUES)[number] | undefined;
  /** undefined: a value this build does not know; the list shows the total. */
  detail: (typeof DETAIL_VALUES)[number] | undefined;
  days: CatererOrderDay[];
}

function mapChild(
  child: catererSchoolsContract.OrderChildResponse,
): CatererOrderChild {
  return {
    firstName: child.first_name ?? "",
    lastName: child.last_name ?? "",
    schoolClass: child.school_class ?? "",
  };
}

export function mapCatererOrders(
  data: catererSchoolsContract.SchoolOrdersResponse,
): CatererOrders {
  return {
    school: data.school,
    deliveryAddress: data.delivery_address,
    rhythm: knownEnum(RHYTHM_VALUES, data.rhythm),
    detail: knownEnum(DETAIL_VALUES, data.detail),
    days: (data.days ?? []).map((day) => ({
      date: day.date,
      closed: day.closed,
      deadline: day.deadline,
      status: knownEnum(ORDER_STATUS_VALUES, day.status),
      orderId: day.order_id ?? null,
      confirmedAt: day.confirmed_at ?? null,
      total: day.total,
      classes: (day.classes ?? []).map((count) => ({
        schoolClass: count.school_class,
        count: count.count,
      })),
      children: (day.children ?? []).map(mapChild),
      changes: (day.changes ?? []).map((change) => ({
        sequence: change.sequence,
        child: mapChild(change.child),
        delta: change.delta,
        detectedAt: change.detected_at,
      })),
    })),
  };
}

export function mapCatererOverview(
  data: catererSchoolsContract.SchoolsResponse,
): CatererSchools {
  return {
    catererName: data.caterer_name,
    schools: (data.schools ?? []).map((school) => ({
      id: school.id,
      name: school.name,
      deliveryAddress: school.delivery_address,
      failure: school.failure ?? null,
      grant: [school.started_at, school.names, school.by_class].join("/"),
      days: (school.days ?? []).map((day) => ({
        date: day.date,
        closed: day.closed,
        deadline: day.deadline,
        total: day.total,
        status: knownEnum(ORDER_STATUS_VALUES, day.status),
        orderId: day.order_id ?? null,
        added: day.added,
        removed: day.removed,
      })),
    })),
  };
}
