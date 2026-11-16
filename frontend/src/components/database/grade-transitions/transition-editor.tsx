"use client";
import { FramedList } from "~/components/ui/framed-list";
import { parseISODate, berlinTodayISO } from "~/lib/date-helpers";

// Editor for a Jahrgangswechsel draft: one row per class with the target
// class or "Abgang" (child leaves the OGS, soft-deactivated as alumnus).

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { CustomSelect } from "~/components/ui/custom-select";
import { Input } from "~/components/ui/input";
import { ListSkeleton, SkeletonRegion } from "~/components/ui/page-skeletons";
import {
  SlideOver,
  SlideOverContent,
  SlideOverDescription,
  SlideOverFooter,
  SlideOverHeader,
  SlideOverTitle,
} from "~/components/ui/slide-over";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { useApiFormError } from "~/contexts/ToastContext";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { schoolClassLabel } from "~/lib/school-class-label";
import {
  createGradeTransition,
  fetchSuggestedMappings,
  fetchTransitionClasses,
  updateGradeTransition,
  type GradeTransition,
  type MappingInput,
  type SuggestedMapping,
} from "~/lib/grade-transition-api";

const logger = createLogger({ component: "GradeTransitionEditor" });

export interface EditorRow {
  fromClass: string;
  mode: "promote" | "graduate";
  toClass: string;
  studentCount: number | null;
}

const NO_CLASSES: string[] = [];

const MODE_OPTIONS = [
  { value: "promote", label: "Versetzen nach" },
  { value: "graduate", label: "Abgang (verlässt die OGS)" },
] as const;

