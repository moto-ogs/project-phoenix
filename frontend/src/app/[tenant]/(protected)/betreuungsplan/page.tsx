// Eigenständiger Betreuungsplan-Bereich (Planung-Redesign, docs/planung-
// redesign/docs/03). Rendert übergangsweise die unveränderte Bestands-View;
// der inhaltliche Umbau (Kopfzeile, Chrome-Abbau, d/view/block-Schema)
// folgt mit docs/06.
//
// Der Server startet Raster und Lücken schon beim Rendern (#8077) und reicht
// sie ungewartet an die Ansicht weiter: sie erscheint sofort, ihre Leser
// übernehmen die Werte, sobald sie da sind.

import { BetreuungsplanView } from "~/components/timetable/betreuungsplan-view";
import { loadBetreuungsplanSeed } from "~/lib/betreuungsplan-seed.server";

export const unstable_dynamicStaleTime = 60;

export default async function BetreuungsplanPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tenant }, query] = await Promise.all([params, searchParams]);
  // Never rejects: without a seed the view loads as it always did.
  const seed = loadBetreuungsplanSeed(tenant, query).catch(() => null);
  return <BetreuungsplanView seed={seed} />;
}
