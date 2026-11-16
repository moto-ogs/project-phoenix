"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  DECLARATION_ACTION_LABEL,
  DECLARATION_STATE_META,
} from "~/components/announcements/declaration-state";
import { Button, ButtonLink } from "~/components/ui/button";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import { useApiErrorDisplay, useApiLoadError } from "~/contexts/ToastContext";
import { announcementsConcept } from "~/lib/concepts/announcements";
import { confirmationsConcept } from "~/lib/concepts/confirmations";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import type { MotoConcept } from "~/lib/moto-concepts";
import {
  downloadDeclarationExport,
  fetchStudentParentRecords,
  type StudentParentDeclaration,
  type StudentParentLetter,
  type StudentParentRecords,
} from "~/lib/parent-announcements-api";
import { useSWRAuth } from "~/lib/swr";
import { studentKeys } from "~/lib/swr/portal-keys";

// Kinderakte (#4814): what the school sent this child's family through moto
// and what the family declared. The rows belong to the Elternbriefe and
// Einverständnisse; this card only reads them, so nothing here can be
// changed. The backend writes every read and every proof to the access log.

const logger = createLogger({ component: "StudentParentRecords" });

/** Rows shown per group before „N weitere anzeigen“. */
const FOLDED_ROWS = 5;

interface RowMeta {
  readonly label: string;
  readonly tone: StatusBadgeTone;
  readonly title?: string;
}

function letterState(letter: StudentParentLetter): RowMeta {
  if (letter.acknowledged_at) {
    return { label: "Bestätigt", tone: "green" };
  }
  if (!letter.can_confirm) {
    return {
      label: "Niemand kann bestätigen",
      tone: "gray",
      title:
        "Keine sorgeberechtigte Person dieses Kindes hat ein Eltern-Konto. Bestätigen geht nur im Eltern-Konto.",
    };
  }
  return { label: "Nicht bestätigt", tone: "warning" };
}

function letterDetail(letter: StudentParentLetter): string {
  const sent = `Verschickt am ${formatDate(letter.published_at)}`;
  if (!letter.acknowledged_at) return sent;
  const by = letter.acknowledged_by ? ` von ${letter.acknowledged_by}` : "";
  return `${sent} · Bestätigt am ${formatDate(letter.acknowledged_at)}${by}`;
}

function declarationDetail(declaration: StudentParentDeclaration): string {
  const parts = [`Verschickt am ${formatDate(declaration.published_at)}`];
  if (declaration.version_no > 1) {
    parts.push(`Fassung ${declaration.version_no}`);
  }
  const answers = declaration.signers.filter(
    (signer) => signer.action && signer.submitted_at,
  );
  for (const signer of answers) {
    const name = `${signer.first_name} ${signer.last_name}`.trim();
    const action = DECLARATION_ACTION_LABEL[signer.action!].toLowerCase();
    parts.push(`${name} hat am ${formatDate(signer.submitted_at!)} ${action}`);
  }
  const waiting =
    declaration.state === "open" || declaration.state === "partial";
  if (waiting && declaration.deadline) {
    parts.push(`Antwort bis ${formatDate(declaration.deadline)}`);
  }
  return parts.join(" · ");
}

function RecordRow({
  concept,
  title,
  state,
  detail,
  children,
}: Readonly<{
  concept: MotoConcept;
  title: string;
  state: RowMeta;
  detail: string;
  children: ReactNode;
}>) {
  return (
    <ResponsiveActionRow>
      <div className="flex min-w-0 items-start gap-3">
        <ConceptIconTile concept={concept} size="xs" className="mt-0.5" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium break-words text-gray-900">
              {title}
            </span>
            <StatusBadge
              tone={state.tone}
              label={state.label}
              title={state.title}
              size="xs"
            />
          </div>
          <p className="mt-0.5 text-xs text-gray-500">{detail}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 max-sm:pl-11">{children}</div>
    </ResponsiveActionRow>
  );
}

function FoldToggle({
  hidden,
  expanded,
  controls,
  onToggle,
}: Readonly<{
  hidden: number;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="mt-2"
      aria-expanded={expanded}
      aria-controls={controls}
      noTooltip="Der Knopf sagt, was er zeigt, und ändert nichts."
      onClick={onToggle}
    >
      {expanded ? "Weniger anzeigen" : `${hidden} weitere anzeigen`}
    </Button>
  );
}

function useFold<T>(rows: readonly T[]) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(rows.length - FOLDED_ROWS, 0);
  return {
    visible: expanded ? rows : rows.slice(0, FOLDED_ROWS),
    hidden,
    expanded,
    toggle: () => setExpanded((value) => !value),
  };
}

function LetterGroup({
  letters,
}: Readonly<{ letters: readonly StudentParentLetter[] }>) {
  const fold = useFold(letters);
  const confirmed = letters.filter((letter) => letter.acknowledged_at).length;
  return (
    <section aria-labelledby="kind-elternbriefe">
      <ListGroupHeader
        title={<span id="kind-elternbriefe">Elternbriefe</span>}
        meta={`${confirmed} von ${letters.length} bestätigt`}
        className="mb-3"
      />
      <ResponsiveActionList id="kind-elternbriefe-liste">
        {fold.visible.map((letter) => (
          <RecordRow
            key={letter.announcement_id}
            concept={announcementsConcept}
            title={letter.title}
            state={letterState(letter)}
            detail={letterDetail(letter)}
          >
            <ButtonLink
              href={`/parent-announcements/${encodeURIComponent(letter.announcement_id)}`}
              variant="surface"
              size="compact"
              aria-label={`Brief öffnen: ${letter.title}`}
              tooltip="Öffnet den Elternbrief mit Text und allen Bestätigungen."
            >
              Brief öffnen
            </ButtonLink>
          </RecordRow>
        ))}
      </ResponsiveActionList>
      {fold.hidden > 0 && (
        <FoldToggle
          hidden={fold.hidden}
          expanded={fold.expanded}
          controls="kind-elternbriefe-liste"
          onToggle={fold.toggle}
        />
      )}
    </section>
  );
}

