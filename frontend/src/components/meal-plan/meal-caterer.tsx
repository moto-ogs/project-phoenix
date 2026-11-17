"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FormModal } from "~/components/ui/form-modal";
import { useFormModalPending } from "~/components/ui/use-form-modal-pending";
import { Input } from "~/components/ui/input";
import { ConfirmationModal } from "~/components/ui/modal";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusBadge } from "~/components/ui/status-badge";
import {
  useApiErrorDisplay,
  useApiFormError,
  useToast,
} from "~/contexts/ToastContext";
import { formatBerlinDate } from "~/lib/date-helpers";
import {
  invitationMailNote,
  mailStatusCopy,
} from "~/lib/email-delivery-status";
import { isAccessRefusal } from "~/lib/access-refusal";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { useConfirmedSWR } from "~/lib/hooks/use-confirmed-resource";
import { useSWRRequestGuard } from "~/lib/swr/hooks";
import { tenantContactKeys } from "~/lib/swr/tenant-contact-keys";
import {
  endMealCatererSupply,
  getMealCaterer,
  inviteMealCaterer,
  revokeMealCatererInvitation,
  type MealCaterer as MealCatererState,
  type MealCatererInvitation,
} from "~/lib/meal-caterer-api";

const EMPTY_FORM = { email: "", catererName: "", deliveryAddress: "" };

/** What the school learns about an invitation's mail and does next (#5960). */
function catererMailNote(invitation: MealCatererInvitation): string | null {
  return invitationMailNote(
    invitation,
    "Stimmt die Adresse nicht, widerrufen Sie die Einladung und laden Sie neu ein.",
  );
}

/**
 * Der Caterer der Schule (ADR 0077): wer liefert, eine Einladung per E-Mail
 * und das Ende der Belieferung. Der Link der Einladung geht nur an den
 * Caterer; die Schule sieht ihn nie.
 */
interface MealCatererProps {
  /** Einladen, Zurücknehmen und Beenden dürfen nur Admins der Schule. */
  canManageSupply: boolean;
}

