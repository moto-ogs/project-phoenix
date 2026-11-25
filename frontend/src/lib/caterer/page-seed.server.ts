import * as accountContract from "~/lib/contract/caterer-account.generated";
import * as authContract from "~/lib/contract/caterer-auth.generated";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { mapCatererOverview } from "~/lib/caterer-orders";
import * as schoolsContract from "~/lib/contract/caterer-schools.generated";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";

async function catererSnapshot() {
  const snapshot = await readPortalSessionSnapshot("caterer");
  if (
    !snapshot?.accessToken ||
    snapshot.notBooked ||
    snapshot.session.error ||
    snapshot.session.user.scope !== "caterer"
  )
    return null;
  return snapshot;
}

export async function loadCatererOverviewSeed(
  from: string,
  to: string,
  key: string,
) {
  const snapshot = await catererSnapshot();
  if (!snapshot) return null;
  const builtAt = Date.now();
  const value = seedRead("catererOrderOverview", async (signal) => {
    const response = await readContract(
      schoolsContract.routes["GET /caterer/schools"],
      {
        token: snapshot.accessToken,
        signal,
        query: { from, to },
      },
    );
    return mapCatererOverview(response.data);
  });
  return seedOf(snapshot, [{ key, value, render: true }], builtAt);
}

const FACTOR_KEY = tenantAdminKeys.emailCodeFactor();
const PASSKEYS_KEY = tenantAdminKeys.passkeys("caterer");
const TRUSTED_DEVICES_KEY = tenantAdminKeys.trustedDevices("caterer");
const ACCOUNT_CLAIMS = [FACTOR_KEY, PASSKEYS_KEY, TRUSTED_DEVICES_KEY];

export function catererAccountSeed() {
  const builtAt = Date.now();
  const seed = catererSnapshot()
    .then((snapshot) => {
      if (!snapshot) return null;
      const token = snapshot.accessToken;
      const factor = seedRead("catererFactor", async (signal) => {
        const { data } = await readContract(
          accountContract.routes["GET /caterer/account/mfa"],
          { token, signal },
        );
        return {
          enabled: data.enabled,
          available: true,
          maskedEmail: data.masked_email,
        };
      });
      const passkeys = seedRead("catererPasskeys", async (signal) => {
        const { data } = await readContract(
          authContract.routes["GET /caterer/auth/passkeys"],
          { token, signal },
        );
        return data ?? [];
      });
      const trusted = factor.then((state) =>
        state?.enabled
          ? seedRead("catererTrustedDevices", async (signal) => {
              const { data } = await readContract(
                authContract.routes["GET /caterer/auth/mfa/trusted-devices"],
                { token, signal },
              );
              return data ?? [];
            })
          : undefined,
      );
      return seedOf(
        snapshot,
        [
          { key: FACTOR_KEY, value: factor, render: true },
          { key: PASSKEYS_KEY, value: passkeys, render: true },
          { key: TRUSTED_DEVICES_KEY, value: trusted },
        ],
        builtAt,
      );
    })
    .catch(() => null);
  return { seed, claims: ACCOUNT_CLAIMS };
}
