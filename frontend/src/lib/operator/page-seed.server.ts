import * as authContract from "~/lib/contract/operator-auth.generated";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { cache } from "react";
import * as billingContract from "~/lib/contract/operator-billing.generated";
import * as devicesContract from "~/lib/contract/operator-devices.generated";
import * as invitationsContract from "~/lib/contract/operator-invitations.generated";
import * as organizationsContract from "~/lib/contract/operator-organizations.generated";
import * as profileContract from "~/lib/contract/operator-profile.generated";
import * as schoolsContract from "~/lib/contract/operator-schools.generated";
import * as statsContract from "~/lib/contract/operator-stats.generated";
import {
  mapBillingKeyDay,
  mapBillingKeyDateCount,
} from "~/lib/operator/billing-api";
import { mapOperatorInvitations } from "~/lib/operator/operator-invitation-api";
import {
  mapOperatorDevice,
  mapOrganization,
  mapOrganizationSummary,
  mapProvisioningStats,
  mapTraegerErasureOrder,
} from "~/lib/operator/provisioning-helpers";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { operatorKeys } from "~/lib/swr/operator-keys";
import {
  operatorBillingKeys,
  operatorInvitationKeys,
  operatorProvisioningKeys,
} from "~/lib/swr/portal-keys";

interface OperatorPageRead {
  key: string;
  load: (token: string) => Promise<unknown>;
  render?: boolean;
}

export function operatorPageSeed(
  reads: readonly OperatorPageRead[],
  dependent?: (token: string) => Promise<readonly OperatorPageRead[]>,
) {
  const builtAt = Date.now();
  const seed = readPortalSessionSnapshot("operator")
    .then(async (snapshot) => {
      if (
        !snapshot?.accessToken ||
        snapshot.notBooked ||
        snapshot.session.error ||
        snapshot.session.user.scope !== "platform"
      )
        return null;
      const token = snapshot.accessToken;
      const entries = (items: readonly OperatorPageRead[]) =>
        items.map(({ key, load, render = true }) => ({
          key,
          value: load(token),
          render,
        }));
      const independent = entries(reads);
      const additional = dependent ? entries(await dependent(token)) : [];
      return seedOf(snapshot, [...independent, ...additional], builtAt);
    })
    .catch(() => null);
  return { seed, claims: reads.map(({ key }) => key) };
}

function operatorRead<T>(
  key: string,
  name: string,
  read: (token: string, signal: AbortSignal) => Promise<T>,
) {
  return {
    key,
    load: cache((token: string) =>
      seedRead(name, (signal) => read(token, signal)),
    ),
  };
}

export type OperatorQuery = Record<string, string | string[] | undefined>;

export function operatorQueryParam(query: OperatorQuery, name: string) {
  const raw = query[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

export const organizationSummaries = operatorRead(
  operatorProvisioningKeys.organizationSummaries(),
  "operatorOrganizationSummaries",
  async (token, signal) => {
    const { data } = await readContract(
      organizationsContract.routes["GET /operator/organizations/summaries"],
      { token, signal },
    );
    return data.map(mapOrganizationSummary);
  },
);

export const provisioningStats = operatorRead(
  operatorProvisioningKeys.provisioningStats(),
  "operatorProvisioningStats",
  async (token, signal) => {
    const { data } = await readContract(
      statsContract.routes["GET /operator/stats"],
      { token, signal },
    );
    return mapProvisioningStats(data);
  },
);

export const organizations = operatorRead(
  operatorProvisioningKeys.organizations(),
  "operatorOrganizations",
  async (token, signal) => {
    const { data } = await readContract(
      organizationsContract.routes["GET /operator/organizations/"],
      { token, signal },
    );
    return data.map(mapOrganization);
  },
);

export function devicesForQuery(query: OperatorQuery) {
  const schoolId = operatorQueryParam(query, "schoolId");
  const organizationId = operatorQueryParam(query, "orgId");

  if (schoolId) {
    return operatorRead(
      operatorProvisioningKeys.schoolDevices(schoolId),
      "operatorSchoolDevices",
      async (token, signal) => {
        const { data } = await readContract(
          schoolsContract.routes["GET /operator/schools/{id}/devices"],
          { token, signal, params: { id: schoolId } },
        );
        return data.map((device) => mapOperatorDevice(device));
      },
    );
  }
  if (organizationId) return organizationDevices(organizationId);
  return operatorRead(
    operatorProvisioningKeys.allDevices(),
    "operatorAllDevices",
    async (token, signal) => {
      const { data } = await readContract(
        devicesContract.routes["GET /operator/devices/"],
        { token, signal },
      );
      return data.map((device) => mapOperatorDevice(device));
    },
  );
}

export function organizationDevices(id: string) {
  return operatorRead(
    operatorProvisioningKeys.orgDevices(id),
    "operatorOrganizationDevices",
    async (token, signal) => {
      const { data } = await readContract(
        organizationsContract.routes[
          "GET /operator/organizations/{id}/devices"
        ],
        { token, signal, params: { id } },
      );
      return data.map((device) => mapOperatorDevice(device));
    },
  );
}

export function organizationErasureOrder(id: string) {
  return operatorRead(
    operatorProvisioningKeys.orgErasureOrder(id),
    "operatorOrganizationErasureOrder",
    async (token, signal) => {
      const { data } = await readContract(
        organizationsContract.routes[
          "GET /operator/organizations/{id}/erasure-order"
        ],
        { token, signal, params: { id } },
      );
      return data ? mapTraegerErasureOrder(data) : null;
    },
  );
}

export const operatorProfile = operatorRead(
  operatorKeys.profile(),
  "operatorProfile",
  async (token, signal) => {
    const { data } = await readContract(
      profileContract.routes["GET /operator/profile/"],
      { token, signal },
    );
    return data;
  },
);

export const operatorInvitations = operatorRead(
  operatorInvitationKeys.list(),
  "operatorInvitations",
  async (token, signal) => {
    const { data } = await readContract(
      invitationsContract.routes["GET /operator/invitations/"],
      { token, signal },
    );
    return mapOperatorInvitations(data);
  },
);

export const billingKeyDay = operatorRead(
  operatorBillingKeys.keyDay(),
  "operatorBillingKeyDay",
  async (token, signal) => {
    const { data } = await readContract(
      billingContract.routes["GET /operator/billing/key-day"],
      { token, signal },
    );
    return mapBillingKeyDay(data);
  },
);

export const billingCounts = operatorRead(
  operatorBillingKeys.counts(),
  "operatorBillingCounts",
  async (token, signal) => {
    const { data } = await readContract(
      billingContract.routes["GET /operator/billing/key-date-counts"],
      { token, signal },
    );
    return data.map(mapBillingKeyDateCount);
  },
);

export const operatorPasskeys = operatorRead(
  tenantAdminKeys.passkeys("operator"),
  "operatorPasskeys",
  async (token, signal) => {
    const { data } = await readContract(
      authContract.routes["GET /operator/auth/passkeys"],
      { token, signal },
    );
    return data ?? [];
  },
);

export const operatorTrustedDevices = operatorRead(
  tenantAdminKeys.trustedDevices("operator"),
  "operatorTrustedDevices",
  async (token, signal) => {
    const { data } = await readContract(
      authContract.routes["GET /operator/auth/mfa/trusted-devices"],
      { token, signal },
    );
    return data ?? [];
  },
);