export function MealCaterer({ canManageSupply }: MealCatererProps) {
  const {
    data,
    failure: error,
    mutate,
    refused: accessRefused,
    readCallbacks,
  } = useConfirmedSWR(tenantContactKeys.mealCaterer(), getMealCaterer);
  const state: MealCatererState | null = data ?? null;
  const loading = data === null && !error;
  const [refusedAfterWrite, setRefusedAfterWrite] = useState(false);
  const loadErrors = useSwrResourceLoadError(
    [{ data: data ?? undefined, error: refusedAfterWrite ? undefined : error }],
    "der Caterer",
    () => mutate(),
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [inviteOpen, setInviteOpen] = useState(false);
  const save = useFormModalPending(inviteOpen);
  const sending = save.pending;
  const [revokeTarget, setRevokeTarget] =
    useState<MealCatererInvitation | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const formErrors = useApiFormError(formRef);
  const { show: showActionError } = useApiErrorDisplay();
  const toast = useToast();

  // Rejects on failure: after a write the caller shows it as a reload of a
  // saved change and keeps the shown caterer (#6652). A mutation drops an
  // answer to a request that started before it.
  useEffect(() => {
    if (!accessRefused) return;
    setForm(EMPTY_FORM);
    setInviteOpen(false);
    setRevokeTarget(null);
    setEndOpen(false);
  }, [accessRefused]);
  const beginRead = useSWRRequestGuard();
  const readCaterer = useCallback(async () => {
    const complete = beginRead(tenantContactKeys.mealCaterer());
    try {
      const next = await mutate(getMealCaterer(), { revalidate: false });
      if (next !== undefined)
        complete(() => {
          readCallbacks.onSuccess();
          setRefusedAfterWrite(false);
        });
    } catch (cause) {
      if (isAccessRefusal(cause))
        complete(() => {
          setRefusedAfterWrite(true);
          readCallbacks.onError(cause);
        });
      throw cause;
    }
  }, [beginRead, mutate, readCallbacks]);
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige des Caterers",
    readCaterer,
  );

  function openInvite() {
    setForm(EMPTY_FORM);
    formErrors.clear();
    setInviteOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !form.email.trim() || !form.catererName.trim()) return;
    await save.run(async (op) => {
      formErrors.clear();
      try {
        await inviteMealCaterer(form);
      } catch (cause) {
        if (!op.isCurrent()) return;
        void formErrors.show(cause, { object: "die Einladung" });
        return;
      }
      toast.success(`Die Einladung ist unterwegs an ${form.email.trim()}.`);
      if (op.isCurrent()) {
        setInviteOpen(false);
        setForm(EMPTY_FORM);
      }
      await afterWrite.refresh();
    });
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setWorking(true);
    try {
      await revokeMealCatererInvitation(revokeTarget.id);
    } catch (cause) {
      void showActionError(cause, { object: "die Einladung" });
      setWorking(false);
      return;
    }
    setWorking(false);
    setRevokeTarget(null);
    toast.success("Die Einladung ist widerrufen.");
    await afterWrite.refresh();
  }

  async function confirmEnd() {
    setWorking(true);
    try {
      await endMealCatererSupply();
    } catch (cause) {
      void showActionError(cause, { object: "das Ende der Belieferung" });
      setWorking(false);
      return;
    }
    setWorking(false);
    setEndOpen(false);
    toast.success("Die Belieferung ist beendet.");
    await afterWrite.refresh();
  }

  if (accessRefused) {
    return (
      <SectionCard
        title="Caterer"
        loading={!loadErrors.error && !afterWrite.error}
      >
        <LoadErrorAlert error={loadErrors.error ?? afterWrite.error} />
      </SectionCard>
    );
  }

  const openInvitations =
    state?.invitations.filter((invitation) => invitation.status === "open") ??
    [];
  const supply = state?.supply ?? null;

  const invitationColumns: DataTableColumn<MealCatererInvitation>[] = [
    {
      key: "caterer",
      header: "Caterer",
      stacked: "title",
      render: (invitation) => invitation.catererName,
    },
    {
      key: "email",
      header: "E-Mail-Adresse",
      // A long address with its status does not fit beside the name on a
      // phone; as a labelled line it keeps both readable.
      stacked: "field",
      render: (invitation) => {
        const mailCopy = mailStatusCopy(
          invitation.mailOutcome,
          invitation.addressMark,
          false,
          invitation.providerBlock,
        );
        const mailNote = catererMailNote(invitation);
        return (
          <>
            <span className="block wrap-anywhere">{invitation.email}</span>
            {mailCopy && (
              <span className="mt-1 block">
                <StatusBadge
                  label={mailCopy.label}
                  tone={mailCopy.tone}
                  compact
                />
              </span>
            )}
            {/* The phone rows have no sub-row, so the note stands here. */}
            {mailNote && (
              <span className="mt-1 block text-xs text-gray-600 md:hidden">
                {mailNote}
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "expires",
      header: "Gültig bis",
      stacked: "field",
      render: (invitation) => formatBerlinDate(invitation.expiresAt),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (invitation) => (
        <OverflowMenu
          ariaLabel={`Aktionen für die Einladung an ${invitation.email}`}
          items={[
            {
              label: "Widerrufen",
              description:
                "Macht den Link in der E-Mail ungültig. moto fragt vorher nach",
              destructive: true,
              onClick: () => setRevokeTarget(invitation),
            },
          ]}
        />
      ),
    },
  ];

  // Kopfaktion je Zustand: ohne Caterer das Einladen (Bauart 2 Regel 4),
  // mit Caterer das seltene Beenden im Menü des Kartenkopfs.
  let headerActions: React.ReactNode;
  if (canManageSupply && !loading && !loadErrors.error) {
    headerActions = supply ? (
      <OverflowMenu
        ariaLabel="Weitere Aktionen"
        items={[
          {
            label: "Belieferung beenden",
            description:
              "Beendet die Belieferung, der Caterer sieht nichts mehr. moto fragt vorher nach",
            destructive: true,
            onClick: () => setEndOpen(true),
          },
        ]}
      />
    ) : (
      <Button
        type="button"
        variant="primary"
        size="md"
        className="gap-2"
        onClick={openInvite}
        tooltip="Öffnet ein Formular, um Ihren Caterer per E-Mail einzuladen."
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Caterer einladen
      </Button>
    );
  }

  return (
    <SectionCard
      title="Caterer"
      description="Ihr Caterer sieht die Bestellungen der Schule in seinem eigenen Zugang bei moto. Namen der Kinder sieht er nur, wenn Sie das in den Einstellungen einschalten."
      actions={headerActions}
    >
      <LoadErrorAlert error={afterWrite.error} className="mb-4" />
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : loadErrors.error ? (
        <LoadErrorAlert error={loadErrors.error} />
      ) : supply ? (
        <DataGrid>
          <DataField label="Caterer">{supply.catererName || "–"}</DataField>
          <DataField label="Beliefert seit">
            {formatBerlinDate(supply.startedAt)}
          </DataField>
          <DataField label="Lieferadresse" fullWidth>
            {supply.deliveryAddress || "–"}
          </DataField>
        </DataGrid>
      ) : !canManageSupply ? (
        <p className="text-sm text-gray-700">
          Noch kein Caterer. Einen Caterer einladen können nur Admins Ihrer
          Schule.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Noch kein Caterer. Laden Sie Ihren Caterer per E-Mail ein.
          </p>

          {openInvitations.length > 0 ? (
            <DataTable
              heading={{
                title: "Offene Einladungen",
                count: openInvitations.length,
              }}
              columns={invitationColumns}
              rows={openInvitations}
              getRowKey={(invitation) => invitation.id}
              rowHasInteractiveControls
              stackedOnMobile
              renderSubRows={(invitation) => {
                const mailNote = catererMailNote(invitation);
                return mailNote
                  ? [{ key: `${invitation.id}-mail-note`, content: mailNote }]
                  : [];
              }}
            />
          ) : null}
        </div>
      )}

      <FormModal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Caterer einladen"
        size="md"
        pending={save}
        isBackdropDismissDisabled
        error={formErrors.error}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => setInviteOpen(false)}
              disabled={sending}
              noTooltip="Schließt das Fenster, ohne eine Einladung zu senden."
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="primary"
              size="md"
              isLoading={sending}
              loadingText="Wird gesendet …"
              disabled={
                sending ||
                form.email.trim() === "" ||
                form.catererName.trim() === ""
              }
              tooltip="Schickt dem Caterer sofort eine E-Mail mit dem Link zu seinem Zugang."
              disabledReason="Geben Sie zuerst Name und E-Mail-Adresse des Caterers ein."
            >
              Einladung senden
            </Button>
          </div>
        }
      >
        <form
          id={formId}
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <p className="text-sm text-gray-600">
            Ihr Caterer bekommt eine E-Mail mit einem Link. Damit legt er sein
            Passwort fest.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Name des Caterers"
              name="caterer_name"
              value={form.catererName}
              onChange={(event) =>
                setForm({ ...form, catererName: event.target.value })
              }
              error={formErrors.fieldError("caterer_name")}
              disabled={sending}
              required
            />
            <Input
              label="E-Mail-Adresse des Caterers"
              name="email"
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              error={formErrors.fieldError("email")}
              disabled={sending}
              required
            />
            <div className="sm:col-span-2">
              <Input
                label="Lieferadresse (optional)"
                name="delivery_address"
                value={form.deliveryAddress}
                onChange={(event) =>
                  setForm({ ...form, deliveryAddress: event.target.value })
                }
                error={formErrors.fieldError("delivery_address")}
                disabled={sending}
              />
            </div>
          </div>
        </form>
      </FormModal>

      <ConfirmationModal
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void confirmRevoke()}
        title="Einladung widerrufen?"
        confirmText="Widerrufen"
        confirmTooltip="Macht den Link in der Einladung sofort ungültig."
        cancelText="Abbrechen"
        confirmVariant="danger"
        isConfirmLoading={working}
        loadingText="Wird widerrufen …"
      >
        <p className="text-sm text-gray-600">
          Der Link in der E-Mail an {revokeTarget?.email} gilt dann nicht mehr.
        </p>
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={endOpen}
        onClose={() => setEndOpen(false)}
        onConfirm={() => void confirmEnd()}
        title="Belieferung beenden"
        confirmText="Beenden"
        confirmTooltip="Beendet die Belieferung sofort, der Caterer sieht nichts mehr."
        cancelText="Abbrechen"
        confirmVariant="danger"
        isConfirmLoading={working}
        loadingText="Wird beendet …"
      >
        <p className="text-sm text-gray-600">
          {supply?.catererName || "Der Caterer"} sieht die Bestellungen der
          Schule danach nicht mehr. Für einen neuen Caterer senden Sie danach
          eine neue Einladung.
        </p>
      </ConfirmationModal>
    </SectionCard>
  );
}
