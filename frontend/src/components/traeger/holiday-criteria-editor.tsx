"use client";

// Die Kriterien der Platzvergabe festlegen (#4700). Die Reihenfolge ist die
// Priorität: das oberste Kriterium zählt am meisten. Jede Frage beantworten
// Eltern mit Ja oder Nein, einmal für die Familie oder für jedes Kind.
// Entfernen nimmt ein Kriterium aus der Liste; schon gegebene Antworten und
// Entscheidungen bleiben gespeichert. Vorlagen sind nur Vorschläge.

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { FieldLabel } from "~/components/ui/field-label";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import { Input } from "~/components/ui/input";
import { InsetPanel } from "~/components/ui/inset-panel";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { StatusBadge } from "~/components/ui/status-badge";
import { SwitchRow } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useReadDraftLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { type DraftSource, useDraftOn } from "~/lib/swr/read-draft";
import {
  type HolidayCriterion,
  type HolidayCriterionScope,
  MAX_CRITERION_NAME,
  MAX_CRITERION_QUESTION,
  MAX_HOLIDAY_CRITERIA,
  saveHolidayCriteria,
} from "~/lib/traeger-holiday-allocation-api";
import {
  CRITERION_TEMPLATES,
  type CriterionDraft,
  criteriaChanged,
  draftsFromCriteria,
  emptyCriterion,
  fromTemplate,
  inputsFromDrafts,
  moveCriterion,
  templateUsed,
  validateCriteria,
} from "./holiday-criteria-model";

const logger = createLogger({ component: "HolidayCriteriaEditor" });

const SCOPES: readonly { value: HolidayCriterionScope; label: string }[] = [
  { value: "family", label: "Familie" },
  { value: "child", label: "Jedes Kind" },
];

