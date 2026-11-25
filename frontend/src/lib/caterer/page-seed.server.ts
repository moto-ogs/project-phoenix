import * as accountContract from "~/lib/contract/caterer-account.generated";
import * as authContract from "~/lib/contract/caterer-auth.generated";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { mapCatererOrders, mapCatererSchools } from "~/lib/caterer-api";
import { defaultPeriod, periodDays } from "~/lib/caterer-period";
import * as schoolsContract from "~/lib/contract/caterer-schools.generated";
import { berlinTodayISO } from "~/lib/date-helpers";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";
import { catererKeys } from "~/lib/swr/portal-keys";
import type { ServerSeedEntry } from "~/lib/swr/server-seed";

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

export async function loadCatererPageSeed() {
  const builtAt = Date.now();
  const today = berlinTodayISO();
  const snapshot = await catererSnapshot();
  if (!snapshot) return null;

  const token = snapshot.accessToken;
  const schools = seedRead("catererSchools", async (signal) => {
    const { data } = await readContract(
      schoolsContract.routes["GET /caterer/schools"],
      { token, signal },
    );
    return mapCatererSchools(data);
  });
  const entries: ServerSeedEntry[] = [
    { key: catererKeys.schools(), value: schools, render: true },
  ];
  // Do not load a school the supply list did not authorize. Each orders
  // request also checks that relationship, including changes since listing.
  const supplied = await schools;
  if (supplied) {
    const days = periodDays(defaultPeriod(today), today);
    const from = days[0]!;
    const to = days[days.length - 1]!;
    const schoolIds = supplied.schools.map(({ id }) => id);
    const value = seedRead("catererOrders", async (signal) => {
      const results = await Promise.all(
        schoolIds.map(async (schoolId) => {
          const { data } = await readContract(
            schoolsContract.routes["GET /caterer/schools/{schoolId}/orders"],
            { token, signal, params: { schoolId }, query: { from, to } },
          );
          if (data.school.id !== schoolId)
            throw new Error("Order school mismatch");
          return [schoolId, mapCatererOrders(data)] as const;
        }),
      );
      return { orders: Object.fromEntries(results), failures: {} };
    });
    // The browser owns the existing per-school failure and refusal logic.
    // Never cache an incomplete window or serialize a raw error.
    entries.push({
      key: catererKeys.orders(schoolIds, from, to),
      value,
      render: true,
    });
  }
  return seedOf(snapshot, entries, builtAt);
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
