import { Suspense } from "react";
import { connection } from "next/server";
import { routes } from "~/lib/contract/auth-tenants.generated";
import { readContract, seedRead } from "~/lib/server-seed.server";
import { TenantPicker } from "./tenant-picker";

/** The bare-domain school picker does not read a session or populate SWR. */
export default function RootPage() {
  return (
    <Suspense fallback={<TenantPicker pending />}>
      <TenantPickerFromServer />
    </Suspense>
  );
}

async function TenantPickerFromServer() {
  await connection();
  const schools = await seedRead("publicTenantPicker", async (signal) => {
    const { data } = await readContract(routes["GET /auth/tenants"], {
      signal,
    });
    return data.map(({ name, slug, subdomain }) => ({ name, slug, subdomain }));
  });
  // Leave the existing browser retry path in charge when the server read fails.
  return <TenantPicker initialSchools={schools} />;
}
