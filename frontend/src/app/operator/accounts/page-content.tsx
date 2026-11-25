"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useSetBreadcrumb } from "~/lib/breadcrumb-context";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import {
  STALE_DATA_SUFFIX,
  useRefreshAfterWrite,
} from "~/lib/hooks/use-refresh-after-write";
import { useOperatorAccountPages } from "~/lib/operator/use-account-pages";
import { Input } from "~/components/ui/input";
import { useDebounce } from "~/lib/use-debounce";
import type {
  OrgAccount,
  SchoolAccount,
} from "~/lib/operator/provisioning-helpers";
import { SimpleEmptyState } from "../provisioning/provisioning-shared";
import { CaregiverCapabilityModal } from "~/components/teachers/caregiver-capability-modal";
import { MFAAdminOverrideModal } from "~/components/auth/mfa-admin-override-modal";
import { OrgSchoolFilter } from "../provisioning/provisioning-tables-shared";
import { useOrgSchoolFilter } from "../provisioning/use-org-school-filter";
import { AccountsTable } from "~/components/operator/accounts-table";
import { AccountTenantAccessModal } from "~/components/operator/account-tenant-access-modal";
import { StatusBadge } from "~/components/ui/status-badge";

function OperatorAccountsPageContent() {
  useSetBreadcrumb({ pageTitle: "Konten" });

  const {
    isAuthenticated,
    activeOrganizations,
    filterOrgId,
    selectedSchool,
    urlSchoolId,
    filteredSchools,
    handleOrgFilterChange,
    handleSchoolFilterChange,
    organizationsLoadError,
    schoolsLoadError,
  } = useOrgSchoolFilter("/operator/accounts");

  const [caregiverAccount, setCaregiverAccount] = useState<
    SchoolAccount | OrgAccount | null
  >(null);
  const [caregiverSchoolContext, setCaregiverSchoolContext] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [mfaAccount, setMfaAccount] = useState<
    SchoolAccount | OrgAccount | null
  >(null);
  const [mfaSchoolContext, setMfaSchoolContext] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [tenantAccessAccount, setTenantAccessAccount] = useState<
    SchoolAccount | OrgAccount | null
  >(null);

  const [search, setSearch] = useState("");
  const searchTerm = search.trim();
  const debouncedSearch = useDebounce(searchTerm, 250);
  const searchPending = searchTerm !== debouncedSearch;
  const {
    rows,
    total: count,
    error: activeError,
    isLoading: accountsLoading,
    accessRefused,
    refresh: refreshAccounts,
    serverSort,
    moreAction,
  } = useOperatorAccountPages(
    urlSchoolId
      ? { kind: "school", id: urlSchoolId }
      : filterOrgId
        ? { kind: "organization", id: filterOrgId }
        : { kind: "all" },
    isAuthenticated && !searchPending,
    debouncedSearch,
  );
  const isLoading = accountsLoading || searchPending;

  useEffect(() => {
    setCaregiverAccount(null);
    setCaregiverSchoolContext(null);
    setMfaAccount(null);
    setMfaSchoolContext(null);
    setTenantAccessAccount(null);
  }, [accessRefused, filterOrgId, isAuthenticated, urlSchoolId]);

  const accountsLoadError = useSwrLoadError(
    activeError,
    "die Liste der Konten",
    () => void refreshAccounts(),
    !accessRefused && rows?.length ? STALE_DATA_SUFFIX : undefined,
  );
  // A dialog's write reloads the list afterwards; a failed reload stands
  // above the list, also after the dialog closed (#6652).
  const accountsAfterWrite = useRefreshAfterWrite(
    "die Anzeige der Konten",
    refreshAccounts,
  );

  const openCaregiverModal = useCallback(
    (
      account: SchoolAccount | OrgAccount,
      schoolContext: { id: string; name: string } | null,
    ) => {
      setCaregiverAccount(account);
      setCaregiverSchoolContext(schoolContext);
    },
    [],
  );

  const openMFAModal = useCallback(
    (
      account: SchoolAccount | OrgAccount,
      schoolContext: { id: string; name: string } | null,
    ) => {
      setMfaAccount(account);
      setMfaSchoolContext(schoolContext);
    },
    [],
  );

  const openTenantAccessModal = useCallback(
    (account: SchoolAccount | OrgAccount) => setTenantAccessAccount(account),
    [],
  );

  return (
    <TenantPage
      title="Konten"
      stats={
        accessRefused || count === undefined ? undefined : (
          <TenantPageStats
            items={[{ value: count, label: count === 1 ? "Konto" : "Konten" }]}
          />
        )
      }
      searchSlot={
        <OrgSchoolFilter
          idPrefix="account"
          organizations={activeOrganizations}
          filteredSchools={filteredSchools}
          filterOrgId={filterOrgId}
          selectedSchool={selectedSchool}
          onOrgChange={handleOrgFilterChange}
          onSchoolChange={handleSchoolFilterChange}
        >
          <div className="flex-1">
            <Input
              type="search"
              controlSize="touch"
              aria-label="Konten suchen"
              placeholder="Konten suchen"
              value={search}
              maxLength={128}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </OrgSchoolFilter>
      }
      overlays={
        <>
          {!accessRefused && mfaAccount && mfaSchoolContext ? (
            <MFAAdminOverrideModal
              isOpen={true}
              onClose={() => {
                setMfaAccount(null);
                setMfaSchoolContext(null);
              }}
              target={{ kind: "operator", schoolId: mfaSchoolContext.id }}
              accountId={mfaAccount.accountId}
              accountLabel={`${mfaAccount.firstName} ${mfaAccount.lastName}`.trim()}
            />
          ) : null}

          {!accessRefused && tenantAccessAccount ? (
            <AccountTenantAccessModal
              isOpen={true}
              onClose={() => setTenantAccessAccount(null)}
              accountId={tenantAccessAccount.accountId}
              accountLabel={
                `${tenantAccessAccount.firstName} ${tenantAccessAccount.lastName}`.trim() ||
                tenantAccessAccount.email
              }
              accountEmail={tenantAccessAccount.email}
              onUpdated={accountsAfterWrite.refresh}
            />
          ) : null}

          {!accessRefused && caregiverAccount && caregiverSchoolContext ? (
            <CaregiverCapabilityModal
              isOpen={true}
              onClose={() => {
                setCaregiverAccount(null);
                setCaregiverSchoolContext(null);
              }}
              scope="operator"
              accountId={caregiverAccount.accountId}
              accountLabel={`${caregiverAccount.firstName} ${caregiverAccount.lastName}`.trim()}
              schoolId={caregiverSchoolContext.id}
              schoolName={caregiverSchoolContext.name}
              onUpdated={accountsAfterWrite.refresh}
            />
          ) : null}
        </>
      }
    >
      <LoadErrorAlert error={organizationsLoadError} />
      <LoadErrorAlert error={schoolsLoadError} />
      <LoadErrorAlert error={accountsLoadError} />
      <LoadErrorAlert error={accountsAfterWrite.error} />

      {!accessRefused && selectedSchool && (
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">
            {selectedSchool.name}
          </h3>
          {selectedSchool.organization && (
            <span className="text-xs text-gray-500">
              {selectedSchool.organization.name}
            </span>
          )}
          {count !== undefined && (
            <StatusBadge
              tone="gray"
              compact
              label={`${count} ${count === 1 ? "Konto" : "Konten"}`}
            />
          )}
        </div>
      )}

      {!accessRefused &&
        (!urlSchoolId || selectedSchool) &&
        (!activeError && !isLoading && rows?.length === 0 ? (
          <SimpleEmptyState
            title="Keine Konten"
            description={
              debouncedSearch
                ? "Für diese Suche gibt es keine Treffer."
                : urlSchoolId
                  ? "Für diese Schule gibt es noch keine zugewiesenen Konten."
                  : filterOrgId
                    ? "Für diesen Träger gibt es noch keine zugewiesenen Konten."
                    : "Es gibt noch keine Konten im System."
            }
          />
        ) : rows?.length || isLoading ? (
          <AccountsTable
            accounts={rows ?? []}
            showSchool={!urlSchoolId}
            selectedSchool={selectedSchool}
            isLoading={isLoading}
            serverSort={serverSort}
            moreAction={moreAction}
            onManageCaregiver={openCaregiverModal}
            onManageMFA={openMFAModal}
            onManageTenantAccess={openTenantAccessModal}
          />
        ) : null)}
    </TenantPage>
  );
}

export default function OperatorAccountsPage() {
  return (
    <Suspense fallback={<TenantPage title="Konten" loading />}>
      <OperatorAccountsPageContent />
    </Suspense>
  );
}
