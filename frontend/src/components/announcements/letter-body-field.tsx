"use client";

import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { InsetPanel } from "~/components/ui/inset-panel";
import { SectionLabel } from "~/components/ui/section-label";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Textarea } from "~/components/ui/textarea";
import { useApiLoadError } from "~/contexts/ToastContext";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  fetchLetterPlaceholders,
  previewLetter,
  type LetterPlaceholder,
  type LetterPreview,
} from "~/lib/parent-announcements-api";
import { useSWRAuth } from "~/lib/swr";
import { parentAnnouncementKeys } from "~/lib/swr/portal-keys";

/** A child the preview can show. */
interface LetterPreviewChild {
  readonly value: string;
  readonly label: string;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const PREVIEW_DELAY_MS = 400;

/** The placeholders a text names, in lower case, once each. */
export function placeholderNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    names.add((match[1] ?? "").toLowerCase());
  }
  return [...names];
}

interface LetterBodyFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
  /** API base of the portal; the OGS default when absent. */
  readonly apiBase?: string;
  /** Children whose letter the preview can show. */
  readonly previewChildren: readonly LetterPreviewChild[];
  readonly previewChildrenLoading?: boolean;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly id?: string;
  readonly className?: string;
}

/**
 * The text of an Elternbrief that names each child (#4813): the field, the
 * placeholders to insert at the caret, a warning for a placeholder moto does
 * not know, and the letter as one chosen child reads it.
 */
export function LetterBodyField({
  value,
  onChange,
  error,
  apiBase,
  previewChildren,
  previewChildrenLoading = false,
  placeholder,
  rows = 5,
  id,
  className,
}: LetterBodyFieldProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const labelId = useId();

  const { data: placeholders } = useSWRAuth<LetterPlaceholder[]>(
    parentAnnouncementKeys.letterPlaceholders(
      apiBase === undefined ? "ogs" : "school",
    ),
    () =>
      apiBase === undefined
        ? fetchLetterPlaceholders()
        : fetchLetterPlaceholders(apiBase),
    { revalidateOnFocus: false },
  );
  const known = useMemo(
    () => new Set((placeholders ?? []).map((p) => p.name)),
    [placeholders],
  );
  const used = placeholderNames(value);
  const unknown = placeholders
    ? used.filter((name) => name === "" || !known.has(name))
    : [];
  const personal = used.length > 0;

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
        <ul aria-labelledby={labelId} className="flex flex-wrap gap-2">
          {(placeholders ?? []).map((p) => (
            <li key={p.name}>
              <Button
                type="button"
                variant="outline"
                size="compact"
                tooltip={`Setzt „${p.label}“ dort in den Text, wo Sie schreiben.`}
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
            message={`Diese Platzhalter kennt moto nicht: ${unknown
              .map((name) => `{{${name}}}`)
              .join(", ")}. Bitte nehmen Sie nur Platzhalter aus der Liste.`}
          />
        )}
      </div>

      {personal && unknown.length === 0 && (
        <LetterPreviewPanel
          body={value}
          apiBase={apiBase}
          options={previewChildren}
          loading={previewChildrenLoading}
        />
      )}
    </div>
  );
}

function LetterPreviewPanel({
  body,
  apiBase,
  options,
  loading,
}: Readonly<{
  body: string;
  apiBase?: string;
  options: readonly LetterPreviewChild[];
  loading: boolean;
}>) {
  const [studentId, setStudentId] = useState("");
  const [preview, setPreview] = useState<LetterPreview | null>(null);
  const [pending, setPending] = useState(false);
  const previewError = useApiLoadError();
  const { show: showPreviewError, clear: clearPreviewError } = previewError;
  const [retryKey, setRetryKey] = useState(0);

  // The first child is the default, so the preview shows a letter at once.
  const chosen = studentId || (options[0]?.value ?? "");

  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    setPending(true);
    const timer = setTimeout(() => {
      const call =
        apiBase === undefined
          ? previewLetter(body, chosen)
          : previewLetter(body, chosen, apiBase);
      call
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          clearPreviewError();
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreview(null);
          void showPreviewError(err, {
            object: "die Vorschau",
            retry: () => setRetryKey((key) => key + 1),
          });
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, chosen, apiBase, retryKey, showPreviewError, clearPreviewError]);

  return (
    <InsetPanel
      framed
      tone="white"
      padding="md"
      as="section"
      aria-label="Vorschau des Briefs"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionLabel as="h4">So liest die Familie den Brief</SectionLabel>
        <div className="sm:w-64">
          <CustomSelect
            ariaLabel="Kind für die Vorschau"
            value={chosen}
            options={options}
            onChange={setStudentId}
            placeholder={loading ? "Kinder werden geladen…" : "Kind wählen"}
            disabled={loading || options.length === 0}
            searchable
            searchPlaceholder="Kind suchen"
          />
        </div>
      </div>
      <div className="mt-3 border-t border-gray-100 pt-3" aria-live="polite">
        <LoadErrorAlert error={previewError.error} actionLayout="responsive" />
        {!chosen && !loading ? (
          <p className="text-sm text-gray-500">
            Noch kein Kind in der Auswahl. Die Vorschau zeigt den Brief, sobald
            ein Kind da ist.
          </p>
        ) : pending && !preview ? (
          <SkeletonRows rows={3} />
        ) : preview ? (
          <p className="text-sm leading-6 whitespace-pre-line text-gray-900">
            {preview.body}
          </p>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Jede Familie bekommt den Brief mit den Angaben ihres Kindes. Fehlt eine
        Angabe, bleibt die Stelle leer.
      </p>
    </InsetPanel>
  );
}
