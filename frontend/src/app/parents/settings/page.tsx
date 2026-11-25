import { Suspense } from "react";
import { ParentPageSeed } from "~/app/parents/parent-page-seed";
import { activeParentSettingsSection } from "~/components/parent/shell/parent-nav-items";
import ParentSettingsContent from "./settings-content";

export default async function ParentSettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  const section = activeParentSettingsSection(
    Array.isArray(tab) ? tab[0] : tab,
  ).key;
  return (
    <Suspense>
      {section === "notifications" || section === "signIn" ? (
        <ParentPageSeed page={{ kind: "settings", section }}>
          <ParentSettingsContent />
        </ParentPageSeed>
      ) : (
        <ParentSettingsContent />
      )}
    </Suspense>
  );
}
