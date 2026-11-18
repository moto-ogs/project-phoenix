"use client";

import { useAccessControlledData } from "~/lib/hooks/use-access-controlled-data";
import { operatorProvisioningKeys } from "~/lib/swr/portal-keys";

import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- operator pages are not tenant-scoped
import { useSWRAuth } from "~/lib/swr";
import { useSession } from "next-auth/react";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useSetBreadcrumb } from "~/lib/breadcrumb-context";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  STALE_DATA_SUFFIX,
  useRefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import {
  operatorProvisioningService,
  revalidateTenantCache,
} from "~/lib/operator/provisioning-api";
import type { SchoolSummary } from "~/lib/operator/provisioning-helpers";
import {
  buildSchoolColumns,
  lacksRequiredDetails,
} from "~/components/operator/school-table-columns";
import type { FilterConfig } from "~/components/ui/page-header/types";
import { Button } from "~/components/ui/button";
import { DataTable } from "~/components/ui/data-table";
import { ProvisioningEmptyState } from "../provisioning/provisioning-shared";
import { CreateSchoolModal } from "../provisioning/create-school-modal";
import {
  useSoftDeletable,
  DeletedEntityCard,
  TrashToggleButton,
} from "../provisioning/soft-delete-shared";
import {
  SchoolRestoreModal,
  SchoolSoftDeleteModal,
} from "../provisioning/operator-entity-modals";

