import { captureBffException } from "~/lib/sentry-bff.server";
import type { NextRequest } from "next/server";
import { tenantPortal } from "~/server/auth";
import { contractGet } from "~/lib/contract/client.server";
import {
  contractResponse,
  contractError,
} from "~/lib/contract/route-response.server";
import { routes } from "~/lib/contract/enrollment.generated";
import { createLogger } from "~/lib/logger";
import { problemResponse } from "~/lib/api-response-error.server";
import {
  LATE_INVITE_QUERY_PARAM,
  withLateInviteQuery,
} from "~/lib/enrollment-http";

const logger = createLogger({ component: "EnrollmentFormBootstrapRoute" });

interface RouteContext {
  params: Promise<{ tenantSlug: string; phaseId: string }>;
}

async function GETHandler(request: NextRequest, context: RouteContext) {
  const { tenantSlug, phaseId } = await context.params;
  try {
    const reply = await contractGet(
      routes[
        "GET /api/enrollment/form-bootstrap/public/{tenantSlug}/{phaseId}"
      ],
      {
        endpoint: withLateInviteQuery(
          `/api/enrollment/form-bootstrap/public/${encodeURIComponent(
            tenantSlug,
          )}/${encodeURIComponent(phaseId)}`,
          request.nextUrl.searchParams.get(LATE_INVITE_QUERY_PARAM),
        ),
        request,
      },
    );
    if (!reply.ok) return contractError(reply, request);

    // The parents host never reaches this route (proxy allow-list), so the
    // tenant session's profile only enriches the tenant's own public form.
    const session = await tenantPortal.auth().catch((error: unknown) => {
      logger.warn("profile_auth_prefetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    const token = session?.user?.token;
    if (!token) return contractResponse(reply, request);
    const profile = await contractGet(
      routes["GET /api/enrollment/me/profile"],
      { token, request },
    ).catch((error: unknown) => {
      logger.warn("profile_prefetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (!profile?.ok) return contractResponse(reply, request);
    return contractResponse(reply, request, (answer) => ({
      ...answer,
      data: { ...answer.data, profile: profile.value.data },
    }));
  } catch (error) {
    captureBffException(error, request);
    logger.error("form_bootstrap_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return problemResponse(500, "Internal Server Error", request);
  }
}

export const GET = tenantPortal.withAuth(GETHandler);
