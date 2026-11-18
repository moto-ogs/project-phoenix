"use client";

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
import { MotoDuotoneIcon } from "~/components/ui/moto-duotone-icon";
import type {
  ActiveFilter,
  FilterConfig,
} from "~/components/ui/page-header/types";
import { createCrudService } from "@/lib/database/service-factory";
import { activitiesConfig } from "@/components/database/configs/activities.config";
import type { Activity } from "@/lib/activity-helpers";
import { ActivitiesMasterDetail } from "@/components/activities/activities-master-detail";
import { DatabaseFormModal } from "~/components/database/database-form-modal";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import {
  useSwrLoadError,
  useSwrResourceLoadError,
} from "~/lib/hooks/use-swr-load-error";
import { useDeleteConfirmation } from "~/hooks/useDeleteConfirmation";
import { useUpdateUrlParams } from "~/hooks/useUpdateUrlParams";
import { createLogger } from "~/lib/logger";
import { useSWRAuth, useTenantMutate } from "~/lib/swr";
import { tenantAdminKeys } from "~/lib/swr/tenant-admin-keys";
import { ModuleRouteGuard } from "~/components/tenant/module-route-guard";
import { activitiesConcept } from "~/lib/concepts/activities";
import { foldForSearch } from "~/lib/search-fold";
import { TenantPageStats } from "~/components/ui/tenant-page";

const logger = createLogger({ component: "DatabaseActivitiesPage" });

export default function ActivitiesPage() {
  return (
    <ModuleRouteGuard module="nfc_anwesenheit" title="Aktivitäten">
      <Suspense fallback={null}>
        <ActivitiesPageContent />
      </Suspense>
    </ModuleRouteGuard>
  );
}

