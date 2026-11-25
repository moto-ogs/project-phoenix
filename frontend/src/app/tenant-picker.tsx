"use client";

import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthShell, MotoIconBrand } from "~/components/auth/auth-shell";
import { CustomSelect } from "~/components/ui/custom-select";
import { listAllTenants } from "~/lib/tenant-api";
import type { TenantListResult, TenantSummary } from "~/lib/tenant-api";
import { createLogger } from "~/lib/logger";
import { clientEnv } from "~/env.client";
import { Button } from "~/components/ui/button";

const logger = createLogger({ component: "RootPage" });

type PickerSchool = Pick<TenantSummary, "name" | "slug" | "subdomain">;

export function TenantPicker({
  initialSchools,
  pending = false,
}: Readonly<{ initialSchools?: PickerSchool[]; pending?: boolean }>) {
  const [browserList, setBrowserList] = useState<TenantListResult | null>(null);
  const tenants = initialSchools ?? browserList?.tenants ?? [];
  const loading = pending || (initialSchools === undefined && !browserList);
  const listStatus = initialSchools === undefined ? browserList?.status : "ok";
  const [selectedSlug, setSelectedSlug] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);

  // oxlint-disable-next-line swr/no-effect-load -- sessionless school picker on the root domain; the shared cache reads only with a session, by design
  useEffect(() => {
    if (pending || initialSchools !== undefined) return;
    let current = true;
    void listAllTenants().then((result) => {
      if (!current) return;
      setBrowserList(result);
      if (result.status === "error") logger.warn("tenant_list_fetch_failed");
      else if (result.tenants.length === 0) logger.warn("tenant_list_empty");
    });
    return () => {
      current = false;
    };
  }, [initialSchools, pending]);

  const handleNavigate = () => {
    const tenant = tenants.find((t) => t.slug === selectedSlug);
    if (!tenant) return;

    setIsNavigating(true);

    const tenantDomain = clientEnv.NEXT_PUBLIC_TENANT_DOMAIN;
    const portSuffix = window.location.port ? `:${window.location.port}` : "";
    const host = `${tenant.subdomain}.${tenantDomain}${portSuffix}`;

    window.location.href = `${window.location.protocol}//${host}/`;
  };

  const placeholder = loading ? "Laden..." : "Bitte auswählen...";

  return (
    <AuthShell
      title="Willkommen"
      subtitle="Wähle deine Einrichtung aus."
      variant="tenant-select"
      brand={<MotoIconBrand />}
      footer={
        <p className="text-sm text-gray-500">
          Noch nicht registriert?{" "}
          <Link
            href="/start"
            className="font-medium text-gray-700 transition-colors hover:text-gray-900 hover:underline"
          >
            Los geht&apos;s
          </Link>
        </p>
      }
    >
      <div className="space-y-6">
        {!loading && listStatus === "error" ? (
          <LoadErrorAlert error="Backend nicht erreichbar. Bitte versuche es später erneut." />
        ) : !loading && tenants.length === 0 ? (
          <EmptyState
            variant="compact"
            description="Aktuell sind keine Einrichtungen verfügbar."
          />
        ) : (
          <>
            <div className="text-left">
              <CustomSelect
                id="tenant-select"
                label="Einrichtung"
                value={selectedSlug}
                disabled={loading || isNavigating}
                onChange={setSelectedSlug}
                placeholder={placeholder}
                options={[
                  {
                    value: "",
                    label: placeholder,
                  },
                  ...tenants.map((tenant) => ({
                    value: tenant.slug,
                    label: tenant.name,
                  })),
                ]}
              />
            </div>

            <Button
              type="button"
              disabled={!selectedSlug || isNavigating}
              isLoading={isNavigating}
              loadingText="OGS wird geladen..."
              noTooltip="Die Auswahl nennt das Ziel."
              onClick={handleNavigate}
              variant="primary"
              size="field"
              className="w-full gap-2"
            >
              Weiter
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
