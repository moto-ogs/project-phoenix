"use client";

// Kostenträger des Trägers (#5627): Stellen, die den Ferienbeitrag einer
// Familie übernehmen, zum Beispiel das Jugendamt bei Leistungsbezug. Das
// Träger-Büro wählt einen aktiven Kostenträger beim Bestätigen einer
// Anmeldung. Ein Kostenträger, den ein Beitrag oder eine Rechnung nennt,
// lässt sich nur ausschalten, nicht löschen.
//
// Anlegen und Bearbeiten laufen im selben Dialog (#7407): eine
// Bearbeitungsart je Karte. Ein Kostenträger ist ein kleiner Listeneintrag
// mit drei Feldern und ohne eigene Seite; eine Objektseite brächte nur einen
// Seitenwechsel für drei Felder. Das Issue erlaubt solche Einträge im Dialog.

import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import { FormModal } from "~/components/ui/form-modal";
import {
  useFormModalPending,
  type FormModalPending,
} from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { Textarea } from "~/components/ui/textarea";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import {
  useRefreshAfterWrite,
  type RefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { type ReadDraftResult, useDraftOn } from "~/lib/swr/read-draft";
import {
  type CostBearer,
  type CostBearerInput,
  deleteCostBearer,
  saveCostBearer,
} from "~/lib/traeger-contributions-api";

const logger = createLogger({ component: "CostBearersCard" });

const EMPTY: CostBearerInput = {
  name: "",
  address: "",
  fileReference: "",
  active: true,
};

type FormErrors = ReturnType<typeof useApiFormError>;
type CostBearerSaveResult = "saved" | "late" | "failed";
/** Sends a change on the version it was read at (`useDraftOn`'s submit). */
type CostBearerChange = (
  send: (version: string) => Promise<CostBearer>,
) => Promise<ReadDraftResult<CostBearer>>;

/**
 * Saves a cost bearer from a draft: a new one for a null id. The name is
 * required; the backend checks the rest. Resolves to "saved", to "late"
 * when the write succeeded after its form was closed or reopened (refresh
 * the list, close nothing, #6533), or to "failed".
 */
function useCostBearerSave(
  formRef: RefObject<HTMLFormElement | null>,
  isOpen = true,
): readonly [
  (
    id: string | null,
    draft: CostBearerInput,
    change?: CostBearerChange,
  ) => Promise<CostBearerSaveResult>,
  FormModalPending,
  FormErrors,
] {
  const pending = useFormModalPending(isOpen);
  const formErrors = useApiFormError(formRef);
  const { success } = useToast();
  const save = async (
    id: string | null,
    draft: CostBearerInput,
    change?: CostBearerChange,
  ) => {
    formErrors.clear();
    if (!draft.name.trim()) {
      formErrors.invalid("Bitte prüfe deine Angaben.", {
        name: "Bitte gib den Namen ein.",
      });
      return "failed";
    }
    const result = await pending.run<CostBearerSaveResult>(async (op) => {
      const outcome: ReadDraftResult<CostBearer> =
        id && change
          ? await change((version) => saveCostBearer(id, draft, version))
          : await saveCostBearer(id, draft).then(
              (saved) => ({ ok: true, saved }) as const,
              (error: unknown) => ({ ok: false, error, refused: false }),
            );
      if (outcome.ok) {
        success("Der Kostenträger ist gespeichert.");
        return op.isCurrent() ? "saved" : "late";
      }
      logger.error("cost_bearer_save_failed", {
        error:
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error),
      });
      if (op.isCurrent()) {
        // A refused change shows the cost bearer as stored now, without a
        // retry (ADR 0311).
        void formErrors.show(outcome.error, {
          object: "der Kostenträger",
          reload: outcome.reload,
        });
      }
      return "failed";
    });
    return result ?? "failed";
  };
  return [save, pending, formErrors] as const;
}

/** The fields of a cost bearer, in the dialog and in the row. */
function CostBearerFields({
  idPrefix,
  draft,
  formErrors,
  onChange,
}: Readonly<{
  idPrefix: string;
  draft: CostBearerInput;
  formErrors: FormErrors;
  onChange: (patch: Partial<CostBearerInput>) => void;
}>) {
  return (
    <>
      <Input
        controlSize="compact"
        id={`${idPrefix}-name`}
        name="name"
        label="Name"
        required
        placeholder="Fachdienst Jugend des Landkreises"
        maxLength={200}
        value={draft.name}
        error={formErrors.fieldError("name") ?? undefined}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <Textarea
        id={`${idPrefix}-address`}
        name="address"
        label="Anschrift (freiwillig)"
        maxLength={500}
        value={draft.address}
        error={formErrors.fieldError("address") ?? undefined}
        onChange={(event) => onChange({ address: event.target.value })}
      />
      <Input
        controlSize="compact"
        id={`${idPrefix}-file-reference`}
        name="file_reference"
        label="Dein Aktenzeichen beim Kostenträger (freiwillig)"
        maxLength={100}
        value={draft.fileReference}
        error={formErrors.fieldError("file_reference") ?? undefined}
        onChange={(event) => onChange({ fileReference: event.target.value })}
      />
    </>
  );
}

