"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { InsetPanel } from "~/components/ui/inset-panel";
import { LinkifiedText } from "~/components/ui/linkified-text";
import { SectionLabel } from "~/components/ui/section-label";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { previewLetter } from "~/lib/parent-announcements-api";
import type { AnnouncementApiBase } from "~/lib/parent-announcements-api";
import {
  hasLetterPlaceholders,
  unknownLetterPlaceholders,
} from "~/lib/parent-letter-placeholders";
import { useSWRAuth } from "~/lib/swr";
import { parentAnnouncementKeys } from "~/lib/swr/portal-keys";
import { useDebounce } from "~/lib/use-debounce";

import { useLetterPlaceholders } from "./use-letter-placeholders";

/** A child the preview can show. */
interface LetterPreviewChild {
  readonly value: string;
  readonly label: string;
}

/**
 * Where the preview finds the children it can show: whose children they are
 * (the school, or one class) and their load. The list loads only once the
 * text names a placeholder.
 */
export interface LetterPreviewChildren {
  readonly scope: string;
  readonly load: () => Promise<readonly LetterPreviewChild[]>;
}

// Every preview reads a child's data and is written to the data access log,
// so it waits until the writing pauses.
const PREVIEW_DELAY_MS = 400;

interface LetterBodyFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  /** API base of the portal; the OGS routes when absent. */
  readonly apiBase?: AnnouncementApiBase;
  /** Null while there is no child to show yet, such as before a class is chosen. */
  readonly previewChildren: LetterPreviewChildren | null;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly id?: string;
  readonly className?: string;
}

/**
 * The text of an Elternbrief that names each child (#4813): the field, the
 * placeholders to insert at the caret, a warning for what moto does not
 * know, and the letter as one chosen child's family reads it.
 */
export function LetterBodyField({
  value,
  onChange,
  error,
  required,
  disabled = false,
  apiBase,
  previewChildren,
  placeholder,
  rows = 5,
  id,
  className,
}: LetterBodyFieldProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const labelId = useId();
  const { placeholders, labels, loadError } = useLetterPlaceholders(apiBase);

  const unknown = placeholders
    ? unknownLetterPlaceholders(value, new Set(labels.keys()))
    : [];
  const personal = hasLetterPlaceholders(value);

  const rememberCaret = (field: HTMLTextAreaElement) => {
    caret.current = { start: field.selectionStart, end: field.selectionEnd };
  };
  const insert = (name: string) => {
    const token = `{{${name}}}`;
    const end = Math.min(caret.current?.end ?? value.length, value.length);
    const start = Math.min(caret.current?.start ?? value.length, end);
    onChange(value.slice(0, start) + token + value.slice(end));
    const next = start + token.length;
    caret.current = { start: next, end: next };
    requestAnimationFrame(() => {
      fieldRef.current?.focus();
      fieldRef.current?.setSelectionRange(next, next);
    });
  };

  return (
    <div className="space-y-3">
      <Textarea
        ref={fieldRef}
        id={id}
        name="body"
        label="Text"
        error={error}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          rememberCaret(e.target);
        }}
        onSelect={(e) => rememberCaret(e.currentTarget)}
        onBlur={(e) => rememberCaret(e.currentTarget)}
        rows={rows}
        maxLength={4000}
        placeholder={placeholder}
        className={className}
      />

      <div className="space-y-2">
        <SectionLabel as="p" id={labelId}>
          Für jedes Kind einsetzen
        </SectionLabel>
        <LoadErrorAlert error={loadError} actionLayout="responsive" />
        <ul aria-labelledby={labelId} className="flex flex-wrap gap-2">
          {(placeholders ?? []).map((p) => (
            <li key={p.name}>
              <Button
                type="button"
                variant="outline"
                size="compact"
                disabled={disabled}
                tooltip={`Setzt „${p.label}“ dort in den Text, wo du schreibst.`}
                onClick={() => insert(p.name)}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Platzhalter </span>
                {p.label}
              </Button>
            </li>
          ))}
        </ul>
        {unknown.length > 0 && (
          <Alert
            type="warning"
            size="compact"
            announce="polite"
            message={`Diese Platzhalter kennt moto nicht: ${unknown.join(", ")}. Bitte nimm nur Platzhalter aus der Liste.`}
          />
        )}
      </div>

      {personal && unknown.length === 0 && (
        <LetterPreviewPanel
          body={value}
          apiBase={apiBase}
          source={previewChildren}
        />
      )}
    </div>
  );
}

function LetterPreviewPanel({
  body,
  apiBase,
  source,
}: Readonly<{
  body: string;
  apiBase?: AnnouncementApiBase;
  source: LetterPreviewChildren | null;
}>) {
  const children = useSWRAuth(
    source ? parentAnnouncementKeys.letterPreviewChildren(source.scope) : null,
    () => (source ? source.load() : Promise.resolve([])),
  );
  const childrenError = useSwrLoadError(
    children.error,
    "die Liste der Kinder für die Vorschau",
    () => children.mutate(),
  );
  const options = children.data ?? [];

  const [picked, setPicked] = useState("");
  // The first child is the default, so the preview shows a letter at once.
  const chosen = options.some((o) => o.value === picked)
    ? picked
    : (options[0]?.value ?? "");

  const settledBody = useDebounce(body, PREVIEW_DELAY_MS);
  const preview = useSWRAuth(
    chosen
      ? parentAnnouncementKeys.letterPreview(apiBase, chosen, settledBody)
      : null,
    () => previewLetter(settledBody, chosen, apiBase),
    {
      keepPreviousData: true,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );
  // While the text settles the letter of the same child stays; another
  // child's letter never shows under this child's name.
  const shown =
    !preview.error && preview.data?.child.student_id === chosen
      ? preview.data
      : undefined;
  const previewError = useSwrLoadError(preview.error, "die Vorschau", () =>
    preview.mutate(),
  );
  const loadingChildren = source !== null && children.isLoading;

  return (
    <InsetPanel
      framed
      tone="white"
      padding="md"
      as="section"
      aria-label="Vorschau des Briefs"
      className="space-y-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionLabel as="p">So liest die Familie den Brief</SectionLabel>
        <div className="sm:w-64">
          <CustomSelect
            ariaLabel="Kind für die Vorschau"
            value={chosen}
            options={options}
            onChange={setPicked}
            placeholder={
              loadingChildren ? "Kinder werden geladen…" : "Kind wählen"
            }
            disabled={loadingChildren || options.length === 0}
            searchable
            searchPlaceholder="Kind suchen"
          />
        </div>
      </div>
      <LoadErrorAlert error={childrenError} actionLayout="responsive" />
      <LoadErrorAlert error={previewError} actionLayout="responsive" />
      {!chosen && !loadingChildren && !childrenError ? (
        <EmptyState
          variant="compact"
          description="Noch kein Kind in der Auswahl. Die Vorschau zeigt den Brief, sobald ein Kind da ist."
        />
      ) : shown ? (
        <p className="text-sm leading-6 whitespace-pre-line text-gray-900">
          <LinkifiedText text={shown.body} />
        </p>
      ) : (chosen && !preview.error) || loadingChildren ? (
        <SkeletonRows rows={3} />
      ) : null}
      <p className="text-xs text-gray-500">
        Jede Familie bekommt den Brief mit den Angaben ihres Kindes. Fehlt eine
        Angabe, bleibt die Stelle leer.
      </p>
    </InsetPanel>
  );
}
