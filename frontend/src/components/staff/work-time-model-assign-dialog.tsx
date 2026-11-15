"use client";

// Dialog „Personen zuordnen“ (#6921): mehrere Personen auf einmal einer
// Vorlage zuordnen, ab heute oder rückwirkend. Die Liste zeigt an jeder
// Person, woher ihr Soll heute kommt und warum sie gerade nicht wählbar ist;
// das Backend prüft dieselben Regeln beim Speichern noch einmal.

import { useId, useMemo, useState } from "react";

import { Alert } from "~/components/ui/alert";
import { Avatar } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ChoiceTile } from "~/components/ui/choice-tile";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EmptyState } from "~/components/ui/empty-state";
import { FormModal } from "~/components/ui/form-modal";
import { Input } from "~/components/ui/input";
import { SectionLabel } from "~/components/ui/section-label";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { createLogger } from "~/lib/logger";
import { foldForSearch } from "~/lib/search-fold";
import { workTimeModelService, type WorkTimeModel } from "~/lib/staff-api";

import {
  blockedReason,
  dayBefore,
  peopleCount,
  startPhrase,
  suggestedEarlierStart,
  type AssignmentPerson,
} from "./work-time-model-assignment-helpers";

const logger = createLogger({ component: "WorkTimeModelAssignDialog" });

type StartMode = "today" | "earlier";

const START_ITEMS = [
  { value: "today", label: "Ab heute" },
  { value: "earlier", label: "Früheres Datum" },
] as const;

export interface WorkTimeModelAssignDialogProps {
  readonly isOpen: boolean;
  readonly model: WorkTimeModel;
  /** Alle, die die Vorlage noch nicht nutzen. */
  readonly candidates: readonly AssignmentPerson[];
  readonly onClose: () => void;
  /** Lädt Liste und Soll-Ansichten neu, nachdem gespeichert ist. */
  readonly onAssigned: () => Promise<unknown>;
}

export function WorkTimeModelAssignDialog({
  isOpen,
  model,
  candidates,
  onClose,
  onAssigned,
}: WorkTimeModelAssignDialogProps) {
  const formId = useId();
  const confirmId = useId();
  const today = useBerlinToday();
  const toast = useToast();
  const formErrors = useApiFormError();
  const save = useFormModalPending(isOpen, model.id);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<StartMode>("today");
  const [earlierDate, setEarlierDate] = useState(() =>
    suggestedEarlierStart(today),
  );
  const [confirmed, setConfirmed] = useState(false);

  const validFrom = mode === "earlier" ? earlierDate : null;
  const reasons = useMemo(
    () =>
      new Map(
        candidates.map((person) => [
          person.id,
          blockedReason(person, validFrom),
        ]),
      ),
    [candidates, validFrom],
  );
  const term = foldForSearch(search.trim());
  const visible = term
    ? candidates.filter((person) => foldForSearch(person.name).includes(term))
    : candidates;
  const selectable = visible.filter((person) => !reasons.get(person.id));
  // Wer mit dem gewählten Start nicht mehr wählbar ist, fällt aus der
  // Auswahl: eine Person, die die Liste als gesperrt zeigt, wird nie
  // unbemerkt mitgespeichert.
  const selectedIds = candidates
    .filter((person) => selected.has(person.id) && !reasons.get(person.id))
    .map((person) => person.id);
  const allVisibleSelected =
    selectable.length > 0 &&
    selectable.every((person) => selected.has(person.id));
  const retroactive = mode === "earlier";
  const isSaving = save.pending;

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllVisible = () =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const person of selectable) {
        if (allVisibleSelected) next.delete(person.id);
        else next.add(person.id);
      }
      return next;
    });

  const handleClose = () => {
    setSelected(new Set());
    setSearch("");
    setMode("today");
    setEarlierDate(suggestedEarlierStart(today));
    setConfirmed(false);
    formErrors.clear();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedIds.length === 0 || (retroactive && !confirmed)) return;
    formErrors.clear();
    await save.run(async (op) => {
      let result;
      try {
        result = await workTimeModelService.assign(
          model.id,
          selectedIds,
          validFrom ?? undefined,
        );
      } catch (err: unknown) {
        logger.error("work_time_model_assign_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (op.isCurrent()) {
          void formErrors.show(err, { object: "die Zuordnung" });
        }
        return;
      }
      // Gespeichert ist gespeichert: auch ein abgebrochener Dialog lädt neu.
      await onAssigned();
      if (!op.isCurrent()) return;
      const count = result.assignedStaffIds.length;
      toast.success(
        count === 0
          ? `Die Gewählten nutzen „${model.name}“ schon.`
          : `„${model.name}“ gilt jetzt für ${peopleCount(count)} ${startPhrase(result.validFrom, today)}.`,
      );
      handleClose();
    });
  };

  const submitLabel = isSaving
    ? "Wird zugeordnet…"
    : selectedIds.length === 0
      ? "Zuordnen"
      : `${peopleCount(selectedIds.length)} zuordnen`;
  let disabledReason: string | undefined;
  if (selectedIds.length === 0) {
    disabledReason = "Wählen Sie zuerst mindestens eine Person aus.";
  } else if (retroactive && !confirmed) {
    disabledReason = "Bestätigen Sie zuerst den rückwirkenden Start.";
  }

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Personen zuordnen"
      size="lg"
      error={formErrors.error}
      pending={save}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <p
            className="mr-auto text-sm text-gray-600"
            aria-live="polite"
            data-testid="assign-summary"
          >
            {selectedIds.length === 0
              ? "Noch niemand ausgewählt"
              : `${peopleCount(selectedIds.length)} · ${startPhrase(validFrom, today)}`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleClose}
              disabled={isSaving}
              noTooltip="Schließt nur das Fenster."
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="success"
              size="md"
              disabled={isSaving || disabledReason !== undefined}
              disabledReason={isSaving ? undefined : disabledReason}
              tooltip="Gibt den Gewählten sofort das Soll dieser Vorlage."
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-gray-600">
          Die Gewählten bekommen das Soll von „{model.name}“. Ihr bisheriges
          Soll endet am Tag davor.
        </p>

        <fieldset className="space-y-3">
          <SectionLabel as="legend">Ab wann gilt das neue Soll?</SectionLabel>
          <SegmentedControl
            items={START_ITEMS}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setConfirmed(false);
            }}
            ariaLabel="Ab wann gilt das neue Soll"
            fullWidth
          />
          {retroactive ? (
            <div className="space-y-3">
              <ISODatePicker
                label="Gilt ab"
                value={earlierDate}
                onChange={(next) => {
                  if (next) setEarlierDate(next);
                  setConfirmed(false);
                }}
                max={dayBefore(today)}
                hint="Nur für Personen ohne bisheriges Soll."
              />
              <Alert
                type="warning"
                title="Rückwirkend kann es Minusstunden geben"
                message={`moto rechnet ab dem ${formatDate(earlierDate)} mit dem neuen Soll. Wer an diesen Tagen weniger gearbeitet hat, rutscht im Stundenkonto ins Minus.`}
              />
              <label htmlFor={confirmId} className="flex items-start gap-2">
                <Checkbox
                  id={confirmId}
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span className="text-sm font-medium text-gray-800">
                  Ich ordne trotzdem rückwirkend zu.
                </span>
              </label>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <SectionLabel as="legend">Wer bekommt die Vorlage?</SectionLabel>
          <Input
            type="search"
            name="work-time-model-assign-search"
            aria-label="Personen durchsuchen"
            controlSize="compact"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name suchen…"
          />
          <PeopleChoice
            visible={visible}
            reasons={reasons}
            selected={selected}
            hasSearch={term.length > 0}
            hasCandidates={candidates.length > 0}
            selectableCount={selectable.length}
            allVisibleSelected={allVisibleSelected}
            disabled={isSaving}
            onToggle={toggle}
            onToggleAll={toggleAllVisible}
          />
        </fieldset>
      </form>
    </FormModal>
  );
}