/** How the parents see the question: the text with its two answers. */
function ParentPreview({ draft }: Readonly<{ draft: CriterionDraft }>) {
  return (
    <InsetPanel dashed padding="sm">
      <SectionLabel as="p">So sehen Eltern die Frage</SectionLabel>
      <p className="mt-1 text-sm font-medium text-gray-900">
        {draft.question.trim() || "Hier steht deine Frage."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone="outline" size="xs" label="Ja" />
        <StatusBadge tone="outline" size="xs" label="Nein" />
        <span className="text-sm text-gray-600">
          {draft.scope === "family"
            ? "Einmal für die Familie. Pflichtfrage."
            : "Für jedes Kind einzeln. Pflichtfrage."}
        </span>
      </div>
    </InsetPanel>
  );
}

function CriterionRow({
  draft,
  index,
  count,
  disabled,
  fieldError,
  onChange,
  onMove,
  onRemove,
}: Readonly<{
  draft: CriterionDraft;
  index: number;
  count: number;
  disabled: boolean;
  fieldError: (name: string) => string | undefined;
  onChange: (next: CriterionDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}>) {
  const position = index + 1;
  const label = draft.name.trim() || `Kriterium ${position}`;
  const scopeId = `criterion-${draft.key}-scope`;
  const scopeError = fieldError(`criteria.${index}.scope`);
  return (
    <InsetPanel as="li" tone="white" framed padding="md" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile
          icon={
            <span className="text-sm font-semibold tabular-nums">
              {position}
            </span>
          }
          size="xs"
          shape="round"
          tone={draft.active ? "inverse" : "neutral"}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SectionLabel as="h3" className="wrap-anywhere">
            <span className="sr-only">Priorität {position}: </span>
            {label}
          </SectionLabel>
          {/* Neutral: the rank number in front ties the criterion to the
              chips at a child; colour means status only (#7411). */}
          <StatusBadge
            tone="gray"
            size="xs"
            label={draft.active ? `Priorität ${position}` : "Ausgeschaltet"}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || index === 0}
            disabledReason={
              index === 0
                ? "Dieses Kriterium hat schon die höchste Priorität."
                : undefined
            }
            tooltip="Schiebt das Kriterium eine Stelle höher, es zählt dann mehr."
            aria-label={`„${label}“ nach oben, höhere Priorität`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || index === count - 1}
            disabledReason={
              index === count - 1
                ? "Dieses Kriterium hat schon die niedrigste Priorität."
                : undefined
            }
            tooltip="Schiebt das Kriterium eine Stelle tiefer, es zählt dann weniger."
            aria-label={`„${label}“ nach unten, niedrigere Priorität`}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <OverflowMenu
            ariaLabel={`Weitere Aktionen für „${label}“`}
            disabled={disabled}
            items={[
              {
                label: "Entfernen",
                description: draft.answered
                  ? "Wirksam erst nach dem Speichern. Gegebene Antworten bleiben gespeichert."
                  : "Nimmt das Kriterium aus der Liste, wirksam erst nach dem Speichern.",
                destructive: true,
                onClick: onRemove,
              },
            ]}
          />
        </div>
      </div>

      <SwitchRow
        framed={false}
        checked={draft.active}
        disabled={disabled}
        ariaLabel={`„${label}“ eingeschaltet`}
        onCheckedChange={(active) => onChange({ ...draft, active })}
        label={
          draft.active
            ? "Eingeschaltet: Eltern sehen die Frage."
            : "Ausgeschaltet: Eltern sehen die Frage nicht. Es zählt nicht."
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          controlSize="compact"
          name={`criteria.${index}.name`}
          label="Name"
          hint="Sehen nur du und dein Büro."
          required
          maxLength={MAX_CRITERION_NAME}
          value={draft.name}
          disabled={disabled}
          error={fieldError(`criteria.${index}.name`)}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <div className="space-y-1">
          <FieldLabel id={scopeId}>Gilt für</FieldLabel>
          {/* Named like the server's field, so a refused scope focuses here. */}
          <input
            type="hidden"
            name={`criteria.${index}.scope`}
            value={draft.scope}
          />
          <SegmentedControl
            items={SCOPES.map((scope) => ({
              ...scope,
              disabled: disabled || draft.answered,
            }))}
            value={draft.scope}
            onChange={(scope) => onChange({ ...draft, scope })}
            ariaLabel={`Gilt für: ${label}`}
            ariaDescribedBy={scopeError ? `${scopeId}-error` : undefined}
          />
          <FieldErrorHint id={`${scopeId}-error`} message={scopeError} />
          {draft.answered ? (
            <p className="text-sm text-gray-600">
              Eltern haben schon geantwortet. Darum bleibt das so.
            </p>
          ) : null}
        </div>
      </div>
      <Textarea
        name={`criteria.${index}.question`}
        label="Frage an die Eltern"
        hint="Eine Frage, die man mit Ja oder Nein beantwortet."
        required
        rows={2}
        autoGrow
        maxLength={MAX_CRITERION_QUESTION}
        value={draft.question}
        disabled={disabled}
        error={fieldError(`criteria.${index}.question`)}
        onChange={(event) =>
          onChange({ ...draft, question: event.target.value })
        }
      />
      <ParentPreview draft={draft} />
    </InsetPanel>
  );
}

export function HolidayCriteriaEditor({
  source,
}: Readonly<{
  /**
   * The read of the criteria; the list rests on the version read when
   * editing starts, and a save hands its answer back (ADR 0311).
   */
  source: DraftSource<HolidayCriteriaRead>;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const toast = useToast();
  // A newer read refills the list only while untouched; after a refusal
  // the stored criteria show, and nothing is sent until they were read.
  const editor = useDraftOn<
    HolidayCriteriaRead,
    CriterionDraft[],
    string,
    HolidayCriteriaRead
  >(source, {
    token: (stored) => stored.version,
    toDraft: (stored) => draftsFromCriteria(stored.criteria),
    answer: (saved) => saved,
  });
  const criteria: readonly HolidayCriterion[] = (
    editor.base ?? source.data
  )?.criteria ?? [];
  const drafts = editor.draft ?? draftsFromCriteria(criteria);
  const setDrafts = editor.setDraft;
  const loadError = useReadDraftLoadError(editor, "die Kriterien");
  const [saving, setSaving] = useState(false);
  const changed = criteriaChanged(drafts, criteria);
  const full = drafts.length >= MAX_HOLIDAY_CRITERIA;
  const fieldError = (name: string) => formErrors.fieldError(name) ?? undefined;
  const unusedTemplates = CRITERION_TEMPLATES.filter(
    (template) => !templateUsed(drafts, template.name),
  );

  const setDraft = (index: number, next: CriterionDraft) =>
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? next : draft)),
    );

  const save = async () => {
    const errors = validateCriteria(drafts);
    if (Object.keys(errors).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", errors);
      return;
    }
    formErrors.clear();
    if (!editor.canSubmit) return;
    setSaving(true);
    const result = await editor.submit((version, edited) =>
      saveHolidayCriteria(inputsFromDrafts(edited), version),
    );
    setSaving(false);
    if (result.ok) {
      toast.success("Die Kriterien sind gespeichert.");
      return;
    }
    logger.error("holiday_criteria_save_failed", {
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    // Changed since it was read: the stored criteria show once they are
    // read again, without offering the same save once more.
    void formErrors.show(result.error, {
      object: "die Kriterien",
      ...(result.refused ? { reload: result.reload } : {}),
    });
  };

  return (
    <form
      ref={formRef}
      noValidate
      aria-label="Kriterien der Platzvergabe"
      // A flex column only so the one card grows to the bottom edge; the
      // page body sets the spacing (#7411).
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <SectionCard
        title="Kriterien"
        description="Die Reihenfolge ist die Priorität. Das oberste Kriterium zählt am meisten."
        footer={
          <EditActions
            onCancel={() => {
              formErrors.clear();
              editor.discard();
            }}
            cancelDisabled={saving || !changed}
            cancelLabel="Verwerfen"
            saving={saving}
            disabled={!changed || !editor.canSubmit}
            {...(changed && !editor.canSubmit
              ? {
                  disabledReason:
                    editor.status === "loadFailed"
                      ? "Lade zuerst die gespeicherten Kriterien neu."
                      : "Die gespeicherten Kriterien werden geladen.",
                }
              : {})}
            saveType="submit"
            saveLabel="Kriterien speichern"
            stretchOnPhone
          />
        }
      >
        <div className="space-y-4">
          {loadError ? <LoadErrorAlert error={loadError} /> : null}
          <FormErrorAlert message={formErrors.error} />
          <Alert
            type="info"
            message="Frage nur, was du für die Vergabe wirklich brauchst. Frage nicht nach Gesundheit oder Förderbedarf. Eltern antworten mit Ja oder Nein. Das Büro kann nach einem Nachweis fragen."
          />
          {drafts.length === 0 ? (
            <EmptyState
              variant="dashed"
              title="Noch kein Kriterium"
              description="Wähle unten eine Vorlage oder lege ein eigenes Kriterium an."
            />
          ) : (
            <ol className="space-y-3" aria-label="Kriterien nach Priorität">
              {drafts.map((draft, index) => (
                <CriterionRow
                  key={draft.key}
                  draft={draft}
                  index={index}
                  count={drafts.length}
                  disabled={saving}
                  fieldError={fieldError}
                  onChange={(next) => setDraft(index, next)}
                  onMove={(delta) =>
                    setDrafts((current) => moveCriterion(current, index, delta))
                  }
                  onRemove={() =>
                    setDrafts((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                />
              ))}
            </ol>
          )}
          <FieldErrorHint
            id="holiday-criteria-error"
            message={fieldError("criteria")}
          />
          <div className="space-y-2 border-t border-gray-200 pt-4">
            <SectionLabel as="h3">Kriterium hinzufügen</SectionLabel>
            {full ? (
              <p className="text-sm text-gray-600">
                Es gehen höchstens {MAX_HOLIDAY_CRITERIA} Kriterien.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {unusedTemplates.map((template) => (
                  <Button
                    key={template.name}
                    type="button"
                    variant="outline"
                    size="compact"
                    className="gap-1.5"
                    disabled={saving}
                    aria-label={`Vorlage „${template.name}“ hinzufügen`}
                    tooltip="Fügt das Kriterium unten an, wirksam erst nach dem Speichern."
                    onClick={() =>
                      setDrafts((current) => [
                        ...current,
                        fromTemplate(template),
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {template.name}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="dashed"
                  size="compact"
                  className="gap-1.5"
                  disabled={saving}
                  tooltip="Fügt ein leeres Kriterium an, das du selbst benennst."
                  onClick={() =>
                    setDrafts((current) => [...current, emptyCriterion()])
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Eigenes Kriterium
                </Button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </form>
  );
}