function DeclarationGroup({
  studentId,
  declarations,
}: Readonly<{
  studentId: string;
  declarations: readonly StudentParentDeclaration[];
}>) {
  const fold = useFold(declarations);
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadErrors = useApiErrorDisplay();
  const waiting = declarations.filter(
    (d) => d.state === "open" || d.state === "partial",
  ).length;
  const answered = declarations.every(
    (d) =>
      d.state === "agreed" || d.state === "declined" || d.state === "revoked",
  );
  const summary =
    waiting > 0
      ? `${waiting} offen`
      : answered
        ? "Alle beantwortet"
        : undefined;

  const downloadProof = async (declaration: StudentParentDeclaration) => {
    setDownloading(declaration.announcement_id);
    try {
      await downloadDeclarationExport(
        declaration.announcement_id,
        "pdf",
        undefined,
        studentId,
      );
    } catch (err) {
      logger.error("student_declaration_proof_failed", {
        student_id: studentId,
        announcement_id: declaration.announcement_id,
        error: err instanceof Error ? err.message : String(err),
      });
      await downloadErrors.show(err, {
        object: "den Nachweis",
        retry: () => void downloadProof(declaration),
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <section aria-labelledby="kind-einverstaendnisse">
      <ListGroupHeader
        title={<span id="kind-einverstaendnisse">Einverständnisse</span>}
        meta={summary}
        className="mb-3"
      />
      <ResponsiveActionList id="kind-einverstaendnisse-liste">
        {fold.visible.map((declaration) => (
          <RecordRow
            key={declaration.announcement_id}
            concept={confirmationsConcept}
            title={declaration.title}
            state={DECLARATION_STATE_META[declaration.state]}
            detail={declarationDetail(declaration)}
          >
            <ButtonLink
              href={`/parent-announcements/${encodeURIComponent(declaration.announcement_id)}`}
              variant="surface"
              size="compact"
              aria-label={`Öffnen: ${declaration.title}`}
              tooltip="Öffnet das Einverständnis mit dem Stand aller Kinder."
            >
              Öffnen
            </ButtonLink>
            <Button
              type="button"
              variant="surface"
              size="compact"
              aria-label={`Nachweis als PDF: ${declaration.title}`}
              tooltip="Lädt den Nachweis nur für dieses Kind als PDF herunter. moto hält den Abruf fest."
              isLoading={downloading === declaration.announcement_id}
              loadingText="Wird erstellt…"
              onClick={() => void downloadProof(declaration)}
            >
              Nachweis als PDF
            </Button>
          </RecordRow>
        ))}
      </ResponsiveActionList>
      {fold.hidden > 0 && (
        <FoldToggle
          hidden={fold.hidden}
          expanded={fold.expanded}
          controls="kind-einverstaendnisse-liste"
          onToggle={fold.toggle}
        />
      )}
    </section>
  );
}

/**
 * „Aus moto“ (#4814): every Elternbrief that reached the child with its
 * confirmation, and every Einverständnis of the child with its state. The
 * page shows it only to the roles that may read the school's letters.
 */
export function StudentParentRecordsCard({
  studentId,
}: Readonly<{ studentId: string }>) {
  const { data, isLoading, error, mutate } = useSWRAuth<StudentParentRecords>(
    studentKeys.parentRecords(studentId),
    () => fetchStudentParentRecords(studentId),
  );
  const load = useApiLoadError();
  const showLoadError = load.show;
  const clearLoadError = load.clear;
  useEffect(() => {
    if (error) {
      void showLoadError(error, {
        object: "die Elternbriefe und Einverständnisse",
        retry: () => void mutate(),
      });
    } else {
      clearLoadError();
    }
  }, [error, mutate, showLoadError, clearLoadError]);

  const letters = data?.letters ?? [];
  const declarations = data?.declarations ?? [];
  const empty = letters.length === 0 && declarations.length === 0;

  return (
    <SectionCard
      title="Aus moto"
      description="Elternbriefe und Einverständnisse, die die Eltern dieses Kindes über moto bekommen haben. Ändern geht unter „Mitteilungen“."
      loading={isLoading && !data}
    >
      {error ? (
        <LoadErrorAlert error={load.error} actionLayout="responsive" />
      ) : empty ? (
        <EmptyState
          variant="compact"
          title="Noch keine Elternbriefe oder Einverständnisse"
          description="Sobald die OGS einen Elternbrief oder ein Einverständnis an die Eltern dieses Kindes schickt, steht es hier."
        />
      ) : (
        <div className="space-y-6">
          {letters.length > 0 && <LetterGroup letters={letters} />}
          {declarations.length > 0 && (
            <DeclarationGroup
              studentId={studentId}
              declarations={declarations}
            />
          )}
        </div>
      )}
    </SectionCard>
  );
}