interface PeopleChoiceProps {
  readonly visible: readonly AssignmentPerson[];
  readonly reasons: ReadonlyMap<string, string | null>;
  readonly selected: ReadonlySet<string>;
  readonly hasSearch: boolean;
  readonly hasCandidates: boolean;
  readonly selectableCount: number;
  readonly allVisibleSelected: boolean;
  readonly disabled: boolean;
  readonly onToggle: (id: string) => void;
  readonly onToggleAll: () => void;
}

function PeopleChoice({
  visible,
  reasons,
  selected,
  hasSearch,
  hasCandidates,
  selectableCount,
  allVisibleSelected,
  disabled,
  onToggle,
  onToggleAll,
}: PeopleChoiceProps) {
  if (!hasCandidates) {
    return (
      <EmptyState
        variant="compact"
        title="Alle Personen nutzen diese Vorlage schon."
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        variant="compact"
        title={
          hasSearch
            ? "Keine Person mit diesem Namen gefunden."
            : "Keine Person gefunden."
        }
      />
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          {selectableCount === visible.length
            ? peopleCount(visible.length)
            : `${peopleCount(visible.length)}, davon ${selectableCount} wählbar`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={onToggleAll}
          disabled={disabled || selectableCount === 0}
          disabledReason={
            !disabled && selectableCount === 0
              ? "Gerade ist hier niemand wählbar."
              : undefined
          }
          tooltip={
            allVisibleSelected
              ? "Nimmt den Haken bei allen angezeigten Personen weg."
              : "Setzt den Haken bei allen angezeigten Personen, die wählbar sind."
          }
        >
          {allVisibleSelected ? "Auswahl aufheben" : "Alle auswählen"}
        </Button>
      </div>
      <ul className="grid gap-2" aria-label="Personen">
        {visible.map((person) => {
          const reason = reasons.get(person.id) ?? null;
          const isSelected = reason === null && selected.has(person.id);
          return (
            <li key={person.id}>
              <ChoiceTile
                selected={isSelected}
                disabled={disabled || reason !== null}
                tone="green"
              >
                <Checkbox
                  checked={isSelected}
                  disabled={disabled || reason !== null}
                  onChange={() => onToggle(person.id)}
                  aria-describedby={
                    reason ? `assign-reason-${person.id}` : undefined
                  }
                />
                <Avatar
                  name={person.name}
                  imageUrl={person.avatarUrl}
                  size="sm"
                  decorative
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">
                    {person.name}
                  </span>
                  <span
                    id={reason ? `assign-reason-${person.id}` : undefined}
                    className="block text-gray-500"
                  >
                    {reason ??
                      [person.current, person.role].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </ChoiceTile>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
