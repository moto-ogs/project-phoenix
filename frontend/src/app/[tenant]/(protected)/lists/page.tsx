import { hasPermission } from "~/lib/auth-utils";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/timetable.generated";
import { seedOf, seedRead } from "~/lib/server-seed.server";
import { mapSlotListOptions } from "~/lib/slot-lists-api";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import { tenantDailyKeys } from "~/lib/swr/tenant-daily-keys";
import { readTenantPageContext } from "~/lib/tenant-page-seed.server";
import { slotListDate } from "./list-date";
import ListContent from "./page-content";

export default async function SlotListsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ datum?: string | string[] }>;
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  const date = slotListDate(
    Array.isArray(query.datum) ? query.datum[0] : query.datum,
  );
  const key = tenantDailyKeys.slotListOptions(date);
  const builtAt = Date.now();
  const seed = readTenantPageContext(tenant)
    .then((context) => {
      if (!context || context.tenant.timetableEnabled === false) return null;
      const { snapshot, token, session } = context;
      if (
        !hasPermission(session, "schedules:read") ||
        !hasPermission(session, "users:read")
      )
        return null;
      return seedOf(
        snapshot,
        [
          {
            key,
            render: true,
            value: seedRead("slotListOptions", async (signal) => {
              // The options contract uses POST for its input but has NoCommit.
              const result = await contractWrite(
                routes["POST /api/timetable/lists/options"],
                { date },
                { token, signal },
              );
              if (!result.ok) throw result.error.cause;
              return mapSlotListOptions(result.value.data);
            }),
          },
        ],
        builtAt,
      );
    })
    .catch(() => null);
  return (
    <SWRServerSeed seed={seed} claims={[key]} render>
      <ListContent />
    </SWRServerSeed>
  );
}
