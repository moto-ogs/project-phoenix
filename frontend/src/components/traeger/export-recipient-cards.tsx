"use client";

// The recipients of the finance exports of a Träger (#6824, ADR 0218; #6911,
// ADR 0222): which file goes to which recipient, the list of recipients with
// their state, the form of one recipient's access, saved with a password
// that never comes back, and the newest handovers with their outcome.

import { ArrowRightLeft, Inbox, KeyRound, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  HANDOVER_FORMAT_LABELS,
  HANDOVER_STATE_LABELS,
  HANDOVER_STATE_TONES,
  HANDOVER_UNKNOWN_TEXT,
  destinationText,
  exportRecipientPath,
  formatsText,
  handoverReasonText,
  recipientStatus,
} from "~/components/traeger/export-handover-format";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { CustomSelect } from "~/components/ui/custom-select";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EditActions } from "~/components/ui/edit-actions";
import { EmptyState } from "~/components/ui/empty-state";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { IconTile } from "~/components/ui/icon-tile";
import { Input } from "~/components/ui/input";
import { ListRowLink } from "~/components/ui/list-row-link";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { SwitchRow } from "~/components/ui/switch";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatBerlinDate, formatBerlinTime } from "~/lib/date-helpers";
import { readStateWaitReason } from "~/lib/hooks/use-read-state-lock";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  type ExportFormatAssignment,
  type ExportHandover,
  type ExportRecipient,
  type ExportRecipientDraft,
  type ExportRecipientsPage,
  HANDOVER_FORMATS,
  type HandoverFormat,
} from "~/lib/traeger-export-handovers-api";
import { traegerPath } from "~/lib/traeger-url";
import { labelOf } from "~/lib/label-of";

const logger = createLogger({ component: "ExportRecipientCards" });

interface Draft {
  readonly name: string;
  readonly enabled: boolean;
  readonly host: string;
  readonly port: string;
  readonly username: string;
  readonly password: string;
  readonly remoteDirectory: string;
  readonly hostKeyFingerprint: string;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  enabled: true,
  host: "",
  port: "22",
  username: "",
  password: "",
  remoteDirectory: "",
  hostKeyFingerprint: "",
};

function draftOf(recipient: ExportRecipient | null): Draft {
  if (!recipient) return EMPTY_DRAFT;
  return {
    name: recipient.name,
    enabled: recipient.enabled,
    host: recipient.host,
    port: String(recipient.port || 22),
    username: recipient.username,
    password: "",
    remoteDirectory: recipient.remoteDirectory,
    hostKeyFingerprint: recipient.hostKeyFingerprint,
  };
}

/**
 * A stored password goes only to the destination it was entered for: a
 * change of address, port, user or fingerprint needs it again.
 */
function destinationChanged(recipient: ExportRecipient, draft: Draft) {
  return (
    draft.host.trim() !== recipient.host ||
    Number(draft.port) !== recipient.port ||
    draft.username.trim() !== recipient.username ||
    draft.hostKeyFingerprint.trim() !== recipient.hostKeyFingerprint
  );
}

const PASSWORD_AGAIN =
  "Bitte gib das Passwort noch einmal ein. moto schickt es nur an die Adresse, für die du es eingegeben hast.";

/** The card with address and password; notices on the page jump here (#7054). */
export const EXPORT_RECIPIENT_ACCESS_ID = "export-recipient-access";

/**
 * The form of one recipient: its name and its access. Without a recipient
 * it adds a new one; removing is offered only for a saved one.
 */
