"use client";

// Personen des Träger-Büros (#4650): wer im Träger-Portal arbeitet, mit
// Namen (#4693) und Rolle, wer eingeladen ist und der Verlauf der Änderungen
// (#5474).
// Nur mit dem Recht „Konten verwalten“ (Rolle Leitung, #5471).

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Pencil, Trash2, Undo2, UserPen, UserPlus, Users } from "lucide-react";
import {
  ChangeTraegerMemberNameModal,
  ChangeTraegerRolesModal,
  InviteTraegerAccountModal,
} from "~/components/traeger/traeger-account-modals";
import { isRefusal } from "~/components/traeger/use-traeger-confirmed-resource";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { TraegerAccountHistory } from "~/components/traeger/traeger-account-history";
import { TraegerListExportMenu } from "~/components/traeger/traeger-list-export-menu";
import { Button } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import {
  useApiFormError,
  useApiLoadError,
  useToast,
} from "~/contexts/ToastContext";
import { formatDate, formatTime } from "~/lib/date-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { createLogger } from "~/lib/logger";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchTraegerBuero,
  removeTraegerMember,
  revokeTraegerInvitation,
  type TraegerBuero,
  type TraegerInvitation,
  type TraegerMember,
} from "~/lib/traeger-api";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { TRAEGER_ROLE_LABELS, type TraegerRole } from "~/lib/traeger-roles";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "TraegerAccountsPage" });

const NO_BUERO: TraegerBuero = { members: [], invitations: [] };

function roleNames(roles: readonly TraegerRole[]): string {
  return roles.map((role) => TRAEGER_ROLE_LABELS[role]).join(", ") || "–";
}

type Pending =
  | { kind: "remove"; member: TraegerMember }
  | { kind: "revoke"; invitation: TraegerInvitation };

