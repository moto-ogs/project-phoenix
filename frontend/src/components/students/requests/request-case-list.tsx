"use client";

/**
 * Die kompakte Liste der Kinder mit offenen Anfragen (#2267). Sie zeigt nur,
 * WER etwas offen hat — entschieden wird rechts (breit) oder auf der nächsten
 * Ansicht (schmal). Vorher standen alle Entscheiden-Karten aller Kinder
 * untereinander; bei zwanzig Kindern war das nicht mehr zu überblicken.
 */

import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { StatusBadge } from "~/components/ui/status-badge";
import { formatDate } from "~/lib/date-helpers";
import {
  caseDates,
  caseTypeLabels,
  decidedRequestCount,
  openRequestCount,
  pastRequestCount,
  type CaseBuckets,
  type OpenCase,
} from "./case-model";
import { childrenConcept } from "~/lib/concepts/children";
import { SectionCard } from "~/components/ui/section-card";

export function caseRowID(prefix: string, caseKey: string): string {
  return `${prefix}-case-${caseKey}`;
}

function countLabel(childCase: OpenCase): string {
  if (childCase.past) {
    const count = pastRequestCount(childCase);
    return count === 1
      ? "1 abgelaufene Anfrage"
      : `${count} abgelaufene Anfragen`;
  }
  const count = openRequestCount(childCase);
  if (count === 0 && decidedRequestCount(childCase) > 0) return "Freigegeben";
  return count === 1 ? "1 offene Anfrage" : `${count} offene Anfragen`;
}

function CaseRow({
  childCase,
  id,
  selected,
  onSelect,
}: Readonly<{
  childCase: OpenCase;
  id: string;
  selected: boolean;
  onSelect: (childCase: OpenCase) => void;
}>) {
  const dates = caseDates(childCase);
  const typeLabels = caseTypeLabels(childCase);
  return (
    <li>
      <button
        type="button"
        id={id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(childCase)}
        className={`flex min-h-[44px] w-full flex-col items-start gap-1 border-b border-gray-100 px-4 py-3 text-left last:border-b-0 hover:bg-gray-50 ${
          selected ? "bg-gray-50" : ""
        }`}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <MotoConceptIcon concept={childrenConcept} size={20} />
          <span className="truncate font-semibold text-gray-900">
            {childCase.studentName}
          </span>
        </span>
        <span className="text-sm text-gray-600">
          {countLabel(childCase)}
          {typeLabels.length > 0 ? ` · ${typeLabels.join(", ")}` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {childCase.groupName ? <span>{childCase.groupName}</span> : null}
          {dates.length > 0 ? (
            <span>
              Betrifft: {dates.map((date) => formatDate(date)).join(", ")}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {childCase.urgentToday && !childCase.past ? (
            <StatusBadge tone="warning" label="Heute betroffen" />
          ) : null}
          {childCase.conflicts.length > 0 ? (
            <StatusBadge tone="red" label="Diese Anfragen widersprechen sich" />
          ) : null}
          {childCase.familyProtected ? (
            <StatusBadge tone="blue" label="Familienschutz" />
          ) : null}
        </span>
      </button>
    </li>
  );
}

function CaseBucket({
  id,
  prefix,
  title,
  description,
  cases,
  selectedKey,
  onSelect,
}: Readonly<{
  id: string;
  prefix: string;
  title: string;
  description: string;
  cases: readonly OpenCase[];
  selectedKey: string | null;
  onSelect: (childCase: OpenCase) => void;
}>) {
  if (cases.length === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-1">
      <div className="px-4 pt-3">
        <h2 id={id} className="font-semibold text-gray-900">
          {title}
        </h2>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
      <ul>
        {cases.map((childCase) => (
          <CaseRow
            key={childCase.key}
            id={caseRowID(prefix, childCase.key)}
            childCase={childCase}
            selected={childCase.key === selectedKey}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

export function RequestCaseList({
  buckets,
  prefix,
  selectedKey,
  onSelect,
}: Readonly<{
  buckets: CaseBuckets;
  prefix: string;
  selectedKey: string | null;
  onSelect: (childCase: OpenCase) => void;
}>) {
  return (
    <SectionCard padding="none">
      <CaseBucket
        id={`${prefix}-urgent`}
        prefix={prefix}
        title="Heute wichtig"
        description="Diese Kinder sind heute betroffen."
        cases={buckets.urgent}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
      <CaseBucket
        id={`${prefix}-later`}
        prefix={prefix}
        title="Weitere Anfragen"
        description="Diese Anfragen sind nicht für heute dringend."
        cases={buckets.later}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
      <CaseBucket
        id={`${prefix}-expired`}
        prefix={prefix}
        title="Abgelaufen"
        description="Diese Anfragen betreffen nur vergangene Tage. Sie ändern nichts mehr."
        cases={buckets.expired}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
    </SectionCard>
  );
}