export function ExportRecipientFormCard({
  recipient,
  reload,
  onSave,
  onDelete,
}: Readonly<{
  recipient: ExportRecipient | null;
  /** Reads the saved recipient again after a refusal; rejects on failure. */
  reload?: () => Promise<ExportRecipient | undefined>;
  /** Saves; `version` is the read state of a saved recipient (ADR 0311). */
  onSave: (
    draft: ExportRecipientDraft,
    version: string,
  ) => Promise<ExportRecipient | void>;
  onDelete?: () => Promise<void>;
}>) {
  const [created, setCreated] = useState<Draft>(EMPTY_DRAFT);
  // A saved recipient is edited on the version it was read with (ADR 0311):
  // a newer read refills only an untouched form, a refused save shows the
  // stored recipient, and nothing goes out until it was read.
  const change = useDraftOn<
    ExportRecipient,
    Draft,
    string,
    ExportRecipient | void
  >(
    {
      opening: recipient ? `export-recipient:${recipient.id}` : null,
      data: recipient ?? undefined,
      reload: () => reload?.() ?? Promise.resolve(undefined),
    },
    {
      token: (read) => read.version,
      toDraft: draftOf,
      answer: (saved) => saved || undefined,
    },
  );
  const draft = recipient ? (change.draft ?? draftOf(recipient)) : created;
  const setDraft = recipient ? change.setDraft : setCreated;
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useApiFormError(formRef);
  const form = useReadDraftForm(
    recipient ? change : null,
    formErrors,
    "den Empfänger",
  );
  const deleteErrors = useApiFormError();
  const { success } = useToast();

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const changed = useMemo(
    () =>
      recipient
        ? change.touched
        : JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT),
    [recipient, change.touched, draft],
  );

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    // Enter submits too: a change goes out only after the stored recipient
    // is read, and the shown error stays until then.
    if (!form.begin()) return;
    const port = Number(draft.port);
    const fields: Record<string, string> = {};
    if (!draft.name.trim())
      fields.name = "Bitte gib dem Empfänger einen Namen.";
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      fields.port = "Bitte gib eine Zahl zwischen 1 und 65535 ein.";
    if (
      recipient?.passwordSet &&
      !draft.password &&
      destinationChanged(recipient, draft)
    )
      fields.password = PASSWORD_AGAIN;
    if (Object.keys(fields).length > 0) {
      formErrors.invalid("Bitte prüfe die markierten Angaben.", fields);
      return;
    }
    const input: ExportRecipientDraft = {
      name: draft.name.trim(),
      enabled: draft.enabled,
      host: draft.host.trim(),
      port,
      username: draft.username.trim(),
      password: draft.password || undefined,
      remoteDirectory: draft.remoteDirectory.trim(),
      hostKeyFingerprint: draft.hostKeyFingerprint.trim(),
    };
    if (recipient) {
      setSaving(true);
      const result = await change.submit((version) => onSave(input, version));
      setSaving(false);
      if (result.ok) {
        success(`${input.name} ist gespeichert.`);
        return;
      }
      logger.error("traeger_export_recipient_save_failed", {
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      // A colleague saved the recipient since: `reload` shows it instead
      // of the draft over it.
      void formErrors.show(result.error, {
        object: "der Empfänger",
        reload: result.reload,
      });
      return;
    }
    setSaving(true);
    try {
      await onSave(input, "");
      success(`${input.name} ist gespeichert.`);
    } catch (err) {
      logger.error("traeger_export_recipient_save_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void formErrors.show(err, { object: "der Empfänger" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onDelete) return;
    setDeleting(true);
    deleteErrors.clear();
    try {
      await onDelete();
      setConfirmDelete(false);
      success(
        `${recipient?.name ?? "Der Empfänger"} ist entfernt. Das Passwort ist gelöscht.`,
      );
    } catch (err) {
      logger.error("traeger_export_recipient_delete_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void deleteErrors.show(err, { object: "der Empfänger" });
    } finally {
      setDeleting(false);
    }
  };

  const passwordHint = recipient?.passwordSet
    ? "Ist gespeichert und wird nicht angezeigt. Nur ausfüllen, um es zu ändern."
    : "moto speichert es verschlüsselt und zeigt es nie wieder an.";
  const formats = recipient?.formats ?? [];
  const deleteDescription =
    formats.length > 0
      ? `moto löscht Adresse, Benutzername und Passwort. ${formatsText(formats)} kannst du danach nur herunterladen, bis du sie einem anderen Empfänger zuordnest. Der Verlauf der Übergaben bleibt.`
      : "moto löscht Adresse, Benutzername und Passwort. Der Empfänger bekommt keine Datei, nichts geht auf den Download zurück. Der Verlauf der Übergaben bleibt.";

  return (
    <SectionCard
      id={EXPORT_RECIPIENT_ACCESS_ID}
      title="Zugang zum Empfänger"
      description="Diese Angaben bekommst du von der Stelle, die die Dateien annimmt, zum Beispiel von deiner Kämmerei."
      icon={KeyRound}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {recipient && onDelete ? (
            <Button
              type="button"
              variant="outline_danger"
              size="md"
              tooltip="Löscht den Empfänger mit Passwort. moto fragt vorher nach."
              onClick={() => setConfirmDelete(true)}
            >
              Empfänger entfernen
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            form="export-recipient-form"
            variant="primary"
            size="md"
            isLoading={saving}
            loadingText="Speichert…"
            disabled={recipient !== null && (!changed || !change.canSubmit)}
            disabledReason={
              changed
                ? readStateWaitReason(change.status)
                : "Du hast noch nichts geändert."
            }
            noTooltip="Ein reines Speichern ohne Folgen."
          >
            {recipient ? "Speichern" : "Empfänger anlegen"}
          </Button>
        </div>
      }
    >
      <form
        ref={formRef}
        id="export-recipient-form"
        noValidate
        className="space-y-5"
        onSubmit={(event) => void submit(event)}
      >
        <FormErrorAlert message={formErrors.error} />
        <LoadErrorAlert error={form.loadError} />
        <Input
          name="name"
          label="Name"
          required
          placeholder="Kämmerei"
          hint="So erscheint der Empfänger bei den Exporten, zum Beispiel „Kämmerei“ oder „Steuerbüro“."
          autoComplete="off"
          value={draft.name}
          error={formErrors.fieldError("name") ?? undefined}
          onChange={(event) => set({ name: event.target.value })}
        />
        <SwitchRow
          label="Übergabe einschalten"
          description="Nur dann übergibt moto Dateien an diesen Empfänger."
          checked={draft.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
        />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Input
            name="host"
            label="Adresse"
            placeholder="dateien.kaemmerei-beispiel.de"
            autoComplete="off"
            spellCheck={false}
            value={draft.host}
            error={formErrors.fieldError("host") ?? undefined}
            onChange={(event) => set({ host: event.target.value })}
          />
          <Input
            name="port"
            label="Port"
            inputMode="numeric"
            hint="Meist 22"
            value={draft.port}
            error={formErrors.fieldError("port") ?? undefined}
            onChange={(event) => set({ port: event.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            name="username"
            label="Benutzername"
            autoComplete="off"
            spellCheck={false}
            value={draft.username}
            error={formErrors.fieldError("username") ?? undefined}
            onChange={(event) => set({ username: event.target.value })}
          />
          <Input
            name="password"
            label="Passwort"
            type="password"
            revealable
            autoComplete="new-password"
            placeholder={recipient?.passwordSet ? "••••••••" : undefined}
            hint={passwordHint}
            value={draft.password}
            error={formErrors.fieldError("password") ?? undefined}
            onChange={(event) => set({ password: event.target.value })}
          />
        </div>
        <Input
          name="remote_directory"
          label="Zielordner"
          placeholder="/eingang/moto"
          hint="Der Ordner muss beim Empfänger schon vorhanden sein."
          spellCheck={false}
          value={draft.remoteDirectory}
          error={formErrors.fieldError("remote_directory") ?? undefined}
          onChange={(event) => set({ remoteDirectory: event.target.value })}
        />
        <Input
          name="host_key_fingerprint"
          label="Fingerabdruck"
          placeholder="SHA256:…"
          hint="Beginnt mit SHA256:. Frage beim Empfänger nach dem Fingerabdruck für den RSA-Schlüssel. Passt er nicht, übergibt moto nichts."
          spellCheck={false}
          className="font-mono"
          value={draft.hostKeyFingerprint}
          error={formErrors.fieldError("host_key_fingerprint") ?? undefined}
          onChange={(event) => set({ hostKeyFingerprint: event.target.value })}
        />
      </form>
      {recipient && onDelete ? (
        <ConfirmDeleteModal
          isOpen={confirmDelete}
          title={`${recipient.name} entfernen?`}
          description={deleteDescription}
          gate={{ mode: "twoStep", firstStepLabel: "Entfernen" }}
          confirmLabel="Ja, entfernen"
          loading={deleting}
          error={deleteErrors.error}
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </SectionCard>
  );
}

/** The value of the select for the download, never a recipient id. */
const DOWNLOAD = "";

const FORMAT_HINTS: Record<HandoverFormat, string> = {
  sollstellung: "Für die Kämmerei oder Kasse",
  datev: "Für das Steuerbüro oder die Buchhaltung",
  pain008: "Für die Bank",
};

function assignmentsOf(page: ExportRecipientsPage) {
  return Object.fromEntries(
    HANDOVER_FORMATS.map((format) => [
      format,
      page.assignments.find((assignment) => assignment.format === format)
        ?.recipientId ?? DOWNLOAD,
    ]),
  ) as Record<HandoverFormat, string>;
}

/**
 * Which file goes to which recipient: one select per format, saved as a
 * whole. A format without a recipient stays a download.
 */
export function ExportFormatAssignmentCard({
  page,
  reload,
  onSave,
}: Readonly<{
  page: ExportRecipientsPage;
  /** Reads the page again after a refused save; rejects on failure. */
  reload: () => Promise<ExportRecipientsPage>;
  /** Saves over `version`, the assignments' read state (ADR 0311). */
  onSave: (
    assignments: readonly ExportFormatAssignment[],
    version: string,
  ) => Promise<ExportRecipientsPage>;
}>) {
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const { success } = useToast();
  // The selects rest on the assignments they were read with (ADR 0311): a
  // newer read refills them only while untouched, a refused save shows the
  // stored assignments, and the save's answer is the new base.
  const assignment = useDraftOn<
    ExportRecipientsPage,
    Record<HandoverFormat, string>,
    string,
    ExportRecipientsPage
  >(
    { opening: "export-formats", data: page, reload },
    {
      token: (read) => read.assignmentsVersion,
      toDraft: assignmentsOf,
      answer: (saved) => saved,
    },
  );
  const draft = assignment.draft ?? assignmentsOf(page);
  const setDraft = assignment.setDraft;
  const changed = assignment.touched;
  const form = useReadDraftForm(assignment, errors, "die Zuordnung");
  const options = [
    { value: DOWNLOAD, label: "Nur herunterladen" },
    ...page.recipients.map((recipient) => ({
      value: recipient.id,
      label: recipient.ready
        ? recipient.name
        : `${recipient.name} (${recipientStatus(recipient).label})`,
    })),
  ];

  const save = async () => {
    if (!form.begin()) return;
    setSaving(true);
    const result = await assignment.submit((version, chosen) =>
      onSave(
        HANDOVER_FORMATS.map((format) => ({
          format,
          recipientId: chosen[format] === DOWNLOAD ? null : chosen[format],
        })),
        version,
      ),
    );
    setSaving(false);
    if (result.ok) {
      success("Die Zuordnung ist gespeichert.");
      return;
    }
    logger.error("traeger_export_formats_save_failed", {
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    // A colleague changed the assignments since: `reload` shows them
    // instead of the choice over them.
    void errors.show(result.error, {
      object: "die Zuordnung",
      reload: result.reload,
    });
  };

  return (
    <SectionCard
      title="Welche Datei geht wohin"
      description="Jede Datei geht an genau einen Empfänger. Ohne Empfänger lädst du sie herunter."
      icon={ArrowRightLeft}
      footer={
        <EditActions
          onCancel={() => assignment.discard()}
          onSave={() => void save()}
          saving={saving}
          disabled={!changed || !assignment.canSubmit}
          disabledReason={
            changed
              ? readStateWaitReason(assignment.status)
              : "Du hast noch nichts geändert."
          }
          cancelDisabled={!changed || saving}
        />
      }
    >
      <FormErrorAlert message={errors.error} />
      <LoadErrorAlert error={form.loadError} />
      <ul className="divide-y divide-gray-100">
        {HANDOVER_FORMATS.map((format) => {
          const chosen = page.recipients.find(
            (recipient) => recipient.id === draft[format],
          );
          return (
            <li
              key={format}
              className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:gap-6"
            >
              <span className="min-w-0">
                <span
                  id={`export-format-${format}`}
                  className="block font-medium text-gray-900"
                >
                  {HANDOVER_FORMAT_LABELS[format]}
                </span>
                <span className="block text-sm text-gray-500">
                  {FORMAT_HINTS[format]}
                </span>
              </span>
              <CustomSelect
                ariaLabelledBy={`export-format-${format}`}
                value={draft[format]}
                options={options}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, [format]: value }))
                }
                hint={
                  chosen && !chosen.ready
                    ? `Bis ${chosen.name} bereit ist, übergibt moto nichts.`
                    : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

/** Every recipient of the Träger with its state and the files it receives. */
export function ExportRecipientListCard({
  recipients,
}: Readonly<{ recipients: readonly ExportRecipient[] }>) {
  return (
    <SectionCard
      title="Empfänger"
      description="Jeder Empfänger hat seinen eigenen Zugang. Öffne einen Empfänger, um ihn zu ändern."
      icon={Inbox}
      flush={recipients.length > 0}
    >
      {recipients.length === 0 ? (
        <EmptyState
          variant="compact"
          title="Noch kein Empfänger."
          description="Füge oben einen Empfänger hinzu, zum Beispiel deine Kämmerei."
        />
      ) : (
        // The flush card is the frame: the rows run to its edge (#7407).
        <ul className="divide-y divide-gray-100">
          {recipients.map((recipient) => {
            const status = recipientStatus(recipient);
            return (
              <li key={recipient.id}>
                <ListRowLink
                  href={traegerPath(exportRecipientPath(recipient.id))}
                  icon={
                    <IconTile
                      icon={<Inbox aria-hidden />}
                      size="sm"
                      className="max-sm:hidden"
                    />
                  }
                  title={recipient.name}
                  subtitle={
                    <>
                      <span className="block">
                        {recipient.host
                          ? destinationText(
                              recipient.host,
                              recipient.remoteDirectory,
                            )
                          : "Noch keine Adresse"}
                      </span>
                      <span className="block text-gray-500">
                        {recipient.formats.length > 0
                          ? `Bekommt: ${formatsText(recipient.formats)}`
                          : "Bekommt noch keine Datei"}
                      </span>
                    </>
                  }
                  badge={
                    <StatusBadge label={status.label} tone={status.tone} />
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function handoverColumns(
  showRecipient: boolean,
): DataTableColumn<ExportHandover>[] {
  return [
    {
      key: "when",
      header: "Zeitpunkt",
      sortValue: (handover) => handover.createdAt,
      render: (handover) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatBerlinDate(handover.createdAt)},{" "}
          {formatBerlinTime(handover.createdAt)} Uhr
        </span>
      ),
      stacked: "meta",
    },
    {
      key: "file",
      header: "Datei",
      render: (handover) => (
        <span className="min-w-0">
          <span className="block font-medium break-words text-gray-900">
            {handover.fileName}
          </span>
          <span className="block text-sm text-gray-500">
            {labelOf(HANDOVER_FORMAT_LABELS, handover.format, "Datei")}
          </span>
        </span>
      ),
      stacked: "title",
    },
    {
      key: "target",
      header: showRecipient ? "Empfänger" : "Ziel",
      render: (handover) => (
        <span className="min-w-0 text-sm text-gray-600">
          {showRecipient && handover.recipientName ? (
            <span className="block font-medium break-words text-gray-900">
              {handover.recipientName}
              {handover.recipientId === null ? (
                <span className="font-normal text-gray-500"> (entfernt)</span>
              ) : null}
            </span>
          ) : null}
          <span className="block break-words">{handover.targetHost}</span>
          {handover.targetDirectory ? (
            <span className="block break-words text-gray-500">
              Ordner {handover.targetDirectory}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "state",
      header: "Ergebnis",
      render: (handover) => (
        <span className="flex min-w-0 flex-col items-start gap-1">
          <StatusBadge
            label={HANDOVER_STATE_LABELS[handover.state]}
            tone={HANDOVER_STATE_TONES[handover.state]}
          />
          {handover.state === "failed" ? (
            <span className="text-sm text-gray-600">
              {handoverReasonText(handover.reason)}
            </span>
          ) : null}
          {handover.state === "unknown" ? (
            <span className="text-sm text-gray-600">
              {HANDOVER_UNKNOWN_TEXT}
            </span>
          ) : null}
        </span>
      ),
    },
  ];
}

/** The newest handovers, every attempt on its own row. */
export function ExportHandoverHistoryCard({
  handovers,
  showRecipient = false,
}: Readonly<{
  handovers: readonly ExportHandover[];
  /** On the list of all recipients each row names its recipient. */
  showRecipient?: boolean;
}>) {
  return (
    <SectionCard
      title="Letzte Übergaben"
      description="Jeder Versuch steht hier, auch wenn die Datei nicht angekommen ist. moto versucht nichts von selbst noch einmal."
      icon={Send}
    >
      <DataTable
        columns={handoverColumns(showRecipient)}
        rows={[...handovers]}
        getRowKey={(handover) => handover.id}
        stackedOnMobile
        emptyState={
          <EmptyState
            title="Noch keine Übergabe."
            description="Übergib eine Datei bei den Exporten. Sie steht dann hier."
          />
        }
      />
    </SectionCard>
  );
}
