import { TenantRouteSeed } from "../../../tenant-route-seed";
import PageContent from "./page-content";

// The form starts empty with the session's school: nothing to seed.
export default async function NewSchoolExtraDayPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed slug={tenant} load={() => []}>
      <PageContent />
    </TenantRouteSeed>
  );
}