/** Adds a new cost bearer, or changes one (`bearer`). */
function CostBearerModal({
  isOpen,
  bearer,
  bearers,
  reload,
  onClose,
  onSaved,
}: Readonly<{
  isOpen: boolean;
  /** The cost bearer to change; null adds a new one. */
  bearer: CostBearer | null;
  /** The stored cost bearers as the card shows them. */
  bearers: readonly CostBearer[];
  /** Reads the cost bearers again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<readonly CostBearer[]>;
  onClose: () => void;
  onSaved: RefreshAfterWrite;
}>) {
  const [created, setCreated] = useState<CostBearerInput>(EMPTY);
  const formRef = useRef<HTMLFormElement>(null);
  const [save, pending, formErrors] = useCostBearerSave(formRef, isOpen);
  const saving = pending.pending;
  const { clear: clearErrors } = formErrors;

  useEffect(() => {
    if (!isOpen) return;
    setCreated(EMPTY);
    clearErrors();
  }, [isOpen, clearErrors]);

  // A change rests on the cost bearer as it was read (ADR 0311): a newer
  // read refills the form only while untouched, the save sends its
  // version, and after a refusal the stored cost bearer shows.
  const changedId = isOpen && bearer ? bearer.id : null;
  const stored = useDraftOn<CostBearer, CostBearerInput, string, CostBearer>(
    {
      opening: changedId,
      data: bearers.find((entry) => entry.id === changedId),
      reload: async () => {
        const found = (await reload()).find((entry) => entry.id === changedId);
        if (!found) throw new Error("cost bearer is gone");
        return found;
      },
    },
    {
      token: (entry) => entry.version,
      toDraft: ({ name, address, fileReference, active }) => ({
        name,
        address,
        fileReference,
        active,
      }),
      answer: (saved) => saved,
    },
  );
  const draft = changedId ? (stored.draft ?? EMPTY) : created;
  const setDraft = (patch: Partial<CostBearerInput>) =>
    changedId
      ? stored.setDraft((current) => ({ ...current, ...patch }))
      : setCreated((current) => ({ ...current, ...patch }));

  const submit = async () => {
    if (changedId && !stored.canSubmit) return;
    const result = await save(bearer?.id ?? null, draft, stored.submit);
    if (result === "failed") return;
    if (result === "saved") onClose();
    await onSaved();
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      pending={pending}
      isBackdropDismissDisabled
      title={bearer ? "Kostenträger ändern" : "Kostenträger hinzufügen"}
      size="md"
      error={formErrors.error}
      footer={
        <EditActions
          onCancel={onClose}
          onSave={() => formRef.current?.requestSubmit()}
          saving={saving}
        />
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CostBearerFields
          idPrefix={bearer ? `cost-bearer-${bearer.id}` : "cost-bearer"}
          draft={draft}
          formErrors={formErrors}
          onChange={setDraft}
        />
        <p className="text-sm text-gray-600">
          Name, Anschrift und Aktenzeichen stehen auf der Liste für die
          Erstattung.
        </p>
      </form>
    </FormModal>
  );
}

export function CostBearersCard({
  bearers,
  onChanged,
  reload,
}: Readonly<{
  bearers: readonly CostBearer[];
  onChanged: () => Promise<unknown>;
  /** Reads the cost bearers again; rejects when the read fails (ADR 0311). */
  reload: () => Promise<readonly CostBearer[]>;
}>) {
  // The dialog: null closed, "new" adds one, a cost bearer changes it.
  const [editing, setEditing] = useState<CostBearer | "new" | null>(null);
  const [deleting, setDeleting] = useState<CostBearer | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteErrors = useApiFormError();
  const { show: showActionError } = useApiErrorDisplay();
  const { success } = useToast();
  // A write's reload stands above the list as a load error, never as an
  // error of the write or its closed dialog (#6652).
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige der Kostenträger",
    onChanged,
  );

  const switchActive = async (bearer: CostBearer) => {
    try {
      // The switch acts on the cost bearer as the row shows it (ADR 0311).
      await saveCostBearer(
        bearer.id,
        { ...bearer, active: !bearer.active },
        bearer.version,
      );
    } catch (err) {
      logger.error("cost_bearer_switch_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await showActionError(err, {
        object: "die Änderung des Kostenträgers",
        reload,
      });
      return;
    }
    success(
      bearer.active
        ? "Der Kostenträger ist ausgeschaltet."
        : "Der Kostenträger ist eingeschaltet.",
    );
    await afterWrite.refresh();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    deleteErrors.clear();
    try {
      await deleteCostBearer(deleting.id);
    } catch (err) {
      logger.error("cost_bearer_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "das Löschen des Kostenträgers" });
      setBusy(false);
      return;
    }
    setBusy(false);
    success("Der Kostenträger ist gelöscht.");
    setDeleting(null);
    await afterWrite.refresh();
  };

  return (
    <SectionCard
      title="Kostenträger"
      description="Stellen, die den Beitrag für eine Familie bezahlen, zum Beispiel das Jugendamt. Du wählst den Kostenträger beim Bestätigen der Anmeldung. Wurde er schon gewählt, kannst du ihn nur ausschalten."
      actions={
        <Button
          type="button"
          variant="outline"
          size="md"
          tooltip="Öffnet ein Fenster für einen neuen Kostenträger."
          onClick={() => setEditing("new")}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Kostenträger hinzufügen
        </Button>
      }
    >
      <LoadErrorAlert error={afterWrite.error} className="mb-4" />
      {bearers.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" aria-hidden="true" />}
          title="Kein Kostenträger. Beim Bestätigen bezahlt die Familie oder ist befreit."
        />
      ) : (
        <ResponsiveActionList>
          {bearers.map((bearer) => (
            <ResponsiveActionRow key={bearer.id} align="start">
              <div className="min-w-0 space-y-0.5 text-sm text-gray-700">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold wrap-anywhere text-gray-900">
                    {bearer.name}
                  </span>
                  {bearer.active ? null : (
                    <StatusBadge tone="gray" label="Ausgeschaltet" />
                  )}
                </p>
                {bearer.address ? (
                  <p className="wrap-anywhere whitespace-pre-line">
                    {bearer.address}
                  </p>
                ) : null}
                {bearer.fileReference ? (
                  <p className="wrap-anywhere">
                    Aktenzeichen: {bearer.fileReference}
                  </p>
                ) : null}
              </div>
              <ResponsiveRowActions
                menu={
                  <OverflowMenu
                    ariaLabel={`Aktionen für ${bearer.name}`}
                    items={[
                      {
                        icon: <Pencil className="size-4" aria-hidden />,
                        label: "Bearbeiten",
                        description:
                          "Öffnet die Angaben in einem Fenster zum Ändern.",
                        onClick: () => setEditing(bearer),
                      },
                      {
                        label: bearer.active ? "Ausschalten" : "Einschalten",
                        description: bearer.active
                          ? "Nimmt den Kostenträger sofort aus der Auswahl beim Bestätigen von Anmeldungen."
                          : "Bietet den Kostenträger sofort wieder beim Bestätigen von Anmeldungen an.",
                        onClick: () => void switchActive(bearer),
                      },
                      ...(bearer.inUse
                        ? []
                        : [
                            {
                              label: "Löschen",
                              description:
                                "Löscht den Kostenträger. moto fragt vorher nach.",
                              icon: <Trash2 className="size-4" aria-hidden />,
                              destructive: true,
                              onClick: () => setDeleting(bearer),
                            },
                          ]),
                    ]}
                  />
                }
              />
            </ResponsiveActionRow>
          ))}
        </ResponsiveActionList>
      )}
      <CostBearerModal
        isOpen={editing !== null}
        bearer={editing === "new" ? null : editing}
        bearers={bearers}
        reload={reload}
        onClose={() => setEditing(null)}
        onSaved={afterWrite.refresh}
      />
      <ConfirmDeleteModal
        isOpen={deleting !== null}
        onClose={() => {
          setDeleting(null);
          deleteErrors.clear();
        }}
        onConfirm={() => void remove()}
        title="Kostenträger löschen?"
        description="Er steht danach nicht mehr zur Wahl."
        confirmLabel="Löschen"
        loadingLabel="Wird gelöscht …"
        gate={{ mode: "twoStep", firstStepLabel: "Ja, löschen" }}
        loading={busy}
        error={deleteErrors.error}
      />
    </SectionCard>
  );
}
