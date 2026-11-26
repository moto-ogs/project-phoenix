import { StatusBadge } from "~/components/ui/status-badge";
import {
  type AreaResponsibility,
  RESPONSIBLE_BODY_LABELS,
  type SchoolResponsibility,
  responsibilityGap,
  responsibleName,
} from "~/lib/traeger-responsibilities-api";

/**
 * What is missing while the Träger is still responsible although another
 * body is chosen: the short mark of a table cell.
 */
function responsibilityGapText(
  school: Pick<SchoolResponsibility, "parties">,
  area: AreaResponsibility,
): string | null {
  const gap = responsibilityGap(school, area);
  if (gap === null) return null;
  return gap === "missing" ? "Angaben fehlen" : "Bankdaten fehlen";
}

/**
 * Who is responsible for one area of one school (#4811): the name of the
 * body that counts, the kind of body below a stored name, and the marks
 * „Eigener Wert“ (the school deviates from the Träger) and what is missing
 * while the chosen body cannot take over yet („Angaben fehlen“: no name
 * and address; „Bankdaten fehlen“: no creditor identifier or account).
 */
export function ResponsibilityValue({
  school,
  area,
}: Readonly<{
  school: Pick<SchoolResponsibility, "parties">;
  area: AreaResponsibility;
}>) {
  const name = responsibleName(school, area.effective);
  const kind =
    area.effective === "traeger" ||
    name === RESPONSIBLE_BODY_LABELS[area.effective]
      ? null
      : RESPONSIBLE_BODY_LABELS[area.effective];
  const gap = responsibilityGapText(school, area);
  // While something is missing, the cell also names the chosen body: the
  // Träger above is only standing in for it.
  const chosen = gap ? `Gewählt: ${RESPONSIBLE_BODY_LABELS[area.body]}` : null;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 font-medium wrap-anywhere text-gray-900">
          {name}
        </span>
        {area.source === "school" ? (
          <StatusBadge tone="blue" size="xs" label="Eigener Wert" />
        ) : null}
      </span>
      {kind ? <span className="text-sm text-gray-500">{kind}</span> : null}
      {chosen ? <span className="text-sm text-gray-500">{chosen}</span> : null}
      {gap ? <StatusBadge tone="warning" size="xs" label={gap} /> : null}
    </span>
  );
}
