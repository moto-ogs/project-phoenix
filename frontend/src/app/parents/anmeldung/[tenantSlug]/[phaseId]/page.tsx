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
import { useReadDraft } from "~/lib/swr/read-draft";
import { createLogger } from "~/lib/logger";
import { enrollmentKeys } from "~/lib/swr/enrollment-keys";
import {
  normalizeCareFacilityTerm,
  CareFacilityTermScope,
  useCareTermTranslations,
} from "~/lib/care-facility-term";
import { careTermValuesOf } from "~/lib/care-facility-term-value";

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
  // The form the parent fills (ADR 0311): each opening reads it again, and
  // a cached form shows at once until that read answers. The submit sends
  // the form's token; when the school changed the form, the refusal loads
  // the current one. A failed first read shows its error even over a cached
  // form: the server would refuse a form it cannot confirm.
  const opened = useReadDraft<
    LoadedForm | null,
    LoadedForm | null,
    LoadedForm | null
  >({
    key: formKey,
    fetcher: loadForm,
    // The whole form: the opening's read replaces a cached one that differs
    // in anything, not only in its legal texts.
    token: (read) => read,
  });
  // After a refusal the entry stays on screen while the current form loads;
  // the form's own alert names a failed load, with a retry of the read.
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const openFailed = opened.status === "loadFailed" && refusedFor !== formKey;
  const openedForm = openFailed ? undefined : opened.base;
  const loaded = openedForm ?? null;
  const reloadForm = async () => {
    setRefusedFor(formKey);
    try {
      await opened.refuse()();
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
    openFailed ? opened.error : undefined,
    loadErrorObject,
    opened.retryLoad,
  );
  // Until its catalog text is there, a failure keeps the loading state.
  const loading =
    openedForm === undefined && (!openFailed || loadError === null);
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
                ? t(
                    "parentEmbeddedKicker",
                    careTermValuesOf(
                      loaded.tenant.careFacilityTerm,
                      loaded.tenant.careFacilityArticle,
                    ),
                  )
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
            article={loaded.tenant.careFacilityArticle}
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
