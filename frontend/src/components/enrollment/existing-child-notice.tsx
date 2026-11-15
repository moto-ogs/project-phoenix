"use client";

import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { FramedList } from "~/components/ui/framed-list";
import { childrenConcept } from "~/lib/concepts/children";
import type {
  AdminExistingChildCandidate,
  AdminRequestChild,
} from "~/lib/enrollment-admin-api";
import { useTenantAwarePath } from "~/lib/tenant-path";
import { ChildStatusBadge } from "./child-status-badge";
import {
  candidateFacts,
  existingChildHint,
  phaseRequestGuardian,
} from "./existing-child-choice";

// The child may already be enrolled (#6053): the card names every enrolled
// child with the same name and birthday, with its record, so the office
// compares before it approves. When another enrollment of the same phase
// already holds the child, this one is a duplicate (#6247): the notice says
// so, links that enrollment and offers to refuse this one.

interface ExistingChildNoticeProps {
  readonly child: AdminRequestChild;
  /** The guardian of this enrollment, named as the parent to add later. */
  readonly requestGuardian: string;
  /** Refuses the duplicate; absent while the child cannot be decided. */
  readonly onRejectDuplicate?: () => void;
  readonly busy?: boolean;
}

export function ExistingChildNotice({
  child,
  requestGuardian,
  onRejectDuplicate,
  busy = false,
}: ExistingChildNoticeProps) {
  const hint = existingChildHint(child, requestGuardian);
  if (!hint) return null;
  const candidates = child.possible_existing_children ?? [];
  return (
    <Alert
      type="warning"
      announce="off"
      title={hint.title}
      message={hint.message}
      details={
        hint.listsCandidates && candidates.length > 0 ? (
          <FramedList className="mt-3">
            {candidates.map((candidate) => (
              <CandidateRow key={candidate.student_id} candidate={candidate} />
            ))}
          </FramedList>
        ) : undefined
      }
      action={
        hint.duplicate && onRejectDuplicate ? (
          <Button
            type="button"
            variant="outline_danger"
            size="compact"
            onClick={onRejectDuplicate}
            disabled={busy}
            tooltip="Lehnt diese doppelte Anmeldung sofort ab."
          >
            Als doppelt ablehnen
          </Button>
        ) : undefined
      }
      actionLayout="stacked"
    />
  );
}

function CandidateRow({
  candidate,
}: Readonly<{ candidate: AdminExistingChildCandidate }>) {
  const tenantPath = useTenantAwarePath();
  const name = `${candidate.first_name} ${candidate.last_name}`;
  const held = candidate.phase_request;
  const facts = candidateFacts(candidate);
  return (
    <li className="flex flex-col gap-3 px-4 py-3 text-gray-700 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ConceptIconTile concept={childrenConcept} size="xs" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          {facts ? <p className="text-xs text-gray-600">{facts}</p> : null}
          {held ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
              <span>
                Anmeldung von{" "}
                <span className="font-medium text-gray-900">
                  {phaseRequestGuardian(held)}
                </span>
              </span>
              <ChildStatusBadge status={held.child_status} />
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2">
        {held ? (
          <ButtonLink
            href={tenantPath(
              `/admin/enrollments/${encodeURIComponent(held.request_id)}`,
            )}
            variant="surface"
            size="compact"
            className="whitespace-nowrap max-sm:flex-1"
            aria-label={`Anmeldung von ${phaseRequestGuardian(held)} öffnen`}
            tooltip="Öffnet die andere Anmeldung dieses Kindes."
          >
            Anmeldung öffnen
          </ButtonLink>
        ) : null}
        <ButtonLink
          href={tenantPath(
            `/students/${encodeURIComponent(candidate.student_id)}`,
          )}
          variant="surface"
          size="compact"
          className="whitespace-nowrap max-sm:flex-1"
          aria-label={`Akte von ${name} öffnen`}
          tooltip="Öffnet die Akte des angemeldeten Kindes."
        >
          Akte öffnen
        </ButtonLink>
      </div>
    </li>
  );
}
