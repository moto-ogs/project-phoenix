// Kinder in der Familie (#5918, #6335): Eltern geben an, wie viele Kinder
// ihre Familie hat, auch Geschwister ohne Betreuungsvertrag. Das geht im
// Vertrag im Elternportal, über den Link aus der Vertragsmail und schon bei
// der Anmeldung. Die Abrechnung des Trägers bestätigt die Zahl; erst dann
// zählt sie für die Geschwisterermäßigung.

import { bffJson } from "./bff-fetch";
import type * as enrollmentContract from "./contract/enrollment.generated";
import type * as parentMeContract from "./contract/parent-me.generated";

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

function mapContract(
  data: parentMeContract.ContractFamilyChildren,
): ParentFamilyChildren {
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
  data: enrollmentContract.RegistrationFamilyChildren,
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

// The link and the status token are credentials: a failure names the step,
// never the path that carries them.
const errorMessage = "family children request failed";

/** The number of the family at the given source. */
export async function fetchFamilyChildren(
  source: FamilyChildrenSource,
): Promise<ParentFamilyChildren> {
  switch (source.kind) {
    case "inbox":
      return mapContract(
        await bffJson(
          "parent",
          "GET /parent/me/documents/{organizationId}/contracts/{contractId}/family-children",
          {
            params: {
              organizationId: source.organizationId,
              contractId: source.contractId,
            },
          },
        ),
      );
    case "link":
      return mapContract(
        await bffJson(
          "public",
          "GET /public/care-contract-signing/{link}/family-children",
          { params: { link: source.link }, errorMessage },
        ),
      );
    case "enrollment":
      return mapRegistration(
        await bffJson(
          "public",
          "GET /api/enrollment/requests/{statusToken}/family-children",
          { params: { statusToken: source.token }, errorMessage },
        ),
      );
  }
}

/** The parents state the number of their children. */
export async function stateFamilyChildren(
  source: FamilyChildrenSource,
  children: number,
): Promise<ParentFamilyChildren> {
  // One body for all three routes.
  const body = { children };
  switch (source.kind) {
    case "inbox":
      return mapContract(
        await bffJson(
          "parent",
          "PUT /parent/me/documents/{organizationId}/contracts/{contractId}/family-children",
          {
            params: {
              organizationId: source.organizationId,
              contractId: source.contractId,
            },
            body,
          },
        ),
      );
    case "link":
      return mapContract(
        await bffJson(
          "public",
          "PUT /public/care-contract-signing/{link}/family-children",
          { params: { link: source.link }, body, errorMessage },
        ),
      );
    case "enrollment":
      return mapRegistration(
        await bffJson(
          "public",
          "PUT /api/enrollment/requests/{statusToken}/family-children",
          { params: { statusToken: source.token }, body, errorMessage },
        ),
      );
  }
}
