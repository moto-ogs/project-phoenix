import type { Metadata } from "next";
import { Suspense } from "react";
import {
  getHelpTopics,
  HELP_GROUP_LABELS,
  HELP_GROUPS,
} from "~/components/help/help-content";
import { HelpView } from "~/components/help/help-view";
import { formatPageTitle } from "~/lib/page-titles";

// Optionaler Catch-all: `/help` zeigt den Einstieg, `/help/<thema>` eine
// Anleitung, `/help/gruppe/<id>` eine Oberkategorie. Die Adressen sind flach,
// damit ein Thema beim Umsortieren seine Adresse behaelt
// (docs/hilfebereich-umbau-plan.md, 7.1).
//
// Die statische Druckseite `/help/nfc/erste-schritte` liegt daneben und
// gewinnt gegen diesen Catch-all, weil Next.js konkrete Segmente zuerst
// prueft.
const DESCRIPTION =
  "Anleitungen für moto: für Betreuungskräfte, die Leitung, Eltern und Lehrkräfte.";

/** Name of the article or category the address shows (#7109). */
function helpPageName(topic: readonly string[] | undefined): string | null {
  const [first, second] = topic ?? [];
  if (first === undefined) return null;
  if (first === "gruppe") {
    const group = HELP_GROUPS.find((id) => id === second);
    return group ? HELP_GROUP_LABELS[group] : null;
  }
  // Article titles do not depend on the settings variant; "unknown" matches
  // a link without settings parameters.
  return (
    getHelpTopics("unknown", "unknown", null).find((item) => item.id === first)
      ?.title ?? null
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic?: string[] }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const name = helpPageName(topic);
  return {
    title: formatPageTitle({ page: name ?? "Hilfe" }),
    description: DESCRIPTION,
  };
}

export default function HelpPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <HelpView />
    </Suspense>
  );
}
