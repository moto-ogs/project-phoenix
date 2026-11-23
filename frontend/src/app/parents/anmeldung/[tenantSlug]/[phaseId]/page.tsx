"use client";

import { Suspense, use, useCallback, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- parent portal uses bare paths, no tenant-router
import { useRouter, useSearchParams } from "next/navigation";
import { LATE_INVITE_QUERY_PARAM } from "~/lib/enrollment-http";
import { EnrollmentForm } from "~/components/enrollment/enrollment-form";
import {
  prefetchedDataFromBootstrap,
  type EnrollmentFormPrefetchedData,
} from "~/components/enrollment/enrollment-form-config";
import {
  ParentPage,
  ParentPageHeader,
  ParentPageSkeleton,
  ParentSectionSkeleton,
} from "~/components/parent/parent-page";
import { TenantProvider } from "~/lib/tenant-context";
import { useAnalyticsSchoolPolicy } from "~/lib/hooks/use-analytics-school-policy";
import { isSupportedGradeLevelMax } from "~/lib/grade-level";
import {
  fetchParentEnrollmentProfile,
  submitParentEnrollment,
} from "~/lib/parent-api";
import { fetchParentEnrollmentBootstrap } from "~/lib/enrollment-submission-api";
import { parentPath } from "~/lib/parent-url";
import { resolveTenant, type TenantInfo } from "~/lib/tenant-api";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { useSWRAuth } from "~/lib/swr";
import {
  followOpeningRead,
  settledRead,
  type OpenedRead,
} from "~/lib/opening-read";
import { createLogger } from "~/lib/logger";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import {
  normalizeCareFacilityTerm,
  CareFacilityTermScope,
  useCareTermTranslations,
} from "~/lib/care-facility-term";

interface LoadedForm {
  readonly tenant: TenantInfo;
  readonly prefetchedData: EnrollmentFormPrefetchedData;
  readonly targetPath: string;
}

const logger = createLogger({ component: "ParentEnrollFormPage" });

interface PageProps {
  readonly params: Promise<{ tenantSlug: string; phaseId: string }>;
}

/**
 * Embedded enrollment form for logged-in parents. Reuses the exact
 * same EnrollmentForm component as the public per-phase page. The
 * form internally calls useTenant(), but the parents subdomain has no tenant
 * context of its own. Resolve the public tenant metadata explicitly and pass
 * it through a local TenantProvider; parent profile and submit traffic remain
 * on the parent-authenticated endpoints.
 */
export default function ParentEnrollFormPage({ params }: PageProps) {
  return (
    <Suspense
      fallback={
        <TenantProvider tenantSlug="" tenant={null}>
          <ParentPageSkeleton rows={3} />
        </TenantProvider>
      }
    >
      <ParentEnrollFormPageContent params={params} />
    </Suspense>
  );
}

function ParentEnrollFormPageContent({ params }: PageProps) {
  const t = useCareTermTranslations("enrollmentPublic");
  const loadErrorObject = t("errorObjectForm");
  const { tenantSlug, phaseId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const lateInviteToken = searchParams.get(LATE_INVITE_QUERY_PARAM)?.trim();
  const targetPath = `/anmeldung/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(phaseId)}`;
  const formKey = enrollmentKeys.parentEnrollmentForm(
    tenantSlug,
    phaseId,
    lateInviteToken,
  );
  const loadForm = async (): Promise<LoadedForm | null> => {
    const [tenant, bootstrap, profile] = await Promise.all([
      resolveTenant(tenantSlug),
      // Authenticated parent bootstrap (#1663): the anonymous public path
      // now refuses audience-restricted (linked_parents) phases, so the
      // parents portal loads form metadata through its own parent-scoped
      // endpoint. Parent autofill still comes only from the profile call
      // below.
      fetchParentEnrollmentBootstrap(tenantSlug, phaseId, {
        lateInviteToken,
      }),
      // Parent-profile lookup is best-effort, matching EnrollmentForm's
      // existing autofill contract. It stays on the parent-authenticated
      // API; public form metadata never receives the parent session token.
      // Deliberately silent: the client logs the failure, and without the
      // prefill the parent types the guardian fields.
      fetchParentEnrollmentProfile(tenantSlug).catch(() => null),
    ]);
    // A failed school lookup rejects with its code (#2353). Without the
    // school's grade setting the form cannot be built; the page shows its
    // load-failed text.
    if (!isSupportedGradeLevelMax(tenant.gradeLevelMax)) {
      return null;
    }
    return {
      tenant,
      // Autofill comes from the parent API only, never from the shared
      // public bootstrap shape.
      prefetchedData: prefetchedDataFromBootstrap(bootstrap, { profile }),
      targetPath,
    };
  };
  // A cached form shows at once and is read again in the background.
  const formRead = useSWRAuth(formKey, loadForm, { shouldRetryOnError: false });
  // The parent fills the form this opening read: it follows the first read
  // of the opening, then a background read no longer swaps the legal texts
  // under ticked consents. The submit sends that form's token; when the
  // school changed the form, the refusal loads the current one (ADR 0311).
  // A failed first read shows its error even over a cached form: the server
  // would refuse a form it cannot confirm.
  const [opened, setOpened] = useState<OpenedRead<LoadedForm | null>>();
  const current = opened?.key === formKey ? opened : undefined;
  const next = followOpeningRead(current, formKey, formRead);
  if (next !== current) setOpened(next);
  const openedForm = next && !next.failed ? next.data : undefined;
  const loaded = openedForm ?? null;
  const reloadForm = async () => {
    try {
      const reloaded = await formRead.mutate(loadForm(), { revalidate: false });
      if (reloaded !== undefined) {
        setOpened(settledRead(formKey, reloaded));
      }
    } catch (err) {
      // The form shows this failure in place of the refusal.
      logger.warn("enrollment_form_reload_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
  // A failed load stays where the form would be, with retry (#2515); a
  // failed background read after the opening leaves the opened form alone.
  const loadError = useSwrLoadError(
    openedForm === undefined ? formRead.error : undefined,
    loadErrorObject,
    () => formRead.mutate(),
  );
  // Until its catalog text is there, a failure keeps the loading state.
  const loading =
    openedForm === undefined &&
    (formRead.error === undefined || loadError === null);
  useAnalyticsSchoolPolicy(
    tenantSlug,
    !loading &&
      !loadError &&
      loaded?.targetPath === targetPath &&
      loaded.tenant.analyticsEnabled === true,
    targetPath,
  );

  const handleSubmitted = (statusURL: string) => {
    try {
      const u = new URL(statusURL);
      u.searchParams.set("submitted", "1");
      router.push(`${u.pathname}?${u.searchParams.toString()}`);
    } catch {
      globalThis.window.location.href = statusURL;
    }
  };

  const submitter = useCallback(
    (payload: Parameters<typeof submitParentEnrollment>[1]) =>
      submitParentEnrollment(tenantSlug, payload),
    [tenantSlug],
  );

  return (
    <TenantProvider
      tenantSlug={tenantSlug}
      tenant={loading || loadError ? null : (loaded?.tenant ?? null)}
    >
      <ParentPage
        header={
          <ParentPageHeader
            // The school, and with it its term for the care (#6042), is
            // known once the tenant loaded; no wording is guessed before.
            kicker={
              loaded
                ? t("parentEmbeddedKicker", {
                    careTerm: normalizeCareFacilityTerm(
                      loaded.tenant.careFacilityTerm,
                    ),
                  })
                : undefined
            }
            title={t("formEyebrow")}
            description={t("parentEmbeddedDescription")}
            backHref={parentPath("/parents/anmeldung")}
            backLabel={t("backToParentPicker")}
          />
        }
        loading={
          loading && (
            <div className="space-y-5">
              <ParentSectionSkeleton rows={4} announce={false} />
              <ParentSectionSkeleton rows={5} announce={false} />
              <ParentSectionSkeleton rows={3} announce={false} />
            </div>
          )
        }
        loadingLabel={t("detailsLoading")}
        error={
          loading
            ? null
            : (loadError ?? (loaded ? null : t("detailsLoadFailed")))
        }
      >
        {loaded ? (
          // The form names the care of the school it enrolls at (#6042),
          // not the account's schools the parents shell names (#6082).
          <CareFacilityTermScope
            term={normalizeCareFacilityTerm(loaded.tenant.careFacilityTerm)}
          >
            <EnrollmentForm
              phaseID={phaseId}
              gradeLevelMax={loaded.tenant.gradeLevelMax}
              onSubmitted={handleSubmitted}
              prefetchedData={loaded.prefetchedData}
              submitter={submitter}
              lateInviteToken={lateInviteToken ?? undefined}
              onFormChanged={reloadForm}
              viaParentPortal
              skipCaptcha
              localizedCopy
            />
          </CareFacilityTermScope>
        ) : null}
      </ParentPage>
    </TenantProvider>
  );
}
