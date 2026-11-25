import { activeSchoolSettingsSection } from "~/components/school/shell/school-nav-items";
import { Suspense } from "react";
import { SWRServerSeed } from "~/lib/swr/server-seed";
import {
  schoolPageSeed,
  notificationPreferences,
  trustedDevices,
} from "~/lib/school/page-seed.server";
import SchoolSettingsPage from "./page-content";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const section = activeSchoolSettingsSection(
    Array.isArray(tab) ? tab[0] : tab,
  );
  const reads =
    section.key === "notifications"
      ? [notificationPreferences]
      : section.key === "devices"
        ? [trustedDevices]
        : [];
  const { seed, claims } = schoolPageSeed(reads);
  return (
    <Suspense fallback={null}>
      <SWRServerSeed seed={seed} claims={claims} render>
        <SchoolSettingsPage />
      </SWRServerSeed>
    </Suspense>
  );
}
