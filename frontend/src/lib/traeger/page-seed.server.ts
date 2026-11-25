import * as authContract from "~/lib/contract/traeger-auth.generated";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import type { ModuleKey } from "~/lib/modules";
import * as profileContract from "~/lib/contract/traeger-profile.generated";
import * as organizationContract from "~/lib/contract/traeger-organization.generated";
import { cache } from "react";
import { hasPermission } from "~/lib/auth-utils";
import * as schoolsContract from "~/lib/contract/traeger-schools.generated";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  mapProfile,
  mapTraegerOrganization,
  toTraegerSchool,
} from "~/lib/traeger-api";

interface TraegerPageRead {
  key: string;
  load: (token: string) => Promise<unknown>;
  permission?: string;
  module?: ModuleKey;
  render?: boolean;
  after?: (token: string) => Promise<boolean>;
}

export function traegerPageSeed(
  reads: readonly TraegerPageRead[],
  dependent?: (token: string) => Promise<readonly TraegerPageRead[]>,
) {
  const builtAt = Date.now();
  const seed = readPortalSessionSnapshot("traeger")
    .then(async (snapshot) => {
      if (
        !snapshot?.accessToken ||
        snapshot.notBooked ||
        snapshot.session.error ||
        snapshot.session.user.scope !== "org" ||
        !snapshot.session.user.orgId ||
        snapshot.session.user.tenantId != null
      )
        return null;
      const token = snapshot.accessToken;
      const load = ({ load, module, after }: TraegerPageRead) => {
        const start = () =>
          after
            ? after(token).then((allowed) =>
                allowed ? load(token) : undefined,
              )
            : load(token);
        return module
          ? organization
              .load(token)
              .then((org) =>
                org?.bookedModules.includes(module) ? start() : undefined,
              )
          : start();
      };
      const entries = (items: readonly TraegerPageRead[]) =>
        items
          .filter(
            ({ permission }) =>
              !permission || hasPermission(snapshot.session, permission),
          )
          .map((read) => ({
            key: read.key,
            value: load(read),
            render: read.render ?? true,
          }));
      const independent = entries(reads);
      const additional = dependent ? entries(await dependent(token)) : [];
      return seedOf(snapshot, [...independent, ...additional], builtAt);
    })
    .catch(() => null);
  return { seed, claims: reads.map(({ key }) => key) };
}

export function traegerRead<T>(
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

export const traegerSchools = traegerRead(
  traegerKeys.schools(),
  "traegerSchools",
  async (token, signal) => {
    const { data } = await readContract(
      schoolsContract.routes["GET /traeger/schools/"],
      { token, signal },
    );
    return (data ?? []).map(toTraegerSchool);
  },
);

export const organization = traegerRead(
  traegerKeys.organization(),
  "organization",
  async (token, signal) => {
    const { data } = await readContract(
      organizationContract.routes["GET /traeger/organization/"],
      { token, signal },
    );
    return mapTraegerOrganization(data);
  },
);

export const profile = traegerRead(
  traegerKeys.profile(),
  "profile",
  async (token, signal) => {
    const { data } = await readContract(
      profileContract.routes["GET /traeger/profile/"],
      { token, signal },
    );
    return mapProfile(data);
  },
);

export const trustedDevices = {
  ...traegerRead(
    tenantAdminKeys.trustedDevices("traeger"),
    "traegerTrustedDevices",
    async (token, signal) => {
      const { data } = await readContract(
        authContract.routes["GET /traeger/auth/mfa/trusted-devices"],
        { token, signal },
      );
      return data ?? [];
    },
  ),
  after: async (token: string) => (await profile.load(token)) !== undefined,
  render: false,
};
