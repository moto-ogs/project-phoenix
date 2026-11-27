// lib/meal-caterer-api.ts
// The school's caterer (ADR 0077): who supplies the school, its invitations,
// a new invitation, taking one back, and ending the supply. The invitation
// link reaches the caterer by mail only; the school never sees it.

import { bffJson } from "./bff-fetch";
import { knownEnum } from "./contract/known-enum";
import type * as wire from "./contract/meal-caterer.generated";
import {
  type EmailAddressMark,
  knownMailOutcome,
  knownMailProviderBlock,
  type MailOutcome,
  type MailProviderBlock,
} from "./email-delivery-status";

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
  const data = await bffJson("tenant", "GET /api/meal-caterer/", {
    errorMessage: "meal caterer load failed",
  });
  return mapMealCaterer(data);
}

export function mapMealCaterer(data: wire.SchoolCatererResponse): MealCaterer {
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
  return mapInvitation(
    await bffJson("tenant", "POST /api/meal-caterer/invitations", {
      body: {
        email: input.email.trim(),
        caterer_name: input.catererName.trim(),
        delivery_address: input.deliveryAddress.trim(),
      },
      errorMessage: "meal caterer invite failed",
    }),
  );
}

export async function revokeMealCatererInvitation(id: string): Promise<void> {
  await bffJson(
    "tenant",
    "DELETE /api/meal-caterer/invitations/{invitationId}",
    {
      params: { invitationId: id },
      errorMessage: "meal caterer revoke failed",
    },
  );
}

export async function endMealCatererSupply(): Promise<void> {
  await bffJson("tenant", "DELETE /api/meal-caterer/supply", {
    errorMessage: "meal caterer end failed",
  });
}
