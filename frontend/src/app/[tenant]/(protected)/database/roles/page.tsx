"use client";

import { isAccessRefusal } from "~/lib/access-refusal";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSession } from "next-auth/react";
import { redirect, useSearchParams } from "next/navigation";
import { DatabaseCreateAction } from "~/components/database/database-create-action";
import { DatabasePageLayout } from "~/components/database/database-page-layout";
import { formatCount } from "~/lib/format-utils";
import { Alert } from "~/components/ui/alert";
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { createCrudService } from "@/lib/database/service-factory";
import { rolesConfig } from "@/components/database/configs/roles.config";
import type { Role } from "@/lib/auth-helpers";
import { getRoleDisplayName } from "@/lib/auth-helpers";
import { isHiddenSystemRole } from "@/lib/role-labels";
import { hasPermission, isAdmin } from "~/lib/auth-utils";
import { RolesMasterDetail } from "@/components/roles/roles-master-detail";
import { DatabaseFormModal } from "~/components/database/database-form-modal";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { useDeleteConfirmation } from "~/hooks/useDeleteConfirmation";
import { useUpdateUrlParams } from "~/hooks/useUpdateUrlParams";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { ApiError } from "~/lib/api-error";
import { useInvalidateFamily, useSWRAuth } from "~/lib/swr";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import { useDiscardRefusedEntity } from "~/lib/swr/hooks";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { rolesConcept } from "~/lib/concepts/roles";
import { TenantPageStats } from "~/components/ui/tenant-page";

/** Info-Knopf am Titel: wofür die Seite da ist und was man zuerst tut. */
const ROLES_INFO =
  "Die Rolle einer Person legt fest, was sie in moto sehen und tun darf. Rollen vom System kannst du nicht ändern. Lege dafür eine eigene Rolle an.";

const NO_ROLES: Role[] = [];

export default function RolesPage() {
  return (
    <Suspense fallback={null}>
      <RolesPageContent />
    </Suspense>
  );
}