export default function OperatorSchoolsPage() {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  useSetBreadcrumb({ pageTitle: "Schulen" });
  const router = useRouter();

  const [createSchoolOpen, setCreateSchoolOpen] = useState(false);
  const [requiredFilter, setRequiredFilter] = useState<"all" | "missing">(
    "all",
  );

  const {
    data: cachedOrganizations,
    error: organizationsError,
    mutate: mutateOrganizations,
  } = useSWRAuth(
    isAuthenticated ? operatorProvisioningKeys.organizations() : null,
    () => operatorProvisioningService.listOrganizations(),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );
  const { data: organizations } = useAccessControlledData(
    isAuthenticated ? operatorProvisioningKeys.organizations() : null,
    cachedOrganizations,
    organizationsError,
  );

  const {
    data: cachedSchoolSummaries,
    error: summariesError,
    isLoading: summariesLoading,
    mutate: mutateSummaries,
  } = useSWRAuth(
    isAuthenticated ? operatorProvisioningKeys.schoolSummaries() : null,
    () => operatorProvisioningService.listSchoolSummaries(),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );
  const { data: schoolSummaries, accessRefused: schoolSummariesAccessRefused } =
    useAccessControlledData(
      isAuthenticated ? operatorProvisioningKeys.schoolSummaries() : null,
      cachedSchoolSummaries,
      summariesError,
    );
  const summariesLoadError = useSwrLoadError(
    summariesError,
    "die Liste der Schulen",
    () => void mutateSummaries(),
    schoolSummaries?.length ? STALE_DATA_SUFFIX : undefined,
  );
  // What each school still lacks (#7174): a reply address that answers
  // parents.
  const {
    data: requiredDetailsList,
    error: requiredDetailsError,
    mutate: mutateRequiredDetails,
  } = useSWRAuth(
    isAuthenticated ? operatorProvisioningKeys.schoolRequiredDetails() : null,
    () => operatorProvisioningService.listSchoolRequiredDetails(),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );
  const requiredDetailsLoadError = useSwrLoadError(
    requiredDetailsError,
    "die fehlenden Pflichtangaben",
    () => void mutateRequiredDetails(),
  );
  const requiredDetails = useMemo(
    () =>
      requiredDetailsList
        ? new Map(requiredDetailsList.map((item) => [item.schoolId, item]))
        : undefined,
    [requiredDetailsList],
  );
  // A missing response cannot identify which schools match this filter.
  // Reset a prior selection while the required details are unavailable.
  useLayoutEffect(() => {
    if (requiredDetails === undefined) setRequiredFilter("all");
  }, [requiredDetails]);
  // The create form and the trash need the providers.
  const organizationsLoadError = useSwrLoadError(
    organizationsError,
    "die Liste der Träger",
    () => void mutateOrganizations(),
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([mutateSummaries(), mutateRequiredDetails()]);
  }, [mutateSummaries, mutateRequiredDetails]);
  // The new school's list entry and its portal cache load after the write; a
  // failure stands above the list, also after the dialog closed (#6652).
  const createdAfterWrite = useRefreshAfterWrite(
    "die Anzeige der Schulen",
    async (subdomain: string) => {
      await refreshAll();
      await revalidateTenantCache([subdomain]);
    },
  );

  const activeOrganizations = useMemo(
    () => organizations?.filter((o) => o.deletedAt == null) ?? [],
    [organizations],
  );

  const activeSummaries = useMemo(
    () => schoolSummaries?.filter((s) => s.deletedAt == null) ?? [],
    [schoolSummaries],
  );

  const incompleteCount = useMemo(
    () =>
      requiredDetails
        ? activeSummaries.filter((s) =>
            lacksRequiredDetails(requiredDetails.get(s.id)),
          ).length
        : undefined,
    [activeSummaries, requiredDetails],
  );

  const visibleSummaries = useMemo(
    () =>
      requiredFilter === "missing" && requiredDetails
        ? activeSummaries.filter((s) =>
            lacksRequiredDetails(requiredDetails.get(s.id)),
          )
        : activeSummaries,
    [activeSummaries, requiredDetails, requiredFilter],
  );

  const filterConfigs: FilterConfig[] = [
    {
      id: "pflichtangaben",
      label: "Pflichtangaben",
      type: "dropdown",
      value: requiredFilter,
      onChange: (value) => setRequiredFilter(value as "all" | "missing"),
      options: [
        { value: "all", label: "Alle Schulen" },
        { value: "missing", label: "Angaben fehlen" },
      ],
    },
  ];

  const deletedSummaries = useMemo(
    () => schoolSummaries?.filter((s) => s.deletedAt != null) ?? [],
    [schoolSummaries],
  );

  const deletedOrgIds = useMemo(
    () =>
      new Set(
        (organizations ?? [])
          .filter((o) => o.deletedAt != null)
          .map((o) => o.id),
      ),
    [organizations],
  );

  const orgSlugById = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizations ?? []) {
      map.set(org.id, org.slug);
    }
    return map;
  }, [organizations]);

  const schoolDelete = useSoftDeletable<SchoolSummary>({
    softDeleteFn: operatorProvisioningService.softDeleteSchool,
    restoreFn: operatorProvisioningService.restoreSchool,
    mutateList: mutateSummaries,
    errorObjects: {
      softDelete: "das Löschen der Schule",
      restore: "die Wiederherstellung der Schule",
    },
    logEventPrefix: "school",
    reloadObject: "die Anzeige der Schulen",
    onAfterSoftDelete: async (target) => {
      await revalidateTenantCache([target.subdomain]);
    },
    onAfterRestore: async (target) => {
      await Promise.all([
        revalidateTenantCache([target.subdomain]),
        mutateRequiredDetails(),
      ]);
    },
  });

  const requestRestore = useCallback(
    (summary: SchoolSummary) => {
      schoolDelete.setRestoreTarget(summary);
    },
    [schoolDelete],
  );

  const schoolRestoreParentDeleted = useMemo(() => {
    const target = schoolDelete.restoreTarget;
    if (!target) return false;
    return deletedOrgIds.has(target.organizationId);
  }, [schoolDelete.restoreTarget, deletedOrgIds]);

  const count = schoolSummaries?.length;

  const actionButton = (
    <Button
      type="button"
      variant="primary"
      size="md"
      onClick={() => setCreateSchoolOpen(true)}
    >
      Neue Schule
    </Button>
  );

  const handleRowClick = useCallback(
    (row: SchoolSummary) => {
      const orgSlug = orgSlugById.get(row.organizationId);
      if (!orgSlug) return;
      router.push(
        `/operator/organizations/${encodeURIComponent(orgSlug)}/schools/${encodeURIComponent(row.slug)}`,
      );
    },
    [orgSlugById, router],
  );

  const columns = useMemo(
    () => buildSchoolColumns({ showOrgColumn: true, requiredDetails }),
    [requiredDetails],
  );

  const {
    setDeleteTarget: setSchoolDeleteTarget,
    setRestoreTarget: setSchoolRestoreTarget,
  } = schoolDelete;
  useLayoutEffect(() => {
    if (!schoolSummariesAccessRefused) return;
    setCreateSchoolOpen(false);
    setSchoolDeleteTarget(null);
    setSchoolRestoreTarget(null);
  }, [
    schoolSummariesAccessRefused,
    setSchoolDeleteTarget,
    setSchoolRestoreTarget,
  ]);

  return (
    <TenantPage
      title="Schulen"
      stats={
        count === undefined ? undefined : (
          <TenantPageStats
            items={[
              { value: count, label: count === 1 ? "Schule" : "Schulen" },
              ...(incompleteCount
                ? [{ value: incompleteCount, label: "mit fehlenden Angaben" }]
                : []),
            ]}
          />
        )
      }
      actions={schoolSummariesAccessRefused ? undefined : actionButton}
      filters={
        schoolDelete.showTrash || requiredDetails === undefined
          ? undefined
          : filterConfigs
      }
      overlays={
        <>
          <CreateSchoolModal
            isOpen={createSchoolOpen}
            onClose={() => setCreateSchoolOpen(false)}
            organizations={activeOrganizations}
            onCreated={createdAfterWrite.refresh}
          />
        </>
      }
    >
      <div>
        <LoadErrorAlert error={summariesLoadError} />
        <LoadErrorAlert error={schoolDelete.reloadError} />
        <LoadErrorAlert error={createdAfterWrite.error} />
        <LoadErrorAlert error={organizationsLoadError} />
        <LoadErrorAlert error={requiredDetailsLoadError} />
        {deletedSummaries.length > 0 && (
          <div className="mb-4 flex justify-end">
            <TrashToggleButton
              count={deletedSummaries.length}
              active={schoolDelete.showTrash}
              onToggle={() =>
                schoolDelete.setShowTrash(!schoolDelete.showTrash)
              }
            />
          </div>
        )}

        {schoolDelete.showTrash ? (
          <div className="mt-4 grid gap-4">
            {deletedSummaries.map((summary) => {
              const parentOrgDeleted = deletedOrgIds.has(
                summary.organizationId,
              );
              return (
                <DeletedEntityCard
                  key={summary.id}
                  name={summary.name}
                  subtitle={summary.subdomain}
                  extraSubtitle={summary.organizationName}
                  deletedAt={summary.deletedAt}
                  onRestore={() => requestRestore(summary)}
                  restoreDisabled={parentOrgDeleted}
                  restoreDisabledReason={
                    parentOrgDeleted
                      ? "Träger ist gelöscht. Bitte zuerst den Träger wiederherstellen."
                      : undefined
                  }
                />
              );
            })}
          </div>
        ) : !summariesLoading &&
          !summariesError &&
          schoolSummaries !== undefined &&
          activeSummaries.length === 0 ? (
          <ProvisioningEmptyState
            title="Keine Schulen"
            description="Erstellen Sie eine neue Schule unter einem Träger."
            buttonLabel="Neue Schule"
            onAction={() => setCreateSchoolOpen(true)}
          />
        ) : (schoolSummaries === undefined && !summariesLoading) ||
          (summariesError && !schoolSummaries?.length) ? null : (
          <DataTable
            columns={columns}
            rows={visibleSummaries}
            emptyState={
              <p className="text-center text-sm text-gray-500">
                Keine Schule mit fehlenden Pflichtangaben.
              </p>
            }
            getRowKey={(row) => row.id}
            onRowClick={handleRowClick}
            defaultSortKey="name"
            isLoading={summariesLoading}
          />
        )}

        {schoolDelete.deleteTarget && (
          <SchoolSoftDeleteModal
            target={schoolDelete.deleteTarget}
            errorMessage={schoolDelete.softDeleteError}
            isProcessing={schoolDelete.isProcessing}
            onCancel={() => schoolDelete.setDeleteTarget(null)}
            onConfirm={() => void schoolDelete.handleSoftDelete()}
          />
        )}

        <SchoolRestoreModal
          target={schoolDelete.restoreTarget}
          setTarget={schoolDelete.setRestoreTarget}
          onConfirm={() => void schoolDelete.handleRestore()}
          isProcessing={schoolDelete.isProcessing}
          errorMessage={schoolDelete.softDeleteError}
          confirmDisabled={schoolRestoreParentDeleted}
          confirmDisabledReason="Der Träger dieser Schule ist gelöscht. Bitte zuerst den Träger wiederherstellen."
        />
      </div>
    </TenantPage>
  );
}
