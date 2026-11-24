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
import { ApiError, isReadStateRefusal } from "~/lib/api-error";
import { useSWRAuth } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { schoolClassLabel } from "~/lib/school-class-label";
import {
  createGradeTransition,
  fetchSuggestedMappings,
  fetchTransitionClasses,
  NOT_DRAFT_CODE,
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
  /** The draft to edit; null starts a new transition from the suggestions. */
  readonly existingDraft: GradeTransition | null;
  readonly onClose: () => void;
  readonly onReadyForPreview: (transition: GradeTransition) => void;
  /**
   * Reads the saved draft again after a save refused as changed since it was
   * read (ADR 0311); rejects when the read fails. A draft still open comes
   * back as `existingDraft` too.
   */
  readonly reload?: () => Promise<GradeTransition>;
  /**
   * A colleague applied the draft meanwhile (`grade_transition.not_draft`):
   * the caller closes the editor and shows `error` with the stored state.
   */
  readonly onNoLongerDraft?: (error: unknown) => void;
}

/** What the editor edits. */
interface EditorDraft {
  readonly academicYear: string;
  readonly notes: string;
  readonly rows: EditorRow[];
}

function draftOf(transition: GradeTransition): EditorDraft {
  return {
    academicYear: transition.academicYear,
    notes: transition.notes ?? "",
    rows: rowsFromTransition(transition),
  };
}

const isNotDraft = (error: unknown) =>
  error instanceof ApiError && error.code === NOT_DRAFT_CODE;

export function TransitionEditor({
  existingDraft,
  onClose,
  onReadyForPreview,
  reload,
  onNoLongerDraft,
}: TransitionEditorProps) {
  // A saved draft rests on its version (ADR 0311): a newer read refills it
  // only while untouched, after a refusal the stored draft shows, and
  // nothing is sent until it is read.
  const saved = useDraftOn<
    GradeTransition,
    EditorDraft,
    string,
    GradeTransition
  >(
    {
      opening: existingDraft?.id ?? null,
      data: existingDraft ?? undefined,
      reload: () =>
        reload
          ? reload()
          : Promise.reject(new Error("draft cannot be read again")),
    },
    {
      token: (transition) => transition.version,
      toDraft: draftOf,
      isRefusal: (error) => isReadStateRefusal(error) || isNotDraft(error),
      answer: (transition) => transition,
    },
  );
  // A new transition: local state, never written into the cache. Until the
  // first change it follows the suggestions (cached, read again on
  // opening); the first change copies them, so a later refresh never
  // replaces an edit. A saved draft reads no suggestions.
  const [newYear, setNewYear] = useState(() =>
    suggestAcademicYear(parseISODate(berlinTodayISO())),
  );
  const [newNotes, setNewNotes] = useState("");
  const [newRows, setNewRows] = useState<EditorRow[] | null>(null);
  const savedDraft = existingDraft
    ? (saved.draft ?? draftOf(existingDraft))
    : null;
  const academicYear = savedDraft?.academicYear ?? newYear;
  const notes = savedDraft?.notes ?? newNotes;
  const draftRows = savedDraft ? savedDraft.rows : newRows;
  const setAcademicYear = (value: string) =>
    existingDraft
      ? saved.setDraft((current) => ({ ...current, academicYear: value }))
      : setNewYear(value);
  const setNotes = (value: string) =>
    existingDraft
      ? saved.setDraft((current) => ({ ...current, notes: value }))
      : setNewNotes(value);
  const setDraftRows = (
    update: (current: EditorRow[] | null) => EditorRow[],
  ) =>
    existingDraft
      ? saved.setDraft((current) => ({
          ...current,
          rows: update(current.rows),
        }))
      : setNewRows(update);
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
    if (existingDraft && !saved.canSubmit) return;
    await save.run(async (op) => {
      clearSaveError();

      const mappings: MappingInput[] = rows.map((row) => ({
        fromClass: row.fromClass,
        toClass: row.mode === "graduate" ? null : row.toClass.trim(),
      }));

      const result = existingDraft
        ? await saved.submit((version) =>
            updateGradeTransition(existingDraft.id, {
              expectedVersion: version,
              academicYear,
              // Send the raw value (including "") so clearing the field
              // actually removes the stored note instead of leaving the old
              // one in place.
              notes,
              mappings,
            }),
          )
        : await createGradeTransition({
            academicYear,
            notes: notes || undefined,
            mappings,
          }).then(
            (transition) => ({ ok: true, saved: transition }) as const,
            (error: unknown) =>
              ({
                ok: false,
                error,
                refused: false,
                reload: undefined,
              }) as const,
          );
      if (result.ok) {
        // A late answer must not switch a closed editor to the preview.
        if (op.isCurrent()) onReadyForPreview(result.saved);
        return;
      }
      const error = result.error;
      logger.error("draft_save_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
      if (!op.isCurrent()) return;
      // Jemand hat den Entwurf inzwischen angewendet: kein Entwurf mehr zum
      // Bearbeiten, der Aufrufer schließt den Editor.
      if (isNotDraft(error) && onNoLongerDraft) {
        onNoLongerDraft(error);
        return;
      }
      // Hat jemand den Entwurf seit dem Öffnen gespeichert, zeigt `reload`
      // dessen Stand; gespeichert wird erst eine neue Bearbeitung
      // (ADR 0311). Wiederholen bietet der Fehlerweg nur bei Server- und
      // Verbindungsfehlern an.
      void showSaveError(error, {
        object: "das Speichern des Entwurfs",
        retry: () => latestContinueRef.current(),
        reload: result.reload,
      });
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
                disabledReason="Wähle zuerst eine Klasse aus."
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
            disabled={
              Boolean(validationError) ||
              save.pending ||
              !rows ||
              (existingDraft !== null && !saved.canSubmit)
            }
            tooltip="Speichert den Entwurf und zeigt, welche Kinder wohin wechseln."
            disabledReason={
              save.pending || !rows
                ? undefined
                : (validationError ??
                  (existingDraft !== null && !saved.canSubmit
                    ? saved.status === "loadFailed"
                      ? "Lade zuerst den gespeicherten Entwurf neu."
                      : "Der gespeicherte Entwurf wird geladen."
                    : undefined))
            }
          >
            {save.pending ? "Speichern …" : "Weiter zur Vorschau"}
          </Button>
        </SlideOverFooter>
      </SlideOverContent>
    </SlideOver>
  );
}
