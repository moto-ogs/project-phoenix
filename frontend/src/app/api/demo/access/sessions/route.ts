import { captureBffException } from "~/lib/sentry-bff.server";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contractWrite } from "~/lib/contract/client.server";
import { routes } from "~/lib/contract/demo-access.generated";
import { contractError } from "~/lib/contract/route-response.server";
import { frontendOrigin } from "~/lib/client-headers.server";
import { createLogger } from "~/lib/logger";
import { DEMO_TOKEN_COOKIE, DEMO_TOKEN_COOKIE_OPTIONS } from "../forward";
import { problemResponse } from "~/lib/api-response-error.server";
import { withPrivateNoStore } from "~/lib/private-no-store";
import { successResponse } from "~/lib/route-wrapper-utils.server";
import { configuredPortalOfHost } from "~/lib/portal-paths";
import { tenantPortal } from "~/server/auth";
import { parentPortal } from "~/server/auth/parent";
import { traegerPortal } from "~/server/auth/traeger";
import { sessionMutationOriginError } from "~/server/auth/same-origin";
import { installLoginSession } from "~/lib/login-route.server";
import {
  logoutRollback,
  mintedPair,
  revokeMintedSession,
} from "~/lib/session-transition.server";

const logger = createLogger({ component: "DemoSessionRoute" });

/** The portals a demo session can be redeemed on, each on its own host. */
type DemoPortal = "tenant" | "parent" | "traeger";

const DEMO_PORTAL_AUTH = {
  tenant: tenantPortal,
  parent: parentPortal,
  traeger: traegerPortal,
} as const;

const demoSessionRole = z.enum([
  "lead",
  "caregiver",
  "parent",
  "traeger",
  "all",
]);
const rollbackAnswer = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  demo: z.object({ role: demoSessionRole }),
});

/** The portal a demo role's session belongs to (#3468, #6193). */
function portalOfDemoRole(role: string): DemoPortal {
  if (role === "parent") return "parent";
  if (role === "traeger") return "traeger";
  return "tenant";
}

// The backend may already have minted a session when the decoder refuses
// the banner metadata. Only a validated pair and role can drive rollback.
async function rollbackUnreadableSession(
  request: NextRequest,
  payload: unknown,
) {
  const recovery = rollbackAnswer.safeParse(payload);
  if (!recovery.success) return;
  const minted = DEMO_PORTAL_AUTH[portalOfDemoRole(recovery.data.demo.role)];
  await revokeMintedSession(
    logoutRollback(request, minted.portal.backend.logout, recovery.data),
  );
}

async function POSTHandler(request: NextRequest) {
  const originError = sessionMutationOriginError(request);
  if (originError) return originError;
  // Choose the cookie context from the proxy-owned host, never from a role
  // supplied by the browser or returned for a fixed-role demo link.
  const portal = configuredPortalOfHost(new URL(frontendOrigin(request)).host);
  if (portal !== "tenant" && portal !== "parent" && portal !== "traeger") {
    return problemResponse(403, "Unsupported demo portal", request);
  }
  return DEMO_PORTAL_AUTH[portal].withSessionResponse((req) =>
    redeem(req, portal),
  )(request);
}

async function redeem(request: NextRequest, portal: DemoPortal) {
  let body: { token?: unknown; role?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An unreadable body is a switch without a role.
  }
  const linkToken = typeof body.token === "string" ? body.token.trim() : "";
  const token = linkToken || request.cookies.get(DEMO_TOKEN_COOKIE)?.value;
  if (!token) {
    return problemResponse(404, "demo access is unknown", request);
  }
  const role = typeof body.role === "string" ? body.role : undefined;
  try {
    const reply = await contractWrite(
      routes["POST /demo/access/sessions"],
      { token, role },
      {
        request,
        onInvalidSuccess: (payload) =>
          rollbackUnreadableSession(request, payload),
      },
    );
    if (!reply.ok) return contractError(reply, request);
    const payload = reply.value;
    const demo = payload.demo;
    const mintedRole = demoSessionRole.safeParse(demo.role);
    if (!mintedRole.success) {
      throw new Error("Invalid demo role");
    }
    // The session belongs to the portal of its role, not of this host.
    const mintedPortal = portalOfDemoRole(mintedRole.data);
    const minted = DEMO_PORTAL_AUTH[mintedPortal];
    const matchesPortal = mintedPortal === portal;
    if (matchesPortal) {
      const failure = await installLoginSession(request, payload, minted);
      if (failure) return failure;
    } else {
      // The entry page hands fixed-role links to the right portal. Revoke
      // this unused session family before returning only redirect metadata.
      await revokeMintedSession(
        logoutRollback(
          request,
          minted.portal.backend.logout,
          mintedPair(payload),
        ),
      );
    }
    const response = NextResponse.json(
      successResponse({
        session_created: matchesPortal,
        demo: {
          access_id: demo.access_id,
          role: demo.role,
          src: demo.src,
          fixed_role: demo.fixed_role,
          traeger: demo.traeger === true,
        },
      }),
      { status: reply.backend?.status },
    );
    if (linkToken) {
      response.cookies.set(
        DEMO_TOKEN_COOKIE,
        linkToken,
        DEMO_TOKEN_COOKIE_OPTIONS,
      );
    }
    return response;
  } catch (error) {
    captureBffException(error, request);
    logger.error("demo_session_forward_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return problemResponse(500, "Internal Server Error", request);
  }
}

export const POST = withPrivateNoStore(POSTHandler);
