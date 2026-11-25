import { mapCatererOverview } from "~/lib/caterer-orders";
import { routes } from "~/lib/contract/caterer-schools.generated";
import { readPortalSessionSnapshot } from "~/lib/portal-session-snapshot.server";
import { readContract, seedOf, seedRead } from "~/lib/server-seed.server";

export async function loadCatererOverviewSeed(
  from: string,
  to: string,
  key: string,
) {
  const snapshot = await readPortalSessionSnapshot("caterer");
  if (
    !snapshot?.accessToken ||
    snapshot.notBooked ||
    snapshot.session.error ||
    snapshot.session.user.scope !== "caterer"
  )
    return null;
  const builtAt = Date.now();
  const value = seedRead("catererOrderOverview", async (signal) => {
    const response = await readContract(routes["GET /caterer/schools"], {
      token: snapshot.accessToken,
      signal,
      query: { from, to },
    });
    return mapCatererOverview(response.data);
  });
  return seedOf(snapshot, [{ key, value, render: true }], builtAt);
}
