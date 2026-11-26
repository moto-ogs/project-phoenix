"use client";

// Elternsprechtag in moto schule (#4801): Die Lehrkraft bietet für eine ihrer
// Klassen einen Tag an, die Eltern buchen in der Eltern-App ein freies
// Zeitfenster je Kind. Hier legt sie den Tag an, ändert oder löscht ihn und
// sieht und druckt, wer wann kommt. Der gewählte Tag steht als
// `?sprechtag=…` in der Adresse, damit der Hinweis zu einer Buchung direkt
// dorthin führt.

import { Suspense, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Plus, Printer } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable } from "~/components/ui/data-table";
import type { DataTableColumn } from "~/components/ui/data-table";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EmptyState } from "~/components/ui/empty-state";
import { FieldErrorHint } from "~/components/ui/field-error-hint";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { useStepFocus } from "~/components/ui/use-step-focus";
import { EditActions } from "~/components/ui/edit-actions";
import {
  SlideOver,
  SlideOverBody,
  SlideOverFooter,
  SlideOverCloseButton,
  SlideOverContent,
  SlideOverHeader,
  SlideOverTitle,
} from "~/components/ui/slide-over";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { berlinTodayISO, formatDate } from "~/lib/date-helpers";
import {
  useReadDraftForm,
  useSwrLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import {
  createSchoolParentConference,
  deleteSchoolParentConference,
  emptyParentConferenceDraft,
  fetchSchoolParentConferences,
  PARENT_CONFERENCE_SLOT_OPTIONS,
  parentConferenceDraftOf,
  parentConferenceFieldErrors,
  parentConferenceRequest,
  parentConferenceWindowLabel,
  updateSchoolParentConference,
  type ParentConference,
  type ParentConferenceDraft,
} from "~/lib/parent-conferences";
import { schoolClassLabel } from "~/lib/school-class-label";
import { NO_OWN_CLASS_REASON } from "~/components/school/no-own-class";
import { schoolPath } from "~/lib/school-url";
import { revalidateOrThrow, useSWRAuth } from "~/lib/swr";
import { useDraftOn } from "~/lib/swr/read-draft";
import { schoolPortalKeys } from "~/lib/swr/portal-keys";
import type * as schoolCalendarContract from "~/lib/contract/school-calendar.generated";

const logger = createLogger({ component: "SchoolParentConferencePage" });

/** Der gewählte Tag in der Adresse. */
const CONFERENCE_PARAM = "sprechtag";

const conferenceColumns: DataTableColumn<ParentConference>[] = [
  {
    key: "date",
    header: "Tag",
    stacked: "title",
    sortValue: (row) => row.date,
    render: (row) => (
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{formatDate(row.date)}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {row.start_time}–{row.end_time} Uhr
          {row.location ? ` · ${row.location}` : ""}
        </p>
      </div>
    ),
  },
  {
    key: "class",
    header: "Klasse",
    render: (row) => (
      <span className="text-sm text-gray-700">
        {schoolClassLabel(row.school_class)}
      </span>
    ),
  },
  {
    key: "booked",
    header: "Gebucht",
    stacked: "meta",
    sortValue: (row) => row.booked_count,
    render: (row) => (
      <span className="text-sm text-gray-700">
        {row.booked_count} von {row.slots.length}
      </span>
    ),
  },
];

const slotColumns: DataTableColumn<schoolCalendarContract.ParentConferenceSlot>[] =
  [
    {
      key: "time",
      header: "Uhrzeit",
      stacked: "title",
      render: (row) => (
        <span className="font-semibold text-gray-900">
          {parentConferenceWindowLabel(row)}
        </span>
      ),
    },
    {
      key: "child",
      header: "Kind",
      stacked: "meta",
      render: (row) =>
        row.booked ? (
          <span className="text-sm text-gray-900">
            {row.student_name ?? "Gebucht"}
          </span>
        ) : (
          <StatusBadge tone="gray" label="Frei" />
        ),
    },
  ];

function SchoolParentConferences() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const selectedId = useSearchParams().get(CONFERENCE_PARAM);
  const toast = useToast();

  const conferencesRead = useSWRAuth(
    session ? schoolPortalKeys.parentConferences() : null,
    fetchSchoolParentConferences,
  );
  const { data, error, isLoading, mutate } = conferencesRead;
  const conferencesReadRef = useRef(conferencesRead);
  useLayoutEffect(() => {
    conferencesReadRef.current = conferencesRead;
  });
  const loadError = useSwrLoadError(error, "Deine Elternsprechtage", () =>
    mutate(),
  );
  const conferences = data?.conferences ?? [];
  const classes = data?.classes ?? [];
  const selected = conferences.find((row) => row.id === selectedId) ?? null;
  // A row click shows the day above the list (#7111): its heading takes the
  // focus, and after a deletion the list heading. The first load is no step.
  const detailFocus = useStepFocus<HTMLDivElement>(
    data ? (selected?.id ?? "list") : null,
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ParentConference | null>(null);
  const [createDraft, setCreateDraft] = useState<ParentConferenceDraft>(() =>
    emptyParentConferenceDraft([]),
  );
  const save = useFormModalPending(formOpen);
  const submitting = save.pending;
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  // Eine Änderung ruht auf dem Tag, wie er beim Öffnen gelesen war, mit
  // seinen Buchungen (ADR 0311): ein neueres Lesen füllt den Entwurf nur
  // nach, solange nichts geändert ist. Hat inzwischen eine Familie gebucht,
  // lehnt der Server ab; das Formular zeigt dann den gespeicherten Tag, und
  // Speichern wartet, bis er gelesen ist.
  const editingId = formOpen && editing ? editing.id : null;
  const edit = useDraftOn<
    ParentConference,
    ParentConferenceDraft,
    string,
    ParentConference
  >(
    {
      opening: editingId,
      data: conferences.find((row) => row.id === editingId),
      error,
      reload: async () => {
        const stored = await revalidateOrThrow(conferencesReadRef.current);
        const day = stored.conferences.find((row) => row.id === editingId);
        if (!day) throw new Error("parent conference is gone");
        return day;
      },
      write: (stored) =>
        mutate(
          (current) =>
            current && {
              ...current,
              conferences: current.conferences.map((row) =>
                row.id === stored.id ? stored : row,
              ),
            },
          { revalidate: false },
        ),
    },
    {
      token: (day) => day.version,
      toDraft: parentConferenceDraftOf,
      answer: (saved) => saved,
    },
  );
  const editForm = useReadDraftForm(
    editingId === null ? null : edit,
    formErrors,
    "den Elternsprechtag",
  );
  const draft =
    editing && editingId !== null
      ? (edit.draft ?? parentConferenceDraftOf(editing))
      : createDraft;
  // A retry submits the form again, so it saves the current draft.
  const conferenceFormRef = useRef<HTMLFormElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<ParentConference | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const deleteErrors = useApiFormError();

  const select = (id: string | null) => {
    const query = id ? `?${CONFERENCE_PARAM}=${encodeURIComponent(id)}` : "";
    router.replace(`${pathname}${query}`, { scroll: false });
  };

  const update = (patch: Partial<ParentConferenceDraft>) => {
    if (editingId === null)
      setCreateDraft((current) => ({ ...current, ...patch }));
    else edit.setDraft((current) => ({ ...current, ...patch }));
  };

  const openCreate = () => {
    formErrors.clear();
    setEditing(null);
    setCreateDraft(emptyParentConferenceDraft(classes));
    setFormOpen(true);
  };

  const openEdit = (conference: ParentConference) => {
    formErrors.clear();
    setEditing(conference);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    formErrors.clear();
  };

  const submit = async () => {
    if (submitting) return;
    const fields = parentConferenceFieldErrors(draft, berlinTodayISO());
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    // Nichts geht raus, bevor der gespeicherte Stand gelesen ist; der
    // gezeigte Fehler bleibt dann stehen.
    if (!editForm.begin()) return;
    if (editing && editingId !== null) {
      await save.run((op) => submitEdit(editing.id, op));
      return;
    }
    await save.run(async (op) => {
      try {
        const request = parentConferenceRequest(draft);
        const saved = await createSchoolParentConference(request);
        await mutate();
        toast.success(
          `Der Elternsprechtag am ${formatDate(saved.date)} ist angelegt. Die Eltern der ${schoolClassLabel(saved.school_class)} können jetzt buchen.`,
        );
        if (!op.isCurrent()) return;
        closeForm();
        select(saved.id);
      } catch (err) {
        logger.error("school_parent_conference_save_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Protokolliert; eine späte Ablehnung zeigt kein neuerer Vorgang.
        if (!op.isCurrent()) return;
        await formErrors.show(err, {
          object: "das Speichern des Elternsprechtags",
          retry: () => conferenceFormRef.current?.requestSubmit(),
        });
      }
    });
  };
  // Ein geänderter Tag geht mit dem Stand raus, auf dem der Entwurf ruht.
  // Seit dem Lesen geändert (eine neue Buchung, eine Änderung in einem
  // anderen Fenster): das Formular zeigt den gespeicherten Tag, ohne
  // „Wiederholen“ (ADR 0311).
  const submitEdit = async (id: string, op: { isCurrent: () => boolean }) => {
    const result = await edit.submit((version, current) =>
      updateSchoolParentConference(
        id,
        parentConferenceRequest(current),
        version,
      ),
    );
    if (result.ok) {
      toast.success(
        `Der Elternsprechtag am ${formatDate(result.saved.date)} ist geändert.`,
      );
      if (op.isCurrent()) {
        closeForm();
        select(result.saved.id);
      }
      await mutate();
      return;
    }
    if (result.skipped) return;
    logger.error("school_parent_conference_save_failed", {
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    if (!op.isCurrent()) return;
    // Not awaited: after a refusal the error path waits for the read of the
    // stored day, and Speichern waits on that read itself (waitReason).
    void formErrors.show(
      result.error,
      result.refused
        ? {
            object: "das Speichern des Elternsprechtags",
            reload: result.reload,
          }
        : {
            object: "das Speichern des Elternsprechtags",
            retry: () => conferenceFormRef.current?.requestSubmit(),
          },
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    deleteErrors.clear();
    setDeleting(true);
    try {
      await deleteSchoolParentConference(deleteTarget.id);
      toast.success(
        `Der Elternsprechtag am ${formatDate(deleteTarget.date)} ist gelöscht.`,
      );
      setDeleteTarget(null);
      select(null);
      await mutate();
    } catch (err) {
      logger.error("school_parent_conference_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await deleteErrors.show(err, {
        object: "das Löschen des Elternsprechtags",
        retry: () => void confirmDelete(),
      });
    } finally {
      setDeleting(false);
    }
  };
  const noClasses = !error && data !== undefined && classes.length === 0;
  const classError = formErrors.fieldError("school_class");
  const breakError = formErrors.fieldError("breaks");

  return (
    <TenantPage
      title="Elternsprechtag"
      back
      backHref={schoolPath("/school/kalender")}
      backLabel="Zurück zum Kalender"
      // Der Ausdruck zeigt nur die Liste eines Tages; der Seitenkopf bleibt weg.
      printHideHeader
      info={
        <p>
          Eltern buchen in der Eltern-App ein Zeitfenster pro Kind. Hier siehst
          du, wer wann kommt.
        </p>
      }
      actions={
        <Button
          type="button"
          variant="primary"
          size="md"
          className="gap-1.5"
          onClick={openCreate}
          disabled={!!error || classes.length === 0}
          disabledReason={noClasses ? NO_OWN_CLASS_REASON : undefined}
          tooltip="Öffnet ein Formular für Zeitfenster, die Eltern dann buchen können."
        >
          <Plus className="h-4 w-4" aria-hidden />
          Neuer Elternsprechtag
        </Button>
      }
      overlays={
        <>
          <SlideOver
            open={formOpen}
            onOpenChange={(open) => {
              if (!open) closeForm();
            }}
            pending={save}
          >
            <SlideOverContent size="md">
              <SlideOverHeader close={<SlideOverCloseButton />}>
                <SlideOverTitle>
                  {editing ? "Elternsprechtag ändern" : "Neuer Elternsprechtag"}
                </SlideOverTitle>
              </SlideOverHeader>
              <form
                ref={conferenceFormRef}
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={handleSubmit}
                noValidate
              >
                <SlideOverBody error={formErrors.error}>
                  <div ref={formRef}>
                    <LoadErrorAlert
                      error={editForm.loadError}
                      className="mb-4"
                    />
                    <div className="space-y-5">
                      <CustomSelect
                        id="parent-conference-class"
                        name="school_class"
                        label="Klasse"
                        value={draft.schoolClass}
                        placeholder="Klasse wählen"
                        onChange={(next) => update({ schoolClass: next })}
                        disabled={submitting}
                        error={classError}
                        options={[
                          ...new Set([
                            ...classes,
                            ...(editing ? [editing.school_class] : []),
                          ]),
                        ].map((schoolClass) => ({
                          value: schoolClass,
                          label: schoolClassLabel(schoolClass),
                        }))}
                      />

                      <ISODatePicker
                        label="Tag"
                        id="parent-conference-date"
                        name="date"
                        controlSize="large"
                        value={draft.date}
                        error={formErrors.fieldError("date")}
                        onChange={(next) => update({ date: next })}
                        disabled={submitting}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Beginn"
                          name="start_time"
                          type="time"
                          value={draft.startTime}
                          error={formErrors.fieldError("start_time")}
                          onChange={(event) =>
                            update({ startTime: event.target.value })
                          }
                          disabled={submitting}
                          required
                        />
                        <Input
                          label="Ende"
                          name="end_time"
                          type="time"
                          value={draft.endTime}
                          error={formErrors.fieldError("end_time")}
                          onChange={(event) =>
                            update({ endTime: event.target.value })
                          }
                          disabled={submitting}
                          required
                        />
                      </div>

                      <CustomSelect
                        id="parent-conference-slot"
                        name="slot_minutes"
                        label="Dauer pro Gespräch"
                        value={draft.slotMinutes}
                        onChange={(next) => update({ slotMinutes: next })}
                        disabled={submitting}
                        options={PARENT_CONFERENCE_SLOT_OPTIONS.map(
                          (minutes) => ({
                            value: minutes,
                            label: `${minutes} Minuten`,
                          }),
                        )}
                      />

                      <fieldset className="space-y-2">
                        <legend className="mb-2 block text-sm font-medium text-gray-700">
                          Pause (freiwillig)
                        </legend>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            label="Von"
                            name="break_start"
                            type="time"
                            value={draft.breakStart}
                            onChange={(event) =>
                              update({ breakStart: event.target.value })
                            }
                            disabled={submitting}
                            aria-describedby={
                              breakError
                                ? "parent-conference-break-error"
                                : undefined
                            }
                          />
                          <Input
                            label="Bis"
                            name="break_end"
                            type="time"
                            value={draft.breakEnd}
                            onChange={(event) =>
                              update({ breakEnd: event.target.value })
                            }
                            disabled={submitting}
                          />
                        </div>
                        <FieldErrorHint
                          id="parent-conference-break-error"
                          message={breakError}
                        />
                      </fieldset>

                      <Input
                        label="Raum (freiwillig)"
                        name="location"
                        value={draft.location}
                        onChange={(event) =>
                          update({ location: event.target.value })
                        }
                        disabled={submitting}
                        maxLength={200}
                      />

                      <p className="text-sm text-gray-600">
                        {editing
                          ? "Die Eltern mit Buchung bekommen eine Nachricht. Fällt ein gebuchtes Zeitfenster weg, ist die Buchung abgesagt."
                          : "Die Eltern der Klasse sehen die freien Zeitfenster in der Eltern-App und buchen eines pro Kind."}
                      </p>
                    </div>
                  </div>
                </SlideOverBody>
                <SlideOverFooter>
                  <EditActions
                    onCancel={closeForm}
                    saving={submitting}
                    disabled={editForm.waitReason !== undefined}
                    disabledReason={editForm.waitReason}
                    saveLabel="Speichern"
                    savingLabel="Wird gespeichert…"
                  />
                </SlideOverFooter>
              </form>
            </SlideOverContent>
          </SlideOver>

          <ConfirmDeleteModal
            isOpen={deleteTarget !== null}
            title="Elternsprechtag löschen"
            description={
              <p className="text-gray-700">
                Der Elternsprechtag wird gelöscht. Alle Buchungen sind dann
                abgesagt, und die Eltern bekommen eine Nachricht.
              </p>
            }
            gate={{ mode: "twoStep", firstStepLabel: "Löschen" }}
            confirmLabel="Endgültig löschen"
            onConfirm={() => void confirmDelete()}
            onClose={() => {
              if (!deleting) {
                setDeleteTarget(null);
                deleteErrors.clear();
              }
            }}
            loading={deleting}
            error={deleteErrors.error}
          />
        </>
      }
    >
      {noClasses ? (
        <p className="text-sm text-gray-600 print:hidden">
          Dir ist keine Klasse zugeordnet. Bitte frage die OGS-Leitung.
        </p>
      ) : null}

      {selected ? (
        <div ref={detailFocus}>
          <SectionCard
            title={`Elternsprechtag ${schoolClassLabel(selected.school_class)} am ${formatDate(selected.date)}`}
            description={`${selected.start_time}–${selected.end_time} Uhr${selected.location ? ` · ${selected.location}` : ""} · ${selected.booked_count} von ${selected.slots.length} Zeitfenstern gebucht`}
            action={
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="gap-1.5"
                  onClick={() => window.print()}
                  tooltip="Öffnet das Druckfenster für die Liste der Zeitfenster."
                >
                  <Printer className="h-4 w-4" aria-hidden />
                  Drucken
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => openEdit(selected)}
                  tooltip="Öffnet den Elternsprechtag zum Ändern."
                >
                  Ändern
                </Button>
                <Button
                  type="button"
                  variant="outline_danger"
                  size="md"
                  onClick={() => {
                    deleteErrors.clear();
                    setDeleteTarget(selected);
                  }}
                  tooltip="Löscht den Tag und sagt alle Buchungen ab. moto fragt vorher nach."
                >
                  Löschen
                </Button>
              </div>
            }
          >
            <DataTable
              columns={slotColumns}
              rows={[...selected.slots]}
              getRowKey={(row) => row.start_time}
            />
            <p className="mt-4 text-sm text-gray-600 print:hidden">
              Eltern buchen, verschieben oder sagen ab, bis 24 Stunden vor dem
              Termin. Danach melden sie sich bei dir.
            </p>
          </SectionCard>
        </div>
      ) : null}

      <div ref={selected ? undefined : detailFocus}>
        <SectionCard title="Meine Elternsprechtage" className="print:hidden">
          {error && loadError ? (
            <LoadErrorAlert error={loadError} />
          ) : (
            <DataTable
              columns={conferenceColumns}
              rows={[...conferences]}
              getRowKey={(row) => row.id}
              isLoading={isLoading && !data}
              defaultSortKey="date"
              defaultSortDirection="asc"
              onRowClick={(row) => select(row.id)}
              emptyState={
                <EmptyState
                  title="Noch kein Elternsprechtag"
                  description="Lege einen Tag an. Dann buchen die Eltern deiner Klasse ein Zeitfenster."
                />
              }
            />
          )}
        </SectionCard>
      </div>
    </TenantPage>
  );
}

export default function SchoolParentConferencePage() {
  return (
    // Der gewählte Tag steht in der Adresse; useSearchParams braucht eine
    // Suspense-Grenze.
    <Suspense fallback={<TenantPage title="Elternsprechtag" loading />}>
      <SchoolParentConferences />
    </Suspense>
  );
}
