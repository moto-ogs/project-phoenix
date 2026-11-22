// Kinder in der Familie (#5918, #6335): Eltern geben an, wie viele Kinder
// ihre Familie hat, auch Geschwister ohne Betreuungsvertrag. Das geht im
// Vertrag im Elternportal, über den Link aus der Vertragsmail und schon bei
// der Anmeldung. Die Abrechnung des Trägers bestätigt die Zahl; erst dann
// zählt sie für die Geschwisterermäßigung.

import { apiErrorFromResponse, transportFetch } from "./api-error";
import type {
  RegistrationFamilyChildren as WireRegistrationFamilyChildren,
  StatusFamilyChildrenRequest as WireStatusFamilyChildrenRequest,
} from "./contract/enrollment.generated";
import type {
  ContractFamilyChildren as WireContractFamilyChildren,
  familyChildrenRequest as WireContractFamilyChildrenRequest,
} from "./contract/parent-me.generated";
import type { SigningFamilyChildrenRequest as WireSigningFamilyChildrenRequest } from "./contract/public-care-contract-signing.generated";

/** Where the parents state the number. */
export type FamilyChildrenSource =
  | {
      readonly kind: "inbox";
      readonly organizationId: string;
      readonly contractId: string;
    }
  | { readonly kind: "link"; readonly link: string }
  | { readonly kind: "enrollment"; readonly token: string };

export interface ParentFamilyChildren {
  readonly statedChildren: number | null;
  /** Instant of the statement, RFC 3339. */
  readonly statedAt: string | null;
  readonly confirmedChildren: number | null;
  readonly confirmedAt: string | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  /** The parents may state a number here now. */
  readonly canState: boolean;
  /** The page asks for the number at all; false hides the card. */
  readonly asked: boolean;
  /**
   * A registration whose child is accepted: its contract carries the number.
   * A closed registration without an accepted child (rejected, withdrawn)
   * shows no card.
   */
  readonly accepted: boolean;
}

function path(source: FamilyChildrenSource): string {
  switch (source.kind) {
    case "inbox":
      return `/api/parent/me/documents/${encodeURIComponent(source.organizationId)}/contracts/${encodeURIComponent(source.contractId)}/family-children`;
    case "link":
      return `/api/public/care-contract-signing/${encodeURIComponent(source.link)}/family-children`;
    case "enrollment":
      return `/api/enrollment/requests/${encodeURIComponent(source.token)}/family-children`;
  }
}

function mapContract(data: WireContractFamilyChildren): ParentFamilyChildren {
  return {
    statedChildren: data.stated_children,
    statedAt: data.stated_at,
    confirmedChildren: data.confirmed_children,
    confirmedAt: data.confirmed_at,
    validFrom: data.valid_from,
    validUntil: data.valid_until,
    canState: data.can_state,
    asked: true,
    accepted: true,
  };
}

/** A registration has no confirmation yet: the contract brings it later. */
function mapRegistration(
  data: WireRegistrationFamilyChildren,
): ParentFamilyChildren {
  return {
    statedChildren: data.children,
    statedAt: data.stated_at,
    confirmedChildren: null,
    confirmedAt: null,
    validFrom: null,
    validUntil: null,
    canState: data.can_state,
    asked: data.asked,
    accepted: data.accepted,
  };
}

async function request(
  source: FamilyChildrenSource,
  init: RequestInit,
): Promise<ParentFamilyChildren> {
  const response = await transportFetch(path(source), {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw await apiErrorFromResponse(
      response,
      `Family children failed: ${response.status}`,
    );
  }
  const { data } = (await response.json()) as { data: unknown };
  return source.kind === "enrollment"
    ? mapRegistration(data as WireRegistrationFamilyChildren)
    : mapContract(data as WireContractFamilyChildren);
}

/** The number of the family at the given source. */
export function fetchFamilyChildren(
  source: FamilyChildrenSource,
): Promise<ParentFamilyChildren> {
  return request(source, { method: "GET" });
}

/** The parents state the number of their children. */
export function stateFamilyChildren(
  source: FamilyChildrenSource,
  children: number,
): Promise<ParentFamilyChildren> {
  return request(source, {
    method: "PUT",
    // One body for all three routes.
    body: JSON.stringify({
      children,
    } satisfies WireStatusFamilyChildrenRequest &
      WireContractFamilyChildrenRequest &
      WireSigningFamilyChildrenRequest),
  });
}
