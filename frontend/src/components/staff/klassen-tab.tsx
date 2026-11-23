"use client";

// Klassen-Zuweisung (#1772): welche Schulklassen eine Lehrkraft betreut.
// Die Zuweisung scopt die Klassenansicht in moto schule, deshalb ist
// das Ersetzen des Sets im Backend users:manage (Admin-Write mit Audit).
// Klassen bleiben Freitext (users.students.school_class); die Vorschläge
// kommen aus den vorhandenen Klassen der Kinder.
//
// Bearbeitet wird am Objekt (Bauart 2, Regel 4): „Bearbeiten“ öffnet einen
// Entwurf, Hinzufügen und Entfernen ändern nur den Entwurf, und erst
// „Speichern“ schreibt das ganze Set einmal per PUT (#3112). Vorher schrieb
// jeder Chip-Klick sofort, ohne Abbrechen und ohne Hinweis. Der Entwurf ruht
// auf den gelesenen Klassen (ADR 0311): Speichern sendet deren Stand, hat
// jemand anderes sie inzwischen geändert, zeigt der Reiter die gespeicherten.

import { Plus } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { SuggestInput } from "~/components/ui/suggest-input";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { RemovableChip } from "~/components/ui/removable-chip";
import { useApiFormError } from "~/contexts/ToastContext";
import { bffJson } from "~/lib/bff-fetch";
import {
  useReadDraftForm,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { schoolClassLabel } from "~/lib/school-class-label";
import { fetchSchoolClasses } from "~/lib/student-api";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { studentKeys } from "~/lib/swr/portal-keys";
import { staffAccessKeys } from "~/lib/swr/staff-keys";

const logger = createLogger({ component: "StaffKlassenTab" });

const OBJECT = "die Zuweisung der Schulklassen";
const NO_CLASSES: readonly string[] = [];

/** Die zugewiesenen Klassen und der Stand, auf dem ein Entwurf ruht. */
interface AssignedClasses {
  readonly classes: readonly string[];
  readonly version: string;
}

async function fetchAssignedClasses(staffId: string): Promise<AssignedClasses> {
  const data = await bffJson("tenant", "GET /api/staff/{id}/school-classes", {
    params: { id: staffId },
  });
  return { classes: data.school_classes ?? [], version: data.version };
}

async function saveAssignedClasses(
  staffId: string,
  classes: readonly string[],
  version: string,
): Promise<AssignedClasses> {
  const data = await bffJson("tenant", "PUT /api/staff/{id}/school-classes", {
    params: { id: staffId },
    body: { school_classes: [...classes], expected_version: version },
  });
  return { classes: data.school_classes ?? [], version: data.version };
}

export function KlassenTab({
  staffId,
  canEdit,
}: Readonly<{ staffId: string; canEdit: boolean }>) {
  const assignedRead = useSWRAuth(
    staffAccessKeys.schoolClasses(staffId),
    () => fetchAssignedClasses(staffId),
    { keepPreviousData: false },
  );
  const {
    data: assignedData,
    error: assignedError,
    mutate: mutateAssigned,
  } = assignedRead;
  const assigned = assignedData?.classes ?? null;
  // Vorschläge sind optional: ohne sie funktioniert der Freitext weiterhin.
  const { data: known = NO_CLASSES } = useSWRAuth(
    studentKeys.schoolClasses(),
    fetchSchoolClasses,
  );
  const [editing, setEditing] = useState(false);
  const readRef = useRef(assignedRead);
  useLayoutEffect(() => {
    readRef.current = assignedRead;
  });
  // Der Entwurf des Bearbeiten-Zustands ruht auf den Klassen, die beim
  // Öffnen gelesen waren (ADR 0311): ein neueres Lesen füllt ihn nur nach,
  // solange nichts geändert ist, und Speichern sendet deren Stand.
  const edit = useDraftOn<AssignedClasses, string[], string, AssignedClasses>(
    {
      opening: editing ? staffId : null,
      data: assignedData,
      error: assignedError,
      reload: () => revalidateOrThrow(readRef.current),
      write: (stored) => mutateAssigned(stored, { revalidate: false }),
    },
    {
      token: (read) => read.version,
      toDraft: (read) => [...read.classes],
      answer: (saved) => saved,
    },
  );
  const draft = editing ? (edit.draft ?? null) : null;
  const setDraft = edit.setDraft;
  const [newClass, setNewClass] = useState("");
  const [saving, setSaving] = useState(false);
  // Ladefehler stehen vor Ort, Speicherfehler oben im Bearbeiten-Bereich
  // und am Feld (#2514).
  const { error: loadError } = useSwrResourceLoadError(
    [{ data: assignedData, error: assignedError }],
    OBJECT,
    () => mutateAssigned(),
  );
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  const { clear: clearFormError, show: showFormError } = formErrors;
  const form = useReadDraftForm(edit, formErrors, OBJECT);
  // „Wiederholen“ speichert den aktuellen Entwurf, nicht den vom
  // Fehlerzeitpunkt.
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);

  const startEditing = useCallback(() => {
    if (!assigned) return;
    setEditing(true);
    setNewClass("");
    clearFormError();
  }, [assigned, clearFormError]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setNewClass("");
    clearFormError();
  }, [clearFormError]);

  const addClass = useCallback(() => {
    const value = newClass.trim();
    if (!value || !draft) return;
    setNewClass("");
    const exists = draft.some(
      (klass) => klass.trim().toLowerCase() === value.toLowerCase(),
    );
    if (exists) return;
    setDraft([...draft, value]);
  }, [newClass, draft, setDraft]);

  const removeClass = useCallback(
    (klass: string) => {
      setDraft((current) => current.filter((entry) => entry !== klass));
    },
    [setDraft],
  );

  const { begin: beginSave } = form;
  const { submit } = edit;
  const handleSave = useCallback(async () => {
    if (!draft) return;
    // Nichts geht raus, bevor der gespeicherte Stand gelesen ist; der
    // gezeigte Fehler bleibt dann stehen.
    if (!beginSave()) return;
    setSaving(true);
    try {
      const result = await submit((version, classes) =>
        saveAssignedClasses(staffId, classes, version),
      );
      if (result.ok) {
        setEditing(false);
        setNewClass("");
        return;
      }
      logger.error("staff_school_classes_save_failed", {
        staff_id: staffId,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // Inzwischen geändert: `reload` zeigt die gespeicherten Klassen,
      // ohne „Wiederholen“ (ADR 0311).
      await showFormError(
        result.error,
        result.refused
          ? { object: OBJECT, reload: result.reload }
          : { object: OBJECT, retry: () => void latestSaveRef.current() },
      );
    } finally {
      setSaving(false);
    }
  }, [draft, beginSave, submit, staffId, showFormError]);

  useLayoutEffect(() => {
    latestSaveRef.current = handleSave;
  });

  const suggestions = useMemo(() => {
    const base = draft ?? assigned ?? [];
    const taken = new Set(base.map((klass) => klass.trim().toLowerCase()));
    return known.filter((klass) => !taken.has(klass.trim().toLowerCase()));
  }, [known, draft, assigned]);

  const shown = draft ?? assigned;
  // Geändert gegenüber dem Stand, auf dem der Entwurf ruht.
  const dirty = editing && edit.touched;

  return (
    <SectionCard
      title="Zugewiesene Schulklassen"
      description="Eine Lehrkraft sieht in ihrer Klassenansicht genau die Kinder dieser Klassen – wer nach dem Unterricht in der Betreuung bleibt und wer nach Hause geht. Kontaktdaten der Sorgeberechtigten sind dort nicht sichtbar."
      action={
        canEdit && assigned !== null && !editing ? (
          <Button
            type="button"
            variant="surface"
            size="md"
            onClick={startEditing}
            tooltip="Öffnet die Klassen dieser Person zum Ändern."
          >
            Bearbeiten
          </Button>
        ) : undefined
      }
    >
      {assigned === null ? <LoadErrorAlert error={loadError} /> : null}
      {editing ? <LoadErrorAlert error={form.loadError} /> : null}

      {assigned === null && !loadError ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : null}

      {shown !== null && (
        <div ref={formRef} className="space-y-4">
          {editing && <FormErrorAlert message={formErrors.error} />}

          <div className="flex flex-wrap gap-2">
            {shown.length === 0 && (
              <p className="text-sm text-gray-500">
                Noch keine Klasse zugewiesen.
              </p>
            )}
            {shown.map((klass) =>
              editing ? (
                <RemovableChip
                  key={klass}
                  label={schoolClassLabel(klass)}
                  onRemove={() => removeClass(klass)}
                  removeLabel={`${schoolClassLabel(klass)} entfernen`}
                  disabled={saving}
                />
              ) : (
                <RemovableChip key={klass} label={schoolClassLabel(klass)} />
              ),
            )}
          </div>

          {editing && (
            <>
              <div className="flex items-center gap-2">
                <div className="w-40">
                  <SuggestInput
                    value={newClass}
                    onValueChange={setNewClass}
                    suggestions={suggestions}
                    listLabel="Vorschläge für die Klasse"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addClass();
                      }
                    }}
                    name="school_classes"
                    error={formErrors.fieldError("school_classes")}
                    placeholder="z. B. 1a"
                    aria-label="Klassenname"
                    disabled={saving}
                    controlSize="compact"
                  />
                </div>
                <Button
                  type="button"
                  variant="surface"
                  size="field"
                  onClick={addClass}
                  disabled={saving || newClass.trim() === ""}
                  disabledReason={
                    saving ? undefined : "Gib zuerst einen Klassennamen ein."
                  }
                  tooltip="Nimmt die Klasse auf, gespeichert wird erst mit „Speichern“."
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Hinzufügen
                </Button>
              </div>
              <EditActions
                onCancel={cancelEditing}
                onSave={() => void handleSave()}
                saving={saving}
                disabled={!dirty}
                disabledReason="Du hast noch nichts geändert."
                saveTooltip="Speichert die Klassen, die Person sieht dann deren Kinder."
              />
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}
