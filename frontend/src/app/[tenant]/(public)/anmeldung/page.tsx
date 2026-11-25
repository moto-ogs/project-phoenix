import { headers } from "next/headers";
import { messageBoundary } from "~/i18n/scoped-messages";
import { routes } from "~/lib/contract/enrollment.generated";
import { publicPhaseFromContract } from "~/lib/enrollment-submission-api";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { tenantSlugFromHost } from "~/lib/tenant-host";
import EnrollPhasePickerPage from "./enrollment-start-page";

const PageMessages = messageBoundary("enrollmentPublic", "language");

export default async function Page({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const [{ tenant }, requestHeaders] = await Promise.all([params, headers()]);
  const host =
    requestHeaders.get("x-moto-original-host") ??
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host");
  const builtAt = Date.now();
  // Public catalog data only. Neither a staff cookie nor a parent's form
  // profile belongs in this payload. Unavailable data follows the old loader.
  const phases =
    tenantSlugFromHost(host) === tenant
      ? await seedRead("enrollment.publicPhases", async (signal) => {
          const { data } = await readContract(
            routes["GET /api/enrollment/phases/public/{tenantSlug}"],
            { params: { tenantSlug: tenant }, signal },
          );
          return data.map(publicPhaseFromContract);
        })
      : undefined;
  return (
    <PageMessages>
      <EnrollPhasePickerPage
        key={tenant}
        initial={phases === undefined ? undefined : { phases, builtAt }}
      />
    </PageMessages>
  );
}
