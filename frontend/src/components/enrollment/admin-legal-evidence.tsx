import { ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { AttachmentLabels } from "~/components/enrollment/attachment-list";
import { formatDateTime } from "~/components/enrollment/enrollment-request-display";
import { Alert } from "~/components/ui/alert";
import { FramedList } from "~/components/ui/framed-list";
import { EmptyState } from "~/components/ui/empty-state";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
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

const DocumentAttachmentList = dynamic(() =>
  import("~/components/enrollment/attachment-list").then(
    (module) => module.DocumentAttachmentList,
  ),
);

const LEGAL_EVIDENCE_TITLE = "Rechtstexte und Antworten";
const LANGUAGE_NAMES = new Intl.DisplayNames("de", { type: "language" });

const ATTACHMENT_LABELS: AttachmentLabels = {
  open: "Öffnen",
  download: "Herunterladen",
  openLabel: (label) => `${label} öffnen`,
  downloadLabel: (label) => `${label} herunterladen`,
  openHint: "Öffnet die Datei in einem neuen Tab.",
  downloadHint: "Lädt die Datei herunter.",
  popupBlocked: "Der neue Tab konnte nicht geöffnet werden.",
  errorObject: "Dokument",
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

function LegalAnswer({
  kind,
  answer,
  versionUncertain,
}: Readonly<{ kind: string; answer: unknown; versionUncertain: boolean }>) {
  if (kind === "notice") return <StatusBadge tone="gray" label="Hinweis" />;
  if (versionUncertain && typeof answer === "boolean")
    return (
      <StatusBadge
        tone="gray"
        label={answer ? "Ja gespeichert" : "Nein gespeichert"}
      />
    );
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
  versionUncertain,
}: Readonly<{
  block: AdminLegalEvidenceBlock;
  answer: unknown;
  versionUncertain: boolean;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const translations = block.translations;
  const storedLocales = translations
    ? SUPPORTED_LOCALES.filter(({ code }) => translations[code])
    : [];
  const textFromSettings = block.source === "standard";
  const heading = (
    <>
      <span className="min-w-0 font-medium break-words text-gray-900 sm:flex-1">
        {block.title}
      </span>
      <span className="max-sm:col-start-2">
        <LegalAnswer
          kind={block.kind}
          answer={answer}
          versionUncertain={versionUncertain || textFromSettings}
        />
      </span>
    </>
  );
  if (
    !block.label &&
    !block.text &&
    !block.attachments?.length &&
    storedLocales.length === 0
  ) {
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
      <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-3 py-2.5 hover:bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-700 sm:flex sm:flex-wrap [&::-webkit-details-marker]:hidden">
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
          {block.attachments?.length ? (
            <DocumentAttachmentList
              attachments={block.attachments}
              labels={ATTACHMENT_LABELS}
            />
          ) : null}
          {storedLocales.length ? (
            <details>
              <summary className="cursor-pointer py-2 font-medium text-gray-900">
                Gespeicherte Übersetzungen
              </summary>
              <ul className="space-y-3">
                {storedLocales.map(({ code, label }) => {
                  const translated = translations?.[code];
                  return (
                    <li
                      key={code}
                      lang={code}
                      className="border-t border-gray-100 pt-3"
                    >
                      <p
                        lang="de"
                        className="text-xs font-medium text-gray-600"
                      >
                        {LANGUAGE_NAMES.of(code) ?? label}
                      </p>
                      {translated?.title && (
                        <p className="font-semibold text-gray-900">
                          {translated.title}
                        </p>
                      )}
                      {translated?.label && <p>{translated.label}</p>}
                      {translated?.text && (
                        <LegalMarkdown lang={code} text={translated.text} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
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
  const versionUncertain =
    entry.version_mismatch === true || entry.version_unknown === true;
  const usesStandardTexts = entry.blocks?.some(
    ({ source }) => source === "standard",
  );
  return (
    <li className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold text-gray-900">{source}</p>
        <time className="text-gray-600" dateTime={entry.snapshot_at}>
          {formatDateTime(entry.snapshot_at, DATE_TIME)} Uhr
        </time>
      </div>
      {entry.wording_unavailable ? (
        <p className="text-gray-600">Der damalige Wortlaut fehlt.</p>
      ) : versionUncertain ? (
        <Alert
          type="warning"
          announce="off"
          message="Die angezeigte Fassung fehlt oder weicht ab. Hier stehen die Texte und Antworten vom Eingang."
        />
      ) : usesStandardTexts ? (
        <p className="text-gray-600">
          Bei Standardtexten ist die Fassung beim Eingang gespeichert.
        </p>
      ) : null}
      {entry.blocks?.length ? (
        <FramedList>
          {entry.blocks.map((block) => (
            <li key={block.key}>
              <LegalEvidenceBlock
                block={block}
                answer={entry.consent_flags?.[block.key]}
                versionUncertain={
                  versionUncertain ||
                  entry.staff_recorded === true ||
                  entry.wording_unavailable === true
                }
              />
            </li>
          ))}
        </FramedList>
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
