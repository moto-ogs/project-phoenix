import { loadActiveSupervisionsSeed } from "~/lib/active-supervisions-seed.server";
import ActiveSupervisionsContent from "./page-content";
import { ActiveSupervisionsSeed } from "./page-seed";

export default async function ActiveSupervisionsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const seed = loadActiveSupervisionsSeed(tenant).catch(() => null);
  return (
    <ActiveSupervisionsSeed seed={seed}>
      <ActiveSupervisionsContent />
    </ActiveSupervisionsSeed>
  );
}