function ActivitiesPageContent() {
  const searchParams = useSearchParams();
  const updateUrlParams = useUpdateUrlParams();

  const selectedId = searchParams.get("activity");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formResetCounter, setFormResetCounter] = useState(0);

  const {
    showConfirmModal: showDeleteConfirmModal,
    handleDeleteClick,
    handleDeleteCancel,
  } = useDeleteConfirmation();

  const { success: toastSuccess } = useToast();
  // Ladefehler des Details im Detailbereich, Schreibfehler im jeweiligen
  // Dialog (#2517).
  const createErrors = useApiFormError();
  const deleteErrors = useApiFormError();
  const [deletePending, setDeletePending] = useState(false);
  const latestDeleteRef = useRef<() => void>(() => undefined);
  const { clear: clearCreateErrors } = createErrors;
  // Ein neu geöffnetes Anlegen beginnt ohne den Fehler des vorigen Versuchs.
  useEffect(() => {
    if (showCreateModal) clearCreateErrors();
  }, [showCreateModal, clearCreateErrors]);

  const { status } = useSession({
    required: true,
    onUnauthenticated() {
      redirect("/");
    },
  });

  const service = useMemo(() => createCrudService(activitiesConfig), []);
  const tenantMutate = useTenantMutate();

  const {
    data: activitiesData,
    isLoading: swrLoading,
    error: activitiesError,
    mutate: mutateActivities,
  } = useSWRAuth(tenantAdminKeys.activities(), async () => {
    const data = await service.getList({ page: 1, pageSize: 500 });
    return Array.isArray(data.data) ? data.data : [];
  });

  const error = useSwrLoadError(
    activitiesError,
    "die Liste der Aktivitäten",
    () => mutateActivities(),
  );
  // Bis der Katalogtext des Ladefehlers da ist, bleibt das Skelett stehen.
  const loading = swrLoading || (Boolean(activitiesError) && error === null);

  // Statuszeile des Seitenkopfs aus der bereits geladenen Aktivitätenliste.
  const statusLine = useMemo(() => {
    const activities = activitiesData ?? [];
    const categories = new Set(
      activities.map((a) => a.category_name).filter(Boolean),
    ).size;
    const label = activities.length === 1 ? "Aktivität" : "Aktivitäten";
    if (categories === 0) return `${formatCount(activities.length)} ${label}`;
    return (
      <TenantPageStats
        items={[
          { value: formatCount(activities.length), label },
          {
            value: formatCount(categories),
            label: categories === 1 ? "Kategorie" : "Kategorien",
          },
        ]}
      />
    );
  }, [activitiesData]);

  const uniqueCategories = useMemo(() => {
    const activities = activitiesData ?? [];
    const set = new Set<string>();
    activities.forEach((a) => {
      if (a.category_name) set.add(a.category_name);
    });
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "de"))
      .map((c) => ({ value: c, label: c }));
  }, [activitiesData]);

  const filters: FilterConfig[] = useMemo(
    () => [
      {
        id: "category",
        label: "Kategorie",
        type: "dropdown",
        value: categoryFilter,
        onChange: (v) => setCategoryFilter(v as string),
        options: [
          { value: "all", label: "Alle Kategorien" },
          ...uniqueCategories,
        ],
      },
    ],
    [categoryFilter, uniqueCategories],
  );

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const list: ActiveFilter[] = [];
    if (searchTerm)
      list.push({
        id: "search",
        label: `"${searchTerm}"`,
        onRemove: () => setSearchTerm(""),
      });
    if (categoryFilter !== "all")
      list.push({
        id: "category",
        label: categoryFilter,
        onRemove: () => setCategoryFilter("all"),
      });
    return list;
  }, [searchTerm, categoryFilter]);

  const filteredActivities = useMemo(() => {
    const activities = activitiesData ?? [];
    let arr = [...activities];
    if (searchTerm) {
      const q = foldForSearch(searchTerm);
      arr = arr.filter(
        (a) =>
          foldForSearch(a.name).includes(q) ||
          foldForSearch(a.category_name).includes(q) ||
          foldForSearch(a.supervisor_name).includes(q),
      );
    }
    if (categoryFilter !== "all") {
      arr = arr.filter((a) => a.category_name === categoryFilter);
    }
    arr.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return arr;
  }, [activitiesData, searchTerm, categoryFilter]);

  const selectedActivitySummary = useMemo(
    () =>
      selectedId
        ? (filteredActivities.find((activity) => activity.id === selectedId) ??
          null)
        : null,
    [filteredActivities, selectedId],
  );

  const detailId = selectedActivitySummary?.id ?? null;
  const {
    data: selectedActivityDetail,
    error: detailError,
    mutate: reloadDetail,
  } = useSWRAuth(
    detailId ? tenantAdminKeys.activity(detailId) : null,
    () => service.getOne(detailId!),
    { keepPreviousData: false },
  );
  const detailLoad = useSwrResourceLoadError(
    [{ data: selectedActivityDetail, error: detailError }],
    "die Aktivität",
    () => reloadDetail(),
  );
  const detailLoading =
    detailId !== null && !selectedActivityDetail && !detailError;
  const selectedActivity = selectedActivityDetail ?? selectedActivitySummary;

  const handleSelectActivity = useCallback(
    (id: string | null) => {
      updateUrlParams({ activity: id });
    },
    [updateUrlParams],
  );

  const handleCreateActivity = useCallback(
    async (data: Partial<Activity>) => {
      // Ein Fehler bleibt im Dialog: DatabaseForm zeigt ihn über errorPath.
      const payload = activitiesConfig.form.transformBeforeSubmit
        ? activitiesConfig.form.transformBeforeSubmit(data)
        : data;
      const created = await service.create(payload);
      toastSuccess(`Die Aktivität „${created.name}“ ist angelegt.`);
      setShowCreateModal(false);
      await tenantMutate(tenantAdminKeys.activities());
    },
    [service, tenantMutate, toastSuccess],
  );

  const handleUpdateActivity = useCallback(
    async (data: Partial<Activity>) => {
      if (!selectedActivity) return;
      // Ein Fehler bleibt im Formular (errorPath im Stammdaten-Reiter).
      const payload = activitiesConfig.form.transformBeforeSubmit
        ? activitiesConfig.form.transformBeforeSubmit(data)
        : data;
      await service.update(selectedActivity.id, payload);
      toastSuccess(
        `Die Aktivität „${data.name ?? selectedActivity.name}“ ist gespeichert.`,
      );
      // Das Speichern ist gelungen; ein Fehler beim Nachladen des Details
      // gehört nicht ins Formular.
      void reloadDetail();
      setFormResetCounter((current) => current + 1);
      await tenantMutate(tenantAdminKeys.activities());
    },
    [selectedActivity, service, tenantMutate, toastSuccess, reloadDetail],
  );

  const handleDeleteActivity = useCallback(async () => {
    if (!selectedActivity) return;
    setDeletePending(true);
    deleteErrors.clear();
    try {
      const deleted = await service.remove(selectedActivity.id);
      if (!deleted) return;
      toastSuccess(`Die Aktivität „${selectedActivity.name}“ ist gelöscht.`);
      handleDeleteCancel();
      setFormResetCounter(0);
      handleSelectActivity(null);
      await tenantMutate(tenantAdminKeys.activities());
    } catch (err) {
      logger.warn("activity_delete_failed", {
        activity_id: selectedActivity.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Der Bestätigungsdialog bleibt offen und nennt den Grund.
      void deleteErrors.show(err, {
        object: "das Löschen der Aktivität",
        retry: () => latestDeleteRef.current(),
      });
    } finally {
      setDeletePending(false);
    }
  }, [
    selectedActivity,
    service,
    toastSuccess,
    handleDeleteCancel,
    handleSelectActivity,
    tenantMutate,
    deleteErrors,
  ]);

  useLayoutEffect(() => {
    latestDeleteRef.current = () => void handleDeleteActivity();
  });

  const canShowDetail = !loading && filteredActivities.length > 0;

  return (
    <DatabasePageLayout
      loading={loading}
      sessionLoading={status === "loading"}
      error={error}
      empty={
        filteredActivities.length === 0
          ? {
              title:
                searchTerm || categoryFilter !== "all"
                  ? "Keine Aktivitäten gefunden"
                  : "Keine Aktivitäten vorhanden",
              description:
                searchTerm || categoryFilter !== "all"
                  ? "Versuchen Sie andere Suchkriterien oder Filter."
                  : "Legen Sie die erste Aktivität an, um sie verplanen zu können.",
              icon: (
                <MotoDuotoneIcon
                  icon={activitiesConcept.icon}
                  tone={activitiesConcept.tone}
                  size={48}
                />
              ),
            }
          : null
      }
      overlays={
        <>
          <DatabaseFormModal<Activity>
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            mode="create"
            config={activitiesConfig}
            onSubmit={handleCreateActivity}
            errorPath={createErrors}
            errorObject="die Aktivität"
          />

          {selectedActivity && (
            <ConfirmDeleteModal
              isOpen={showDeleteConfirmModal}
              onClose={() => {
                deleteErrors.clear();
                handleDeleteCancel();
              }}
              onConfirm={() => void handleDeleteActivity()}
              title="Aktivität löschen?"
              description={
                <>
                  Möchten Sie die Aktivität{" "}
                  <span className="font-medium">{selectedActivity.name}</span>{" "}
                  wirklich löschen? Diese Aktion kann nicht rückgängig gemacht
                  werden.
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
        title: "Aktivitäten",
        description: statusLine,
        actions: (
          <DatabaseCreateAction
            label="Aktivität"
            ariaLabel="Aktivität erstellen"
            onClick={() => setShowCreateModal(true)}
          />
        ),
      }}
      searchRow={{
        badge: {
          icon: (
            <MotoDuotoneIcon
              icon={activitiesConcept.icon}
              tone={activitiesConcept.tone}
              size={20}
            />
          ),
          count: filteredActivities.length,
          label: "Aktivitäten",
        },
        search: {
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Aktivitäten suchen…",
        },
        filters,
        activeFilters,
        onClearAllFilters: () => {
          setSearchTerm("");
          setCategoryFilter("all");
        },
      }}
    >
      {canShowDetail ? (
        <div className="min-h-0 flex-1 pb-4">
          <ActivitiesMasterDetail
            activities={filteredActivities}
            selectedId={selectedId}
            selectedActivity={selectedActivity}
            detailLoading={detailLoading}
            detailError={detailLoad.error}
            onSelect={handleSelectActivity}
            onSaveActivity={handleUpdateActivity}
            onResetForm={() => setFormResetCounter((current) => current + 1)}
            onDeleteClick={handleDeleteClick}
            formResetKey={`${selectedActivity?.id ?? "none"}:${formResetCounter}`}
          />
        </div>
      ) : null}
    </DatabasePageLayout>
  );
}
