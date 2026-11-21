// Client-side API of the caterer portal (ADR 0077). Every call goes through a
// Next.js route under /api/caterer/*, which forwards it with the caterer
// session to the backend's /caterer/* routes. The invitation and the
// password reset need no session: the mailed link is the proof.

import { authFetch } from "./api-helpers";
import { apiErrorFromResponse, transportFetch } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type {
  acceptRequest,
  PreviewResponse,
} from "./contract/caterer-invitations.generated";
import type {
  OrderChildResponse,
  SchoolOrdersResponse,
  SchoolsResponse,
} from "./contract/caterer-schools.generated";
import { downloadBlob, filenameFromDisposition } from "./file-download";
import type { ApiResponse } from "./api-envelope";

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
  schools: CatererSchool[];
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

/** What the acceptance page shows about a mailed invitation. */
export interface CatererInvitationPreview {
  email: string;
  catererName: string;
  schoolName: string;
  expiresAt: string;
  hasCatererAccount: boolean;
  addressTaken: boolean;
}

function mapChild(child: OrderChildResponse): CatererOrderChild {
  return {
    firstName: child.first_name ?? "",
    lastName: child.last_name ?? "",
    schoolClass: child.school_class ?? "",
  };
}

function mapCatererOrders(data: SchoolOrdersResponse): CatererOrders {
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

export async function fetchCatererSchools(): Promise<CatererSchools> {
  const response = await authFetch<ApiResponse<SchoolsResponse>>(
    "/api/caterer/schools",
  );
  return {
    catererName: response.data.caterer_name,
    schools: response.data.schools ?? [],
  };
}

export async function fetchCatererOrders(
  schoolId: string,
  from: string,
  to: string,
): Promise<CatererOrders> {
  const params = new URLSearchParams({ from, to });
  const response = await authFetch<ApiResponse<SchoolOrdersResponse>>(
    `/api/caterer/schools/${encodeURIComponent(schoolId)}/orders?${params.toString()}`,
  );
  return mapCatererOrders(response.data);
}

export async function confirmCatererOrder(
  schoolId: string,
  orderId: string,
): Promise<void> {
  await authFetch<unknown>(
    `/api/caterer/schools/${encodeURIComponent(schoolId)}/orders/${encodeURIComponent(orderId)}/confirm`,
    { method: "POST", body: {} },
  );
}

function invitationUrl(schoolId: string, token: string): string {
  return `/api/caterer/invitations/${encodeURIComponent(schoolId)}/${encodeURIComponent(token)}`;
}

export async function fetchCatererInvitation(
  schoolId: string,
  token: string,
): Promise<CatererInvitationPreview> {
  const response = await authFetch<ApiResponse<PreviewResponse>>(
    invitationUrl(schoolId, token),
  );
  return {
    email: response.data.email,
    catererName: response.data.caterer_name,
    schoolName: response.data.school_name,
    expiresAt: response.data.expires_at,
    hasCatererAccount: response.data.has_caterer_account,
    addressTaken: response.data.address_taken,
  };
}

export async function acceptCatererInvitation(
  schoolId: string,
  token: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
  await authFetch<unknown>(`${invitationUrl(schoolId, token)}/accept`, {
    method: "POST",
    body: {
      password,
      confirm_password: confirmPassword,
    } satisfies acceptRequest,
  });
}

export type DeliveryExportFormat = "pdf" | "xlsx" | "csv";

/**
 * Downloads the delivery list of every school the caterer supplies for
 * [from, to] (#3873): date, school, delivery address, class, meals, change.
 */
export async function downloadCatererDeliveries(
  from: string,
  to: string,
  format: DeliveryExportFormat,
): Promise<void> {
  const params = new URLSearchParams({ from, to, format });
  const response = await transportFetch(
    `/api/caterer/orders/export?${params.toString()}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      "caterer delivery export failed",
    );
  }
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ??
      `lieferliste-${from}-bis-${to}.${format}`,
  );
}
