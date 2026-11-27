import { TenantRouteSeed } from "../../../tenant-route-seed";
import PageContent from "./page-content";

// The form rests on the version of its own opening read (ADR 0311), so the
// day is not seeded.
export default async function SchoolExtraDayPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant } = await params;
  return (
    <TenantRouteSeed slug={tenant} load={() => []}>
      <PageContent />
    </TenantRouteSeed>
  );
}
