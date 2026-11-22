/**
 * Freigabe „Personal beim Träger“ im Operator-Portal (#4705, ADR 0089
 * Abschnitt 2). Vor der Freigabe bestätigt der Träger eine von zwei
 * Erklärungen; das moto-Team hält sie mit der Freigabe fest.
 */
import { knownEnum } from "~/lib/contract/known-enum";
import type * as operatorOrganizationsContract from "~/lib/contract/operator-organizations.generated";
import { bffJson } from "~/lib/bff-fetch";

// Go does not register the set; the contract types it as string.
const STAFF_REPRESENTATION_VALUES = ["agreement", "none"] as const;

export type StaffRepresentation = (typeof STAFF_REPRESENTATION_VALUES)[number];

export interface TraegerStaffReleaseState {
  readonly release: {
    /** undefined: a declaration this build does not know. */
    readonly representation: StaffRepresentation | undefined;
    readonly releasedAt: string;
  } | null;
  /** Wie viele Personalakten der Träger führt. */
  readonly records: number;
}

export const traegerStaffReleaseService = {
  async getState(orgId: string): Promise<TraegerStaffReleaseState> {
    const data = await bffJson(
      "platform",
      "GET /operator/organizations/{id}/staff-release",
      { params: { id: orgId } },
    );
    return {
      release: data.release
        ? {
            representation: knownEnum(
              STAFF_REPRESENTATION_VALUES,
              data.release.representation,
            ),
            releasedAt: data.release.released_at,
          }
        : null,
      records: data.records,
    };
  },
  async grant(
    orgId: string,
    representation: StaffRepresentation,
  ): Promise<void> {
    await bffJson(
      "platform",
      "POST /operator/organizations/{id}/staff-release",
      {
        params: { id: orgId },
        body: {
          representation,
        } satisfies operatorOrganizationsContract.grantRequest,
      },
    );
  },
  async withdraw(orgId: string): Promise<void> {
    await bffJson(
      "platform",
      "DELETE /operator/organizations/{id}/staff-release",
      { params: { id: orgId } },
    );
  },
};
