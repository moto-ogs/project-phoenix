import { ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { DocumentAttachmentList } from "~/components/enrollment/attachment-list";
import { formatDateTime } from "~/components/enrollment/enrollment-request-display";
import { Alert } from "~/components/ui/alert";
import { EmptyState } from "~/components/ui/empty-state";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { documentsConcept } from "~/lib/concepts/documents";
import type {
  AdminLegalEvidenceBlock,
  AdminLegalEvidenceEntry,
} from "~/lib/enrollment-admin-api";

const LegalMarkdown = dynamic(() =>
  import("~/components/enrollment/legal-markdown").then(
    (module) => module.LegalMarkdown,
  ),
);

const LEGAL_EVIDENCE_TITLE = "Rechtstexte und Antworten";

const DATE_TIME: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

function LegalAnswer({
  kind,
  answer,
}: Readonly<{ kind: string; answer: unknown }>) {
  if (kind === "notice") return <StatusBadge tone="gray" label="Hinweis" />;
  if (answer === true)
    return (
      <StatusBadge
        tone="green"
        label={
          kind === "privacy_notice" ? "Zur Kenntnis genommen" : "Zugestimmt"
        }
      />
    );
  if (answer === false)
    return <StatusBadge tone="gray" label="Nicht bestätigt" />;
  return <StatusBadge tone="gray" label="Keine Antwort erfasst" />;
}

function LegalEvidenceBlock({
  block,
  answer,
  versionMismatch,
}: Readonly<{
  block: AdminLegalEvidenceBlock;
  answer: unknown;
  versionMismatch?: boolean;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const heading = (
    <>
      <span className="min-w-0 flex-1 font-medium break-words text-gray-900">
        {block.title}
      </span>
      {versionMismatch ? null : (
        <LegalAnswer kind={block.kind} answer={answer} />
      )}
    </>
  );
  if (!block.label && !block.text && !block.attachments?.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {heading}
      </div>
    );
  }
  return (
    <details
      className="group"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-700 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-gray-500 group-open:rotate-180"
        />
        {heading}
      </summary>
      {isOpen ? (
        <div className="space-y-3 px-3 pt-1 pb-3 break-words text-gray-700 sm:pl-9">
          {block.label && (
            <p className="font-medium text-gray-900">{block.label}</p>
          )}
          {block.text && <LegalMarkdown text={block.text} />}
          <DocumentAttachmentList attachments={block.attachments} />
        </div>
      ) : null}
    </details>
  );
}

function LegalEvidenceEntry({
  entry,
}: Readonly<{ entry: AdminLegalEvidenceEntry }>) {
  let source = "Eingereicht";
  if (entry.staff_recorded) source = "Von der Schule erfasst";
  if (entry.change_request) source = "Änderung eingereicht";
  return (
    <li className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-gray-900">{source}</p>
        <time className="text-gray-600" dateTime={entry.snapshot_at}>
          {formatDateTime(entry.snapshot_at, DATE_TIME)} Uhr
        </time>
      </div>
      {entry.version_mismatch ? (
        <Alert
          type="warning"
          announce="off"
          message="Das Formular hatte eine andere Fassung. Die Antworten lassen sich den gespeicherten Texten nicht sicher zuordnen."
        />
      ) : null}
      {entry.blocks?.length ? (
        <InsetPanel
          as="ul"
          framed
          className="divide-y divide-gray-200 overflow-hidden"
          padding="tight"
        >
          {entry.blocks.map((block) => (
            <li key={block.key}>
              <LegalEvidenceBlock
                block={block}
                answer={entry.consent_flags?.[block.key]}
                versionMismatch={entry.version_mismatch}
              />
            </li>
          ))}
        </InsetPanel>
      ) : (
        <p className="text-gray-600">
          Zu dieser Einreichung wurden keine Texte gespeichert.
        </p>
      )}
    </li>
  );
}

export function AdminLegalEvidence({
  entries,
}: Readonly<{ entries?: AdminLegalEvidenceEntry[] }>) {
  return (
    <SectionCard
      title={LEGAL_EVIDENCE_TITLE}
      description="Die Angaben dienen als Nachweis."
      titleSize="lg"
      concept={documentsConcept}
      bodyClassName="mt-4 text-sm"
    >
      {entries?.length ? (
        <ol className="space-y-4">
          {entries.map((entry) => (
            <LegalEvidenceEntry key={entry.snapshot_at} entry={entry} />
          ))}
        </ol>
      ) : (
        <InsetPanel framed padding="sm">
          <EmptyState
            variant="compact"
            description="Kein Nachweis vorhanden."
          />
        </InsetPanel>
      )}
    </SectionCard>
  );
}