function RolesPageContent() {
  const searchParams = useSearchParams();
  const updateUrlParams = useUpdateUrlParams();

  // The query value only selects an already-loaded row; role mutations still
  // require authenticated backend authorization and explicit confirmation.
  const selectedId = searchParams.get("role");
  const [searchTerm, setSearchTerm] = useState("");

  // Schreibfehler im jeweiligen Dialog (#2517).
  const createErrors = useApiFormError();
  const deleteErrors = useApiFormError();
  const latestDeleteRef = useRef<() => void>(() => undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { clear: clearCreateErrors } = createErrors;
  // Ein neu geöffnetes Anlegen beginnt ohne den Fehler des vorigen Versuchs.
  useEffect(() => {
    if (showCreateModal) clearCreateErrors();
  }, [showCreateModal, clearCreateErrors]);
  const [deletePending, setDeletePending] = useState(false);

  const {
    showConfirmModal: showDeleteConfirmModal,
    handleDeleteClick,
    handleDeleteCancel,
  } = useDeleteConfirmation();

  const { success: toastSuccess } = useToast();

  const { data: session, status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });
  const canManagePermissions =
    (isAdmin(session) || hasPermission(session, "roles:manage")) &&
    (isAdmin(session) || hasPermission(session, "roles:read")) &&
    (isAdmin(session) || hasPermission(session, "permissions:read"));

  const service = useMemo(() => createCrudService(rolesConfig), []);

  const readRoles = useCallback(async () => {
    const data = await service.getList();
    return Array.isArray(data.data) ? data.data : [];
  }, [service]);
  const {
    data: allRoles,
    error: rolesError,
    mutate: mutateRoles,
  } = useSWRAuth(tenantAdminKeys.roles(), readRoles);
  const accessRefused =
    rolesError instanceof ApiError && isAccessRefusal(rolesError);
  // Eltern vergibt die Einladung zur Eltern-App, nicht diese Seite (#4574).
  const roles = useMemo(
    () =>
      accessRefused
        ? NO_ROLES
        : (allRoles ?? NO_ROLES).filter((role) => !isHiddenSystemRole(role)),
    [accessRefused, allRoles],
  );
  // Ladefehler im Gerüst; bis der Katalogtext da ist, bleibt das Skelett
  // stehen.
  const rolesLoad = useSwrResourceLoadError(
    [{ data: allRoles, error: rolesError }],
    "die Liste der Rollen",
    () => mutateRoles(),
  );
  const loading =
    (!allRoles && !rolesError) ||
    (rolesLoad.failure !== undefined && rolesLoad.error === null);
  const invalidateFamily = useInvalidateFamily();
  // A write's reload stands above the list as a load error (#6652). The
  // invitation form reads the roles in its own projection.
  const rolesAfterWrite = useRefreshAfterWrite(
    "die Anzeige der Rollen",
    async () => {
      void invalidateFamily(enrollmentKeys.roles());
      await mutateRoles(readRoles(), { revalidate: false });
    },
  );
  const refreshRoles = rolesAfterWrite.refresh;

  const filters: FilterConfig[] = useMemo(() => [], []);

  const activeFilters: ActiveFilter[] = useMemo(
    () =>
      searchTerm
        ? [
            {
              id: "search",
              label: `"${searchTerm}"`,
              onRemove: () => setSearchTerm(""),
            },
          ]
        : [],
    [searchTerm],
  );

  // Statuszeile des Seitenkopfs aus der bereits geladenen Rollenliste.
  const statusLine = useMemo(() => {
    const systemRoles = roles.filter((r) => r.isSystem).length;
    const label = roles.length === 1 ? "Rolle" : "Rollen";
    if (systemRoles === 0) return `${formatCount(roles.length)} ${label}`;
    return (
      <TenantPageStats
        items={[
          { value: formatCount(roles.length), label },
          { value: formatCount(systemRoles), label: "vom System" },
        ]}
      />
    );
  }, [roles]);

  const unclassifiedCount = useMemo(
    () => roles.filter((r) => !r.isSystem && !r.baseRole).length,
    [roles],
  );

  const filteredRoles = useMemo(() => {
    let arr = [...roles];
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      arr = arr.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q) ?? false),
      );
    }
    arr.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return arr;
  }, [roles, searchTerm]);

  const selectedRoleSummary = useMemo(
    () =>
      selectedId
        ? (filteredRoles.find((role) => role.id === selectedId) ?? null)
        : null,
    [filteredRoles, selectedId],
  );
  const selectedRoleId = selectedRoleSummary?.id;

  const {
    data: selectedRoleDetail,
    error: detailError,
    mutate: reloadDetail,
  } = useSWRAuth(
    selectedRoleId ? tenantAdminKeys.role(selectedRoleId) : null,
    () => service.getOne(selectedRoleId!),
    { keepPreviousData: false },
  );
  const detailLoad = useSwrResourceLoadError(
    [{ data: selectedRoleDetail, error: detailError }],
    "die Rolle",
    () => reloadDetail(),
  );
  const detailLoading =
    selectedRoleId !== undefined && !selectedRoleDetail && !detailError;
  const selectedRole = selectedRoleDetail ?? selectedRoleSummary;

  const handleSelectRole = useCallback(
    (id: string | null) => {
      updateUrlParams({ role: id });
    },
    [updateUrlParams],
  );

  // A refused list ends the roles on screen, their details and open dialogs.
  const discardRefused = useDiscardRefusedEntity();
  useLayoutEffect(() => {
    if (!accessRefused) return;
    discardRefused(rolesError, {
      codes: [rolesError.code ?? "general.permission"],
      matches: (key) =>
        key === tenantAdminKeys.roles() ||
        key.startsWith(tenantAdminKeys.roleFamily),
    });
    setShowCreateModal(false);
    handleDeleteCancel();
    if (selectedId) handleSelectRole(null);
  }, [
    accessRefused,
    selectedId,
    rolesError,
    discardRefused,
    handleDeleteCancel,
    handleSelectRole,
  ]);

  // Nach dem Speichern der Berechtigungen im Reiter (#3116): die Zahl in der
  // Liste und das Detail neu laden. Ein Fehler dabei zeigen Liste und Detail
  // selbst an; das Speichern ist da bereits gelungen.
  const handlePermissionsSaved = useCallback(async () => {
    if (!selectedRole) return;
    void reloadDetail();
    await refreshRoles();
  }, [refreshRoles, reloadDetail, selectedRole]);

  const handleCreateRole = useCallback(
    async (data: Partial<Role>) => {
      // Ein Fehler bleibt im Dialog: DatabaseForm zeigt ihn über errorPath,
      // ein vergebener Name (identity.role_name_taken) markiert das Feld.
      const created = await service.create(data);
      toastSuccess(
        `Die Rolle „${getRoleDisplayName(created.name)}“ ist angelegt.`,
      );
      setShowCreateModal(false);
      await refreshRoles();
    },
    [service, refreshRoles, toastSuccess],
  );

  const handleUpdateRole = useCallback(
    async (data: Partial<Role>) => {
      if (!selectedRole) return;
      // Ein Fehler bleibt im Formular (errorPath im Stammdaten-Reiter).
      await service.update(selectedRole.id, data);
      toastSuccess(
        `Die Rolle „${getRoleDisplayName(data.name ?? selectedRole.name)}“ ist gespeichert.`,
      );
      // Liste und Detail neu laden.
      void reloadDetail();
      await refreshRoles();
    },
    [selectedRole, service, refreshRoles, reloadDetail, toastSuccess],
  );

  const handleDeleteRole = useCallback(async () => {
    if (!selectedRole) return;
    setDeletePending(true);
    deleteErrors.clear();
    let deleted: boolean;
    try {
      deleted = await service.remove(selectedRole.id);
    } catch (err) {
      // Der Bestätigungsdialog bleibt offen und nennt den Grund.
      void deleteErrors.show(err, {
        object: "das Löschen der Rolle",
        retry: () => latestDeleteRef.current(),
      });
      return;
    } finally {
      setDeletePending(false);
    }
    if (!deleted) return;
    const removedId = selectedRole.id;
    await mutateRoles(
      (current) => current?.filter((role) => role.id !== removedId),
      { revalidate: false },
    );
    toastSuccess(
      `Die Rolle „${getRoleDisplayName(selectedRole.name)}“ ist gelöscht.`,
    );
    handleDeleteCancel();
    handleSelectRole(null);
    await refreshRoles();
  }, [
    selectedRole,
    service,
    mutateRoles,
    toastSuccess,
    handleDeleteCancel,
    handleSelectRole,
    refreshRoles,
    deleteErrors,
  ]);

  useLayoutEffect(() => {
    latestDeleteRef.current = () => void handleDeleteRole();
  });

  const canShowDetail = !loading && filteredRoles.length > 0;

  return (
    <DatabasePageLayout
      loading={
        loading || (accessRefused && !rolesLoad.error && !rolesAfterWrite.error)
      }
      sessionLoading={status === "loading"}
      error={rolesLoad.error ?? (accessRefused ? rolesAfterWrite.error : null)}
      empty={
        filteredRoles.length === 0 &&
        !accessRefused &&
        !rolesLoad.error &&
        !rolesAfterWrite.error
          ? {
              title: searchTerm
                ? "Keine Rollen gefunden"
                : "Keine Rollen vorhanden",
              description: searchTerm
                ? "Versuche einen anderen Suchbegriff."
                : "Lege die erste Rolle an, um Rechte zu vergeben.",
              icon: (
                <MotoDuotoneIcon
                  icon={rolesConcept.icon}
                  tone={rolesConcept.tone}
                  size={48}
                />
              ),
            }
          : null
      }
      overlays={
        <>
          <DatabaseFormModal<Role>
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            mode="create"
            config={rolesConfig}
            onSubmit={handleCreateRole}
            errorPath={createErrors}
            errorObject="die Rolle"
          />

          {selectedRole && (
            <ConfirmDeleteModal
              isOpen={showDeleteConfirmModal}
              onClose={handleDeleteCancel}
              onConfirm={() => void handleDeleteRole()}
              title="Rolle löschen?"
              description={
                <>
                  Möchtest du die Rolle{" "}
                  <span className="font-medium">
                    {getRoleDisplayName(selectedRole.name)}
                  </span>{" "}
                  wirklich löschen? Alle Personen mit dieser Rolle verlieren
                  ihre Berechtigungen.
                </>
              }
              gate={{ mode: "twoStep" }}
              loading={deletePending}
              error={deleteErrors.error}
            />
          )}
        </>
      }
      className="flex w-full flex-col"
      intro={{
        title: "Rollen",
        info: ROLES_INFO,
        description: statusLine,
        actions: accessRefused ? null : (
          <DatabaseCreateAction
            label="Rolle"
            ariaLabel="Rolle erstellen"
            onClick={() => setShowCreateModal(true)}
          />
        ),
      }}
      searchRow={{
        badge: {
          icon: (
            <MotoDuotoneIcon
              icon={rolesConcept.icon}
              tone={rolesConcept.tone}
              size={20}
            />
          ),
          count: filteredRoles.length,
          label: "Rollen",
        },
        search: {
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Rollen suchen…",
        },
        filters,
        activeFilters,
        onClearAllFilters: () => {
          setSearchTerm("");
        },
      }}
    >
      <LoadErrorAlert error={rolesAfterWrite.error} className="mb-4" />

      {unclassifiedCount > 0 && (
        <div className="mb-6">
          <Alert
            type="warning"
            title={
              unclassifiedCount === 1
                ? "Bei 1 Rolle fehlt „Gilt als“"
                : `Bei ${unclassifiedCount} Rollen fehlt „Gilt als“`
            }
            message="Mitteilungen kommen dort vielleicht nicht an. Öffne die Rolle, tippe auf „Bearbeiten“ und wähle bei „Gilt als“ einen Eintrag."
          />
        </div>
      )}

      {canShowDetail ? (
        <div className="min-h-0 flex-1 pb-4">
          <RolesMasterDetail
            roles={filteredRoles}
            selectedId={selectedId}
            selectedRole={selectedRole}
            detailLoading={detailLoading}
            detailError={detailLoad.error}
            canManagePermissions={canManagePermissions}
            onSelect={handleSelectRole}
            onSaveRole={handleUpdateRole}
            onDeleteClick={handleDeleteClick}
            onPermissionsSaved={handlePermissionsSaved}
          />
        </div>
      ) : null}
    </DatabasePageLayout>
  );
}
