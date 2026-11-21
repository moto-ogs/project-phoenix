// lib/meal-caterer-api.ts
// The school's caterer (ADR 0077): who supplies the school, its invitations,
// a new invitation, taking one back, and ending the supply. The invitation
// link reaches the caterer by mail only; the school never sees it.

import { apiErrorFromResponse } from "./api-error";
import { knownEnum } from "./contract/known-enum";
import type * as wire from "./contract/meal-caterer.generated";
import {
  type EmailAddressMark,
  knownMailOutcome,
  knownMailProviderBlock,
  type MailOutcome,
  type MailProviderBlock,
} from "./email-delivery-status";
import { sessionFetch } from "./session-cache";

const INVITATION_STATUSES = ["open", "accepted", "revoked", "expired"] as const;
type MealCatererInvitationStatus = (typeof INVITATION_STATUSES)[number];
const ADDRESS_MARKS: readonly EmailAddressMark[] = ["failed", "complained"];

export interface MealCatererInvitation {
  id: string;
  email: string;
  catererName: string;
  deliveryAddress: string;
  status: MealCatererInvitationStatus;
  expiresAt: string;
  createdAt: string;
  /** What became of the invitation's mail (#5960); unset before a mail exists. */
  mailOutcome?: MailOutcome;
  addressMark?: EmailAddressMark;
  providerBlock?: MailProviderBlock;
}

interface MealCatererSupply {
  catererName: string;
  deliveryAddress: string;
  startedAt: string;
}

export interface MealCaterer {
  supply: MealCatererSupply | null;
  invitations: MealCatererInvitation[];
}

export interface MealCatererInvitationInput {
  email: string;
  catererName: string;
  deliveryAddress: string;
}

function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function mapInvitation(
  invitation: wire.InvitationResponse,
): MealCatererInvitation {
  return {
    id: invitation.id,
    email: invitation.email,
    catererName: invitation.caterer_name,
    deliveryAddress: invitation.delivery_address,
    // An unknown state reads as expired: it offers no action.
    status: knownEnum(INVITATION_STATUSES, invitation.status) ?? "expired",
    expiresAt: invitation.expires_at,
    createdAt: invitation.created_at,
    mailOutcome: knownMailOutcome(invitation.mail_outcome),
    addressMark: knownEnum(ADDRESS_MARKS, invitation.address_mark),
    providerBlock: knownMailProviderBlock(invitation.provider_block),
  };
}

export async function getMealCaterer(): Promise<MealCaterer> {
  const response = await sessionFetch("/api/meal-caterer", {
    credentials: "include",
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response, "meal caterer load failed");
  }
  const data = unwrap<wire.SchoolCatererResponse>(await response.json());
  return {
    supply: data.supply
      ? {
          catererName: data.supply.caterer_name,
          deliveryAddress: data.supply.delivery_address,
          startedAt: data.supply.started_at,
        }
      : null,
    invitations: (data.invitations ?? []).map(mapInvitation),
  };
}

export async function inviteMealCaterer(
  input: MealCatererInvitationInput,
): Promise<MealCatererInvitation> {
  const response = await sessionFetch("/api/meal-caterer/invitations", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({
      email: input.email.trim(),
      caterer_name: input.catererName.trim(),
      delivery_address: input.deliveryAddress.trim(),
    }),
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response, "meal caterer invite failed");
  }
  return mapInvitation(unwrap<wire.InvitationResponse>(await response.json()));
}

export async function revokeMealCatererInvitation(id: string): Promise<void> {
  const response = await sessionFetch(
    `/api/meal-caterer/invitations/${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) {
    throw await apiErrorFromResponse(response, "meal caterer revoke failed");
  }
}

export async function endMealCatererSupply(): Promise<void> {
  const response = await sessionFetch("/api/meal-caterer/supply", {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(response, "meal caterer end failed");
  }
}
