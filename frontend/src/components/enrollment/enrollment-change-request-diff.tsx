"use client";

import { useMemo } from "react";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { InfoSection } from "~/components/ui/info-section";
import {
  formatEnrollmentChangeRequestDiff,
  type EnrollmentChangeRequestDiffCopy,
  type EnrollmentFormLabels,
  type FormattedChangeRequestDiffGroup,
} from "~/lib/enrollment-change-request-diff";
import { SectionLabel } from "~/components/ui/section-label";
import { cn } from "~/lib/utils";

interface EnrollmentChangeRequestDiffProps {
  readonly baseSnapshot: object | null;
  readonly proposedSnapshot: object | null;
  readonly diff: object | null;
  readonly beforeLabel?: string;
  readonly afterLabel?: string;
  readonly emptyMessage?: string;
  readonly copy?: EnrollmentChangeRequestDiffCopy;
  /** Questions of the request's form version; without them rows show keys. */
  readonly formLabels?: EnrollmentFormLabels | null;
  readonly className?: string;
}

export function EnrollmentChangeRequestDiff({
  baseSnapshot,
  proposedSnapshot,
  diff,
  beforeLabel = "Bisher",
  afterLabel = "Neu",
  emptyMessage = "Die Anfrage enthält keine erkennbaren Feldänderungen.",
  copy,
  formLabels,
  className,
}: EnrollmentChangeRequestDiffProps) {
  const groups = useMemo(
    () =>
      formatEnrollmentChangeRequestDiff({
        baseSnapshot,
        proposedSnapshot,
        diff,
        copy,
        formLabels,
      }),
    [baseSnapshot, proposedSnapshot, diff, copy, formLabels],
  );

  return (
    <EnrollmentChangeRequestDiffGroups
      groups={groups}
      beforeLabel={beforeLabel}
      afterLabel={afterLabel}
      emptyMessage={emptyMessage}
      className={className}
    />
  );
}

export function EnrollmentChangeRequestDiffGroups({
  groups,
  beforeLabel,
  afterLabel,
  emptyMessage,
  className,
}: Readonly<{
  groups: readonly FormattedChangeRequestDiffGroup[];
  beforeLabel: string;
  afterLabel: string;
  emptyMessage: string;
  className?: string;
}>) {
  if (groups.length === 0) {
    return <p className="text-sm text-gray-600">{emptyMessage}</p>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {groups.map((group) => (
        <DiffGroup
          key={group.key}
          group={group}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      ))}
    </div>
  );
}

function DiffGroup({
  afterLabel,
  beforeLabel,
  group,
}: {
  readonly group: FormattedChangeRequestDiffGroup;
  readonly beforeLabel: string;
  readonly afterLabel: string;
}) {
  return (
    <InfoSection title={group.label}>
      <div className="space-y-2">
        {group.rows.map((row) => (
          <div key={row.id} className="rounded-lg bg-white px-3 py-2">
            <SectionLabel as="p" className="break-words">
              {row.label}
            </SectionLabel>
            <div className="mt-2">
              <DataGrid>
                <DataField label={beforeLabel}>{row.before}</DataField>
                <DataField label={afterLabel}>{row.after}</DataField>
              </DataGrid>
            </div>
          </div>
        ))}
      </div>
    </InfoSection>
  );
}
