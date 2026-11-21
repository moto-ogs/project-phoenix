/**
 * Client of the children of the families (#5918): how many children a
 * family has for the sibling rule, siblings without a care contract
 * included. The parents state a number, the Abrechnung confirms or changes
 * it with a validity. A family is named by one of its contracts, never by
 * its address. Backend int64 IDs leave here as strings; calendar dates stay
 * "YYYY-MM-DD".
 */
import { knownEnum } from "./contract/known-enum";
import type {
  FamilyChildCount as WireCount,
  FamilyChildrenRequest,
  FamilyChildrenSet as WireSet,
} from "./contract/traeger-family-children.generated";
import { traegerRequest } from "./traeger-api";
import type { CareRule } from "./traeger-care-reductions-api";

// Go does not register the set; the contract types it as string.
const STATUS_VALUES = [
  "missing",
  "stated",
  "changed",
  "confirmed",
  "expiring",
  "expired",
  "upcoming",
  // Contracts that became one family brought different numbers (#7356).
  "differing",
] as const;

/** The state of a family's number today; the most urgent check wins. */
export type FamilyChildrenStatus = (typeof STATUS_VALUES)[number];

export interface FamilyChildCount {
  readonly id: string;
  readonly contractId: string;
  readonly statedChildren: number | null;
  /** Instant of the parents' statement, RFC 3339. */
  readonly statedAt: string | null;
  readonly confirmedChildren: number | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly confirmedAt: string | null;
}

interface FamilyContractChild {
  readonly contractId: string;
  readonly schoolName: string;
  readonly childFirstName: string;
  readonly childLastName: string;
}

export interface FamilyChildren {
  /**
   * One contract of the family: it names the family in a request. A family
   * without a mail address is known only by this contract (#7356).
   */
  readonly contractId: string;
  readonly recipientFirstName: string;
  readonly recipientLastName: string;
  /** "" for a family without a mail address. */
  readonly recipientEmail: string;
  readonly children: readonly FamilyContractChild[];
  readonly count: FamilyChildCount | null;
  /** undefined: a state this build does not know. */
  readonly status: FamilyChildrenStatus | undefined;
}

export interface FamilyChildrenSet {
  readonly families: readonly FamilyChildren[];
  /** The sibling rules that count the family's number. */
  readonly rules: readonly Pick<CareRule, "id" | "name">[];
}

export interface FamilyChildrenInput {
  readonly contractId: string;
  readonly children: number;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

const PATH = "/api/traeger/family-children";

function countFromBackend(count: WireCount): FamilyChildCount {
  return {
    id: count.id,
    contractId: count.contract_id,
    statedChildren: count.stated_children,
    statedAt: count.stated_at,
    confirmedChildren: count.confirmed_children,
    validFrom: count.valid_from,
    validUntil: count.valid_until,
    confirmedAt: count.confirmed_at,
  };
}

function familyChildrenSetFromBackend(body: WireSet): FamilyChildrenSet {
  return {
    families: (body.families ?? []).map((family) => ({
      contractId: family.contract_id,
      recipientFirstName: family.recipient_first_name,
      recipientLastName: family.recipient_last_name,
      recipientEmail: family.recipient_email,
      children: (family.children ?? []).map((child) => ({
        contractId: child.contract_id,
        schoolName: child.school_name,
        childFirstName: child.child_first_name,
        childLastName: child.child_last_name,
      })),
      count: family.count ? countFromBackend(family.count) : null,
      status: knownEnum(STATUS_VALUES, family.status),
    })),
    rules: (body.rules ?? []).map((rule) => ({
      id: rule.id,
      name: rule.name,
    })),
  };
}

export async function fetchFamilyChildren(): Promise<FamilyChildrenSet> {
  return familyChildrenSetFromBackend(await traegerRequest<WireSet>(PATH));
}

/** Confirms or changes the number of the family of a contract. */
export async function confirmFamilyChildren(
  input: FamilyChildrenInput,
): Promise<FamilyChildrenSet> {
  return familyChildrenSetFromBackend(
    // traegerRequest writes the JSON itself: a string here went out as a
    // JSON string, and Go refused it (parent_billing.family_children_invalid).
    await traegerRequest<WireSet>(PATH, {
      method: "PUT",
      body: {
        contract_id: input.contractId,
        children: input.children,
        valid_from: input.validFrom,
        valid_until: input.validUntil,
      } satisfies FamilyChildrenRequest,
    }),
  );
}

/**
 * Removes the number of the family of a contract and reads the list again:
 * the route answers a removal without a body, as every DELETE does.
 */
export async function removeFamilyChildren(
  contractId: string,
): Promise<FamilyChildrenSet> {
  await traegerRequest<void>(`${PATH}/${encodeURIComponent(contractId)}`, {
    method: "DELETE",
  });
  return fetchFamilyChildren();
}
