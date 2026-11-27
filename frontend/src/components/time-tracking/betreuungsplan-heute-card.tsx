"use client";

import {
  CollectionGrid,
  CollectionGridTile,
} from "~/components/ui/collection-grid";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import type { FormErrorInput } from "~/components/ui/form-error";
import {
  SectionCard,
  SECTION_CARD_BODY_GAP,
} from "~/components/ui/section-card";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { StatusBadge } from "~/components/ui/status-badge";
import type { OwnAssignment } from "~/lib/shift-helpers";
import { carePlanConcept } from "~/lib/concepts/carePlan";
import { roomsConcept } from "~/lib/concepts/rooms";

const CARD_LAYOUT = {
  className: "flex h-full flex-col",
  bodyClassName: `${SECTION_CARD_BODY_GAP} flex min-h-0 flex-1 flex-col space-y-3`,
} as const;

export function TodayAssignmentsCard({
  today,
  assignments,
  failed,
  error,
}: {
  readonly today: string;
  readonly assignments?: readonly OwnAssignment[];
  readonly failed: boolean;
  readonly error: FormErrorInput | null;
}) {
  if (failed) {
    return (
      <SectionCard
        title="Heute geplant"
        concept={carePlanConcept}
        {...CARD_LAYOUT}
      >
        <LoadErrorAlert error={error} />
      </SectionCard>
    );
  }

  const blocks = (assignments ?? [])
    .filter((block) => block.date === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (blocks.length === 0) return null;

  return (
    <SectionCard
      title="Heute geplant"
      concept={carePlanConcept}
      {...CARD_LAYOUT}
    >
      <CollectionGrid as="ul" minTileWidth="16rem">
        {blocks.map((block) => (
          <AssignmentTile key={block.instanceId} block={block} />
        ))}
      </CollectionGrid>
    </SectionCard>
  );
}

function AssignmentTile({ block }: { readonly block: OwnAssignment }) {
  const dimmed = block.cancelled || block.isAbsent;

  return (
    <CollectionGridTile className="flex flex-col gap-1">
      <span
        className={`w-28 flex-shrink-0 text-sm font-medium tabular-nums ${
          dimmed ? "text-gray-500 line-through" : "text-gray-900"
        }`}
      >
        {block.startTime}–{block.endTime}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            dimmed ? "text-gray-500" : "text-gray-900"
          }`}
        >
          {block.title}
          {block.groupName && block.groupName !== block.title && (
            <span className="font-normal text-gray-500">
              {" "}
              · {block.groupName}
            </span>
          )}
        </p>
        {block.roomName && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
            <MotoConceptIcon concept={roomsConcept} size={16} />
            {block.roomName}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 empty:hidden">
        {block.isSubstitute && <StatusBadge tone="blue" label="Vertretung" />}
        {block.cancelled && (
          <StatusBadge
            tone="red"
            label={
              block.cancelReason
                ? `Entfällt · ${block.cancelReason}`
                : "Entfällt"
            }
          />
        )}
        {block.isAbsent && (
          <StatusBadge
            tone="warning"
            label={
              block.absenceReason
                ? `Abwesend · ${block.absenceReason}`
                : "Abwesend"
            }
          />
        )}
        {block.understaffedAck && !block.cancelled && (
          <StatusBadge tone="warning" label="Unterbesetzt" />
        )}
      </div>
    </CollectionGridTile>
  );
}
