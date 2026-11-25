import { berlinTodayISO } from "~/lib/date-helpers";
import { loadStaffDetailSeed } from "./staff-detail-seed.server";
import PageContent from "./page-content";
import { StaffDetailSeed } from "./page-seed";

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ tab?: string | string[]; date?: string | string[] }>;
}) {
  const [{ tenant, id }, { tab, date }] = await Promise.all([
    params,
    searchParams,
  ]);
  const first = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? null;
  const builtAt = Date.now();
  const opening = {
    id,
    today: berlinTodayISO(new Date(builtAt)),
    requestedTab: first(tab),
    requestedDate: first(date),
  };
  return (
    <StaffDetailSeed
      seed={loadStaffDetailSeed(tenant, opening, builtAt).catch(() => null)}
      opening={opening}
    >
      <PageContent />
    </StaffDetailSeed>
  );
}
