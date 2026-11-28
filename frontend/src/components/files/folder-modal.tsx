"use client";

// Ordner anlegen / bearbeiten (#2596). One name, one visibility. The share
// list only appears for "Ausgewählte Rollen und Personen" — the other two
// modes need nothing else, so nothing else is shown.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { FieldLabel } from "~/components/ui/field-label";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { MultiSelect } from "~/components/ui/multi-select";
import { SegmentedControl } from "~/components/ui/segmented-control";
import {
  filesService,
  FOLDER_VISIBILITY_LABELS,
  type AudienceOptions,
  type FileFolder,
  type FolderVisibility,
} from "~/lib/files-api";
import { useApiFormError } from "~/contexts/ToastContext";
import {
  readStateWaitReason,
  useReadDraftForm,
  useSwrLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { sendUnread, useDraftOn } from "~/lib/swr/read-draft";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { fileKeys } from "~/lib/swr/portal-keys";
import { InsetPanel } from "~/components/ui/inset-panel";

const logger = createLogger({ component: "FolderModal" });

const VISIBILITY_ITEMS = [
  { value: "all_staff", label: "Alle Mitarbeitenden" },
  { value: "admins", label: "Nur Leitung" },
  { value: "selected", label: "Ausgewählt" },
] as const satisfies readonly { value: FolderVisibility; label: string }[];

// Wer den Ordner nach dem Speichern sieht, für den Satz am Knopf (#6643).
const SAVE_AUDIENCE: Record<FolderVisibility, string> = {
  all_staff: "alle Mitarbeitenden",
  admins: "die Leitung",
  selected: "die gewählten Rollen und Personen",
};

const VISIBILITY_HINTS: Record<FolderVisibility, string> = {
  all_staff:
    "Jede Person mit Zugang zu moto an dieser Schule sieht den Ordner.",
  admins: "Nur Konten mit Leitungsrechten sehen den Ordner.",
  selected:
    "Nur die gewählten Rollen und Personen sehen den Ordner. Die Leitung sieht ihn immer.",
};

/** What the form edits: one name, one visibility, the share lists. */
interface FolderDraft {
  readonly name: string;
  readonly visibility: FolderVisibility;
  readonly roleIds: readonly string[];
  readonly accountIds: readonly string[];
}

const EMPTY_DRAFT: FolderDraft = {
  name: "",
  visibility: "all_staff",
  roleIds: [],
  accountIds: [],
};

function folderDraftOf(folder: FileFolder): FolderDraft {
  return {
    name: folder.name,
    visibility: folder.visibility,
    roleIds: folder.roleIds,
    accountIds: folder.accountIds,
  };
}

export function FolderModal({
  isOpen,
  onClose,
  onSaved,
  initial,
  stored,
  reload,
}: {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  /** The folder opened for editing; null creates one. */
  readonly initial: FileFolder | null;
  /** The same folder as the list reads it now. */
  readonly stored: FileFolder | undefined;
  /**
   * Reads the folder again after the server refused an edit of a folder
   * changed meanwhile; rejects on failure (ADR 0311).
   */
  readonly reload: () => Promise<FileFolder | undefined>;
}) {
  const [createDraft, setCreateDraft] = useState<FolderDraft>(EMPTY_DRAFT);
  // An edit rests on the folder as read when the form opened: a newer read
  // refills it only while untouched, and saving sends its version.
  const editing = isOpen && initial !== null;
  const edit = useDraftOn<FileFolder, FolderDraft, string, FileFolder | null>(
    {
      opening: editing ? initial.id : null,
      data: editing ? (stored ?? initial) : undefined,
      reload,
    },
    {
      token: (folder) => folder.version,
      toDraft: folderDraftOf,
      answer: (saved) => saved ?? undefined,
    },
  );
  const draft = editing ? (edit.draft ?? folderDraftOf(initial)) : createDraft;
  const setDraft = editing ? edit.setDraft : setCreateDraft;
  const { name, visibility, roleIds, accountIds } = draft;
  const setName = (next: string) =>
    setDraft((current) => ({ ...current, name: next }));
  const setVisibility = (next: FolderVisibility) =>
    setDraft((current) => ({ ...current, visibility: next }));
  const setRoleIds = (next: string[]) =>
    setDraft((current) => ({ ...current, roleIds: next }));
  const setAccountIds = (next: string[]) =>
    setDraft((current) => ({ ...current, accountIds: next }));
  const save = useFormModalPending(isOpen);
  const saving = save.pending;
  const formRef = useRef<HTMLDivElement>(null);
  const formErrors = useApiFormError(formRef);
  const clearErrors = formErrors.clear;
  const form = useReadDraftForm(
    editing ? edit : null,
    formErrors,
    "der Ordner",
  );
  const latestSaveRef = useRef<() => void>(() => undefined);

  const {
    data: audience,
    error: audienceError,
    mutate: reloadAudience,
  } = useSWRAuth<AudienceOptions>(isOpen ? fileKeys.audience() : null, () =>
    filesService.listAudience(),
  );
  const audienceLoadError = useSwrLoadError(
    audienceError,
    "die Liste der Rollen und Personen",
    () => void reloadAudience(),
  );

  // A new folder starts empty on every opening; an edit starts from the
  // folder (`edit`, above).
  useEffect(() => {
    if (!isOpen) return;
    setCreateDraft(EMPTY_DRAFT);
    clearErrors();
  }, [isOpen, initial, clearErrors]);

  const handleSave = async () => {
    const fields: Record<string, string> = {};
    if (!name.trim()) fields.name = "Bitte gib einen Namen ein.";
    if (
      visibility === "selected" &&
      roleIds.length === 0 &&
      accountIds.length === 0
    ) {
      fields.role_ids = "Bitte wähle eine Rolle oder eine Person.";
    }
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Felder.", fields);
      return;
    }
    // An edit sends nothing before the stored folder is read after a
    // refusal; the shown error stays.
    if (!form.begin()) return;
    await save.run(async (op) => {
      const input = {
        name: name.trim(),
        visibility,
        roleIds: visibility === "selected" ? [...roleIds] : [],
        accountIds: visibility === "selected" ? [...accountIds] : [],
      };
      const result = initial
        ? await edit.submit((version) =>
            filesService.updateFolder(initial.id, input, version),
          )
        : await sendUnread(() => filesService.createFolder(input));
      if (result.ok) {
        onSaved();
        if (op.isCurrent()) onClose();
        return;
      }
      if (result.skipped) return;
      logger.error("folder_save_failed", {
        folder_id: initial?.id,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      if (!op.isCurrent()) return;
      // Changed meanwhile: `reload` shows the stored folder, no retry.
      await formErrors.show(
        result.error,
        result.refused && result.reload
          ? { object: "das Speichern des Ordners", reload: result.reload }
          : {
              object: "das Speichern des Ordners",
              retry: () => latestSaveRef.current(),
            },
      );
    });
  };
  // „Wiederholen“ sendet den Stand, der dann im Formular steht.
  useLayoutEffect(() => {
    latestSaveRef.current = () => void handleSave();
  });

  const audienceHint =
    formErrors.fieldError("role_ids") ?? formErrors.fieldError("account_ids");
  const roleOptions = (audience?.roles ?? []).map((role) => ({
    value: role.id,
    label: role.name,
  }));
  const accountOptions = (audience?.accounts ?? []).map((account) => ({
    value: account.accountId,
    label: `${account.lastName}, ${account.firstName}`,
  }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? "Ordner bearbeiten" : "Neuer Ordner"}
      size="md"
      pending={save}
      error={formErrors.error}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={saving}
            noTooltip="Schließt das Fenster, nichts wird gespeichert."
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void handleSave()}
            disabled={saving || (editing && !edit.canSubmit)}
            disabledReason={
              !saving && editing ? readStateWaitReason(edit.status) : undefined
            }
            tooltip={
              initial
                ? `Speichert den Ordner, ab sofort sichtbar für ${SAVE_AUDIENCE[visibility]}.`
                : `Legt den Ordner an, sichtbar für ${SAVE_AUDIENCE[visibility]}.`
            }
          >
            {saving ? "Wird gespeichert…" : "Speichern"}
          </Button>
        </div>
      }
    >
      <div ref={formRef} className="space-y-5">
        <LoadErrorAlert error={form.loadError} />
        <Input
          id="ordner-name"
          name="name"
          label="Name"
          value={name}
          error={formErrors.fieldError("name")}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Konzeption, Formulare, Notfallpläne"
          maxLength={120}
        />

        <div className="space-y-1.5">
          <FieldLabel>Wer sieht den Ordner?</FieldLabel>
          <SegmentedControl
            variant="joined"
            fullWidth
            items={VISIBILITY_ITEMS}
            value={visibility}
            onChange={setVisibility}
            ariaLabel="Sichtbarkeit des Ordners"
          />
          <p className="text-xs leading-5 text-gray-500">
            {VISIBILITY_HINTS[visibility]}
          </p>
        </div>

        {visibility === "selected" && (
          <InsetPanel padding="md" className="space-y-4">
            <LoadErrorAlert error={audienceLoadError} />
            <div className="space-y-1.5">
              <FieldLabel
                htmlFor="ordner-rollen"
                invalid={Boolean(audienceHint)}
              >
                Rollen
              </FieldLabel>
              <MultiSelect
                id="ordner-rollen"
                value={roleIds}
                options={roleOptions}
                onChange={setRoleIds}
                placeholder="Keine Rolle gewählt"
                unavailableLabel="Keine Rollen vorhanden"
                summaryLabel={(count) => `${count} Rollen`}
                searchable
                selectAll
                searchPlaceholder="Rolle suchen"
                invalid={Boolean(audienceHint)}
                ariaDescribedBy={
                  audienceHint ? "ordner-rollen-hinweis" : undefined
                }
              />
              {audienceHint ? (
                <p
                  id="ordner-rollen-hinweis"
                  className="text-moto-red-strong text-xs"
                >
                  {audienceHint}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="ordner-personen">Personen</FieldLabel>
              <MultiSelect
                id="ordner-personen"
                value={accountIds}
                options={accountOptions}
                onChange={setAccountIds}
                placeholder="Keine Person gewählt"
                unavailableLabel="Keine Personen mit Zugang"
                summaryLabel={(count) => `${count} Personen`}
                searchable
                selectAll
                searchPlaceholder="Person suchen"
              />
            </div>
            <p className="text-xs leading-5 text-gray-500">
              Eine Person sieht den Ordner, wenn sie selbst gewählt ist oder
              eine der gewählten Rollen hat.
            </p>
          </InsetPanel>
        )}

        <p className="text-xs leading-5 text-gray-500">
          Sichtbarkeit: {FOLDER_VISIBILITY_LABELS[visibility]}. Alle Dateien im
          Ordner übernehmen diese Einstellung.
        </p>
      </div>
    </FormModal>
  );
}