/** Suggests the academic year label for the upcoming school year change. */
function suggestAcademicYear(now: Date): string {
  // From May onwards the transition targets the school year starting in
  // summer of the current year; before that it belongs to the previous one.
  const year = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

/**
 * Rows of a new transition from the backend's suggestions: every class with
 * children, its proposed next class or Abgang, and how many children it has.
 */
function rowsFromSuggestions(suggestions: SuggestedMapping[]): EditorRow[] {
  return suggestions.map((s) => ({
    fromClass: s.fromClass,
    // An ambiguous class (no grade pattern, e.g. "offen" or a free-form
    // name) must not be preselected as Abgang — default it to a
    // non-destructive "Versetzen" with an empty target so the admin has
    // to make an explicit choice before continuing.
    mode: !s.ambiguous && s.isGraduating ? "graduate" : "promote",
    toClass: s.ambiguous ? "" : (s.toClass ?? ""),
    studentCount: s.studentCount,
  }));
}

/**
 * Rows of a saved draft. The draft stores no child counts, so its rows show
 * none until the preview counts them.
 */
function rowsFromTransition(transition: GradeTransition): EditorRow[] {
  return transition.mappings.map((m) => ({
    fromClass: m.fromClass,
    mode: m.toClass === null ? "graduate" : "promote",
    toClass: m.toClass ?? "",
    studentCount: null,
  }));
}

interface TransitionEditorProps {
  /**
   * The draft to edit; null starts a new transition from the suggestions.
   */
  readonly existingDraft: GradeTransition | null;
  readonly onClose: () => void;
  readonly onReadyForPreview: (transition: GradeTransition) => void;
}

export function TransitionEditor({
  existingDraft,
  onClose,
  onReadyForPreview,
}: TransitionEditorProps) {
  const [academicYear, setAcademicYear] = useState(
    existingDraft?.academicYear ??
      suggestAcademicYear(parseISODate(berlinTodayISO())),
  );
  const [notes, setNotes] = useState(existingDraft?.notes ?? "");
  // The draft is local state and never written into the cache. Until the
  // first change it shows the cached suggestions; the first change copies
  // them, so a later refresh of the suggestions never replaces an edit.
  // A saved draft starts from its own mappings and reads no suggestions.
  const [draftRows, setDraftRows] = useState<EditorRow[] | null>(
    existingDraft ? rowsFromTransition(existingDraft) : null,
  );
  const {
    data: suggestions,
    error: suggestionsError,
    mutate: reloadSuggestions,
  } = useSWRAuth(
    existingDraft ? null : tenantAdminKeys.gradeTransitionSuggestions(),
    fetchSuggestedMappings,
  );
  const suggestionRows = useMemo(
    () => (suggestions ? rowsFromSuggestions(suggestions) : null),
    [suggestions],
  );
  const rows = draftRows ?? suggestionRows;
  // Lade- und Speicherfehler bleiben im Panel, mit Katalogtext und
  // Wiederholen (#2517).
  const { error: loadError } = useSwrResourceLoadError(
    [{ data: suggestions, error: suggestionsError }],
    "die Liste der Vorschläge",
    () => reloadSuggestions(),
  );
  const {
    error: saveError,
    show: showSaveError,
    clear: clearSaveError,
  } = useApiFormError();
  const latestContinueRef = useRef<() => void>(() => undefined);
  // Mounted only while open: one session per editor (#6593).
  const save = useFormModalPending();
  const [classToAdd, setClassToAdd] = useState("");

  // All classes with children, so a row removed via "Nicht ändern" can be
  // added back (the suggestions are only the initial proposal). Bewusst still
  // bei einem Fehler: die Liste dient nur dem Wieder-Hinzufügen einer
  // entfernten Zeile. Die Vorschläge und das Speichern gehen ohne sie.
  const { data: allClasses = NO_CLASSES } = useSWRAuth(
    tenantAdminKeys.gradeTransitionClasses(),
    fetchTransitionClasses,
  );

  const updateRow = (index: number, patch: Partial<EditorRow>) => {
    setDraftRows((current) =>
      (current ?? suggestionRows ?? []).map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const removeRow = (index: number) => {
    setDraftRows((current) =>
      (current ?? suggestionRows ?? []).filter((_, i) => i !== index),
    );
  };

  const addRow = (fromClass: string) => {
    if (!fromClass) return;
    setDraftRows((current) => {
      const next = current ?? suggestionRows ?? [];
      if (next.some((r) => r.fromClass === fromClass)) return next;
      return [
        ...next,
        { fromClass, mode: "promote", toClass: "", studentCount: null },
      ];
    });
    setClassToAdd("");
  };

  // Classes with children that are not already a row — offered in the
  // "add class" selector so a removed class can be brought back.
  const addableClasses = useMemo(() => {
    const present = new Set((rows ?? []).map((r) => r.fromClass));
    return allClasses.filter((c) => !present.has(c));
  }, [allClasses, rows]);

  const validationError = useMemo(() => {
    if (!/^\d{4}-\d{4}$/.test(academicYear)) {
      return "Schuljahr im Format JJJJ-JJJJ angeben (z. B. 2026-2027).";
    }
    for (const row of rows ?? []) {
      if (row.mode === "promote") {
        const target = row.toClass.trim();
        if (!target) {
          return `Zielklasse für ${row.fromClass} fehlt.`;
        }
        if (target === row.fromClass) {
          return `Zielklasse für ${row.fromClass} darf nicht identisch sein.`;
        }
      }
    }
    if ((rows ?? []).length === 0) {
      return "Mindestens eine Klasse wird benötigt.";
    }
    return null;
  }, [academicYear, rows]);

  const handleContinue = async () => {
    if (validationError || !rows) return;
    await save.run(async (op) => {
      clearSaveError();

      const mappings: MappingInput[] = rows.map((row) => ({
        fromClass: row.fromClass,
        toClass: row.mode === "graduate" ? null : row.toClass.trim(),
      }));

      try {
        const transition = existingDraft
          ? await updateGradeTransition(existingDraft.id, {
              academicYear,
              // Send the raw value (including "") so clearing the field actually
              // removes the stored note instead of leaving the old one in place.
              notes,
              mappings,
            })
          : await createGradeTransition({
              academicYear,
              notes: notes || undefined,
              mappings,
            });
        // A late answer must not switch a closed editor to the preview.
        if (op.isCurrent()) onReadyForPreview(transition);
      } catch (error) {
        logger.error("draft_save_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        // grade_transition.not_draft (jemand hat den Entwurf inzwischen
        // angewendet) erklärt der Katalog; Wiederholen bietet er nur bei
        // Server- und Verbindungsfehlern an (#405 review).
        void showSaveError(error, {
          object: "das Speichern des Entwurfs",
          retry: () => latestContinueRef.current(),
        });
      }
    });
  };

  // Wiederholen speichert den aktuellen Stand des Entwurfs.
  useLayoutEffect(() => {
    latestContinueRef.current = () => void handleContinue();
  });

  return (
    <SlideOver
      open
      pending={save}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SlideOverContent size="lg">
        <SlideOverHeader>
          <SlideOverTitle>
            {existingDraft
              ? "Schuljahreswechsel bearbeiten"
              : "Neuer Schuljahreswechsel"}
          </SlideOverTitle>
          <SlideOverDescription>
            Festlegen, wohin die Kinder jeder Klasse versetzt werden.
          </SlideOverDescription>
        </SlideOverHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="transition-academic-year"
              label="Schuljahr (neu)"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              placeholder="2026-2027"
            />
            <Input
              id="transition-notes"
              label="Notiz (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z. B. Schuljahreswechsel Sommer"
            />
          </div>

          <p className="text-sm text-gray-600">
            Für jede Klasse festlegen, wohin die Kinder versetzt werden. Abgang
            bedeutet: Die Kinder verlassen die OGS und werden aus der App
            ausgeblendet. Das lässt sich über Zurücksetzen wieder rückgängig
            machen.
          </p>

          <LoadErrorAlert error={loadError} />
          {rows === null && !loadError && (
            <SkeletonRegion label="Klassenvorschläge werden geladen">
              <ListSkeleton rows={5} avatar={false} />
            </SkeletonRegion>
          )}

          {rows !== null && (
            <FramedList>
              {rows.length === 0 && (
                <li className="p-4 text-sm text-gray-500">
                  Keine Klassen mit Kindern gefunden.
                </li>
              )}
              {rows.map((row, index) => (
                <li
                  key={row.fromClass}
                  className="flex flex-wrap items-center gap-3 p-3"
                >
                  <div className="w-20 shrink-0">
                    <span className="font-medium text-gray-900">
                      {row.fromClass}
                    </span>
                    {row.studentCount !== null && (
                      <span className="ml-1 text-xs text-gray-500">
                        ({row.studentCount})
                      </span>
                    )}
                  </div>
                  <div className="w-56 shrink-0">
                    <CustomSelect
                      ariaLabel={`Aktion für ${schoolClassLabel(row.fromClass)}`}
                      value={row.mode}
                      options={MODE_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      }))}
                      onChange={(value) =>
                        updateRow(index, {
                          mode: value as EditorRow["mode"],
                        })
                      }
                    />
                  </div>
                  {row.mode === "promote" ? (
                    <div className="w-28">
                      <Input
                        aria-label={`Zielklasse für ${row.fromClass}`}
                        value={row.toClass}
                        onChange={(e) =>
                          updateRow(index, { toClass: e.target.value })
                        }
                        placeholder="z. B. 2a"
                      />
                    </div>
                  ) : (
                    <span className="text-moto-red text-sm font-medium">
                      Abgang
                    </span>
                  )}
                  <div className="ml-auto">
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      onClick={() => removeRow(index)}
                      aria-label={`${schoolClassLabel(row.fromClass)} nicht ändern`}
                      tooltip="Nimmt die Klasse aus dem Wechsel, ihre Kinder bleiben dort."
                    >
                      Nicht ändern
                    </Button>
                  </div>
                </li>
              ))}
            </FramedList>
          )}

          {rows !== null && addableClasses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-56">
                <CustomSelect
                  ariaLabel="Klasse hinzufügen"
                  value={classToAdd}
                  placeholder="Klasse hinzufügen …"
                  options={addableClasses.map((c) => ({ value: c, label: c }))}
                  onChange={(value) => setClassToAdd(value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => addRow(classToAdd)}
                disabled={!classToAdd}
                tooltip="Nimmt die gewählte Klasse in den Wechsel auf."
                disabledReason="Wählen Sie zuerst eine Klasse aus."
              >
                Hinzufügen
              </Button>
            </div>
          )}

          {validationError && rows !== null && rows.length > 0 && (
            <p className="text-moto-orange-strong text-sm">{validationError}</p>
          )}
          <FormErrorAlert message={saveError} />
        </div>
        <SlideOverFooter>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            noTooltip="Schließt das Fenster, nichts wird gespeichert."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            size="md"
            onClick={handleContinue}
            disabled={Boolean(validationError) || save.pending || !rows}
            tooltip="Speichert den Entwurf und zeigt, welche Kinder wohin wechseln."
            disabledReason={
              save.pending || !rows ? undefined : (validationError ?? undefined)
            }
          >
            {save.pending ? "Speichern …" : "Weiter zur Vorschau"}
          </Button>
        </SlideOverFooter>
      </SlideOverContent>
    </SlideOver>
  );
}