export default function TraegerAccountsPage() {
  const { data: session } = useSession();
  const ownEmail = session?.user?.email ?? "";
  const reader = useTraegerResource(
    traegerKeys.buero(),
    fetchTraegerBuero,
    "die Liste der Personen",
  );
  const { mutate } = reader;
  // A refused download ends the access too: the page drops what it shows.
  const [exportRefused, setExportRefused] = useState(false);
  const exportLoad = useApiLoadError();
  const refused = reader.refused || exportRefused;
  const buero: TraegerBuero = (refused ? null : reader.data) ?? NO_BUERO;
  const loaded = !refused && reader.data !== null;
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<TraegerMember | null>(null);
  const [naming, setNaming] = useState<TraegerMember | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState(false);
  const invalidateFamily = useInvalidateFamily();
  const confirmErrors = useApiFormError();
  const { success } = useToast();

  const onExportError = (error: unknown) => {
    if (!isRefusal(error)) return;
    setExportRefused(true);
    setInviting(false);
    setEditing(null);
    setNaming(null);
    setPending(null);
    void exportLoad.show(error, { object: "die Liste der Personen" });
  };

  // A write's reload runs after the write; its failure stands above the list
  // as a load error, never as an error of the closed dialog (#6652). Every
  // change on the page reads the history again.
  const afterWrite = useRefreshAfterWrite(
    "die Anzeige des Träger-Büros",
    async () => {
      void invalidateFamily(traegerKeys.accountHistoryFamily);
      await mutate(fetchTraegerBuero(), { revalidate: false });
    },
  );

  const closeConfirm = () => {
    setPending(null);
    confirmErrors.clear();
  };

  const confirm = async () => {
    if (!pending) return;
    setConfirming(true);
    confirmErrors.clear();
    try {
      if (pending.kind === "remove") {
        await removeTraegerMember(pending.member.accountId);
        if (pending.member.email === ownEmail) {
          // Wer sich selbst entfernt, hat keinen Zugang mehr.
          await signOut({ redirect: false });
          window.location.assign(traegerPath("/traeger/login"));
          return;
        }
        success("Die Person ist aus dem Träger-Büro entfernt.");
      } else {
        await revokeTraegerInvitation(pending.invitation.id);
        success("Die Einladung ist zurückgenommen.");
      }
    } catch (err) {
      logger.error("traeger_account_change_failed", {
        kind: pending.kind,
        error: err instanceof Error ? err.message : String(err),
      });
      void confirmErrors.show(err, {
        object:
          pending.kind === "remove" ? "das Entfernen" : "das Zurücknehmen",
      });
      setConfirming(false);
      return;
    }
    setPending(null);
    setConfirming(false);
    await afterWrite.refresh();
  };

  // The Träger-Büro keeps at least one Leitung; the server refuses to remove
  // the last one, so its row does not offer it.
  const leaders = buero.members.filter((member) =>
    member.roles.includes("leadership"),
  ).length;
  const isLastLeader = (member: TraegerMember) =>
    leaders === 1 && member.roles.includes("leadership");
  // The saved name shows at once, also when the reload after it fails.
  const showSavedMember = (saved: TraegerMember) => {
    void mutate(
      (current) =>
        current && {
          ...current,
          members: current.members.map((member) =>
            member.accountId === saved.accountId ? saved : member,
          ),
        },
      { revalidate: false },
    );
    // The header shows the own name (#6870).
    if (saved.email === ownEmail) void invalidateFamily(traegerKeys.profile());
  };

  const memberColumns: DataTableColumn<TraegerMember>[] = [
    {
      key: "name",
      header: "Name",
      render: (member) => (
        <span className="wrap-anywhere">
          {member.name ? (
            <span className="font-medium text-gray-900">{member.name}</span>
          ) : (
            <span className="text-gray-500">Kein Name</span>
          )}
          {member.email === ownEmail ? (
            <span className="ml-1 text-gray-500">(Sie)</span>
          ) : null}
        </span>
      ),
      // Persons without a name come last.
      sortValue: (member) => member.name.toLocaleLowerCase("de") || null,
      stacked: "title",
    },
    {
      key: "email",
      header: "E-Mail",
      render: (member) => <span className="wrap-anywhere">{member.email}</span>,
      sortValue: (member) => member.email,
      stacked: "field",
    },
    {
      key: "roles",
      header: "Rolle",
      render: (member) => (
        <>
          {roleNames(member.roles)}
          {isLastLeader(member) ? (
            // text-balance: two even lines break after the comma, not
            // inside „Träger-Büro“ at its hyphen.
            <span className="block text-sm text-balance text-gray-600">
              Einzige Leitung, bleibt im Träger-Büro
            </span>
          ) : null}
        </>
      ),
      stacked: "field",
    },
    {
      key: "actions",
      header: "",
      render: (member) => (
        <OverflowMenu
          ariaLabel={`Aktionen für ${member.email}`}
          items={[
            {
              icon: <UserPen className="size-4" aria-hidden />,
              label: member.name ? "Namen ändern" : "Namen eintragen",
              description: "Öffnet den Namen der Person zum Ändern.",
              onClick: () => setNaming(member),
            },
            {
              icon: <Pencil className="size-4" aria-hidden />,
              label: "Rollen ändern",
              description: "Öffnet die Rollen der Person zum Ändern.",
              onClick: () => setEditing(member),
            },
            ...(isLastLeader(member)
              ? []
              : [
                  {
                    label: "Aus dem Träger-Büro entfernen",
                    description:
                      "moto fragt vorher nach, dann endet der Zugang zum Träger-Portal.",
                    icon: <Trash2 className="size-4" aria-hidden />,
                    destructive: true,
                    onClick: () => setPending({ kind: "remove", member }),
                  },
                ]),
          ]}
        />
      ),
      align: "right",
      stacked: "meta",
    },
  ];

  const invitationColumns: DataTableColumn<TraegerInvitation>[] = [
    {
      key: "email",
      header: "E-Mail",
      render: (invitation) => (
        <span className="font-medium wrap-anywhere text-gray-900">
          {invitation.email}
        </span>
      ),
      sortValue: (invitation) => invitation.email,
      stacked: "title",
    },
    {
      key: "roles",
      header: "Rolle",
      render: (invitation) => roleNames(invitation.roles),
      stacked: "field",
    },
    {
      key: "expires",
      header: "Link gilt bis",
      render: (invitation) =>
        `${formatDate(invitation.expiresAt)}, ${formatTime(invitation.expiresAt)} Uhr`,
      stacked: "field",
    },
    {
      key: "actions",
      header: "",
      render: (invitation) => (
        <OverflowMenu
          ariaLabel={`Aktionen für die Einladung an ${invitation.email}`}
          items={[
            {
              label: "Einladung zurücknehmen",
              description:
                "moto fragt vorher nach, dann funktioniert der Einladungslink nicht mehr.",
              icon: <Undo2 className="size-4" aria-hidden />,
              destructive: true,
              onClick: () => setPending({ kind: "revoke", invitation }),
            },
          ]}
        />
      ),
      align: "right",
      stacked: "meta",
    },
  ];

  const pageError = exportLoad.error ?? reader.error;
  const memberCount = buero.members.length;
  const invitationCount = buero.invitations.length;

  return (
    <TenantPage
      title="Mitglieder und Rollen"
      info="Wer im Träger-Büro arbeitet, mit Namen und Rolle."
      stats={
        memberCount > 0 ? (
          <TenantPageStats
            items={[
              {
                value: memberCount,
                label: memberCount === 1 ? "Person" : "Personen",
              },
              ...(invitationCount > 0
                ? [
                    {
                      value: invitationCount,
                      label:
                        invitationCount === 1
                          ? "offene Einladung"
                          : "offene Einladungen",
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
      statsLoading={reader.loading}
      loading={refused && !pageError && !afterWrite.error}
      actions={
        refused ? undefined : (
          <>
            <TraegerListExportMenu
              download={(format) =>
                downloadTraegerList("/api/traeger/accounts/export", format)
              }
              scope="Träger-Büro"
              ariaLabel="Mitglieder und Einladungen herunterladen"
              fallbackName="mitglieder"
              errorObject="die Liste der Personen"
              unavailable={!loaded}
              onError={onExportError}
            />
            <Button
              type="button"
              variant="primary"
              size="md"
              tooltip="Öffnet ein Fenster, um eine Person ins Träger-Büro einzuladen."
              onClick={() => setInviting(true)}
            >
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              Person einladen
            </Button>
          </>
        )
      }
      error={loaded ? null : (afterWrite.error ?? pageError)}
      overlays={
        <>
          <InviteTraegerAccountModal
            isOpen={inviting}
            onClose={() => setInviting(false)}
            onInvited={afterWrite.refresh}
          />
          <ChangeTraegerRolesModal
            member={editing}
            members={buero.members}
            onClose={() => setEditing(null)}
            onChanged={afterWrite.refresh}
          />
          <ChangeTraegerMemberNameModal
            member={naming}
            onClose={() => setNaming(null)}
            onSaved={showSavedMember}
            onChanged={afterWrite.refresh}
          />
          <ConfirmDeleteModal
            isOpen={pending !== null}
            onClose={closeConfirm}
            onConfirm={() => void confirm()}
            title={
              pending?.kind === "revoke"
                ? "Einladung zurücknehmen?"
                : "Person entfernen?"
            }
            description={
              pending?.kind === "revoke" ? (
                <>
                  Der Link an{" "}
                  <span className="font-medium wrap-anywhere">
                    {pending.invitation.email}
                  </span>{" "}
                  funktioniert danach nicht mehr.
                </>
              ) : (
                <>
                  <span className="font-medium wrap-anywhere">
                    {pending?.kind === "remove" ? pending.member.email : ""}
                  </span>{" "}
                  kann sich danach nicht mehr im Träger-Portal anmelden. Das
                  moto-Konto der Person bleibt bestehen.
                </>
              )
            }
            confirmLabel={
              pending?.kind === "revoke" ? "Zurücknehmen" : "Entfernen"
            }
            loadingLabel={
              pending?.kind === "revoke"
                ? "Wird zurückgenommen …"
                : "Wird entfernt …"
            }
            gate={{
              mode: "twoStep",
              firstStepLabel:
                pending?.kind === "revoke"
                  ? "Ja, zurücknehmen"
                  : "Ja, entfernen",
            }}
            loading={confirming}
            error={confirmErrors.error}
          />
        </>
      }
    >
      {loaded ? <LoadErrorAlert error={reader.error} /> : null}
      <LoadErrorAlert error={afterWrite.error} />
      <DataTable
        columns={memberColumns}
        rows={[...buero.members]}
        getRowKey={(member) => member.accountId}
        rowHasInteractiveControls
        isLoading={reader.loading}
        loadingRowCount={3}
        defaultSortKey="name"
        stackedOnMobile
        emptyState={
          <EmptyState
            icon={<Users className="h-12 w-12" aria-hidden="true" />}
            title="Noch keine Personen im Träger-Büro."
          />
        }
      />
      {buero.invitations.length > 0 ? (
        <SectionCard
          title="Offene Einladungen"
          description="Diese Personen haben eine E-Mail bekommen, die Einladung aber noch nicht angenommen."
        >
          <DataTable
            columns={invitationColumns}
            rows={[...buero.invitations]}
            getRowKey={(invitation) => invitation.id}
            rowHasInteractiveControls
            defaultSortKey="email"
            stackedOnMobile
          />
        </SectionCard>
      ) : null}
      {refused || pageError ? null : (
        <TraegerAccountHistory onExportError={onExportError} />
      )}
    </TenantPage>
  );
}
