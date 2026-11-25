// Client-side API of the caterer portal (ADR 0077). Every call goes through a
// Next.js route under /api/caterer/*, which forwards it with the caterer
// session to the backend's /caterer/* routes. The invitation and the
// password reset need no session: the mailed link is the proof.

import { bffFile, bffJson } from "./bff-fetch";
import {
  mapCatererOrders,
  mapCatererOverview,
  type CatererOrders,
  type CatererSchools,
} from "./caterer-orders";
export type {
  CatererOrderDay,
  CatererOrderChild,
  CatererSchool,
  CatererOrders,
} from "./caterer-orders";
import { downloadBlob, filenameFromDisposition } from "./file-download";

/** What the acceptance page shows about a mailed invitation. */
export interface CatererInvitationPreview {
  email: string;
  catererName: string;
  schoolName: string;
  expiresAt: string;
  hasCatererAccount: boolean;
  addressTaken: boolean;
}

export async function fetchCatererOverview(
  from: string,
  to: string,
  schoolId?: string,
): Promise<CatererSchools> {
  return mapCatererOverview(
    await bffJson("caterer", "GET /caterer/schools", {
      query: { from, to, school_id: schoolId },
    }),
  );
}

export async function fetchCatererOrders(
  schoolId: string,
  from: string,
  to: string,
): Promise<CatererOrders> {
  const data = await bffJson(
    "caterer",
    "GET /caterer/schools/{schoolId}/orders",
    {
      params: { schoolId },
      query: { from, to },
    },
  );
  return mapCatererOrders(data);
}

export async function confirmCatererOrder(
  schoolId: string,
  orderId: string,
): Promise<void> {
  await bffJson(
    "caterer",
    "POST /caterer/schools/{schoolId}/orders/{orderId}/confirm",
    { params: { schoolId, orderId } },
  );
}

export async function fetchCatererInvitation(
  schoolId: string,
  token: string,
): Promise<CatererInvitationPreview> {
  const data = await bffJson(
    "public",
    "GET /caterer/invitations/{schoolId}/{token}",
    // The token is a credential: the message names the step, not the path.
    { params: { schoolId, token }, errorMessage: "caterer invitation failed" },
  );
  return {
    email: data.email,
    catererName: data.caterer_name,
    schoolName: data.school_name,
    expiresAt: data.expires_at,
    hasCatererAccount: data.has_caterer_account,
    addressTaken: data.address_taken,
  };
}

export async function acceptCatererInvitation(
  schoolId: string,
  token: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
  await bffJson(
    "public",
    "POST /caterer/invitations/{schoolId}/{token}/accept",
    {
      params: { schoolId, token },
      body: { password, confirm_password: confirmPassword },
      errorMessage: "caterer invitation acceptance failed",
    },
  );
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
  const response = await bffFile("caterer", "GET /caterer/orders/export", {
    query: { from, to, format },
    errorMessage: "caterer delivery export failed",
  });
  downloadBlob(
    await response.blob(),
    filenameFromDisposition(response) ??
      `lieferliste-${from}-bis-${to}.${format}`,
  );
}
