import "server-only";
import type { NextRequest } from "next/server";
import { sessionMutationOriginError } from "~/server/auth/same-origin";
import type { z } from "zod";
import { contractWrite } from "~/lib/contract/client.server";
import { contractError } from "~/lib/contract/route-response.server";
import type { RequestBody } from "~/lib/contract/runtime";
import type { TokenResponse } from "~/lib/contract/shared.generated";
import type { TraegerLoginResponse } from "~/lib/contract/traeger-auth.generated";
import type { SignInReply } from "~/lib/session-bff";
import { problemResponse } from "~/lib/api-response-error.server";
import { captureBffException } from "~/lib/sentry-bff.server";
import { withoutSessionCookies } from "~/server/auth/session-cookie-writes";
import { createLogger } from "~/lib/logger";
import type { PortalAuth } from "~/server/auth/portal-auth";
import { successResponse } from "~/lib/route-wrapper-utils.server";
import {
  installMintedSession,
  logoutRollback,
  mintedPair,
} from "./session-transition.server";

const logger = createLogger({ component: "LoginRoute" });

/** What a login needs of its portal; every portal entry module exports it. */
export type LoginPortal = Pick<
  PortalAuth,
  "portal" | "setSession" | "withSessionResponse"
>;

/** A pre-session step of a portal's login the BFF forwards. */
type LoginStep =
  "login" | "mfa/verify" | "mfa/enroll/confirm" | "passkeys/login/verify";

type LoginData = TraegerLoginResponse | TokenResponse;
type LoginRoute = Parameters<typeof contractWrite>[0] & {
  method: "POST";
  routeFile: string;
  request: RequestBody<unknown>;
  response: z.ZodType<LoginData | { data: LoginData }>;
};

/** The backend's remember-device cookie, read by its login and MFA steps. */
const TRUSTED_DEVICE_COOKIE = "mfa_trust_device";

function isIgnoringTrustedDevice(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).ignore_trusted_device === true
  );
}

function withoutIgnoreFlag(body: unknown): Record<string, unknown> {
  const { ignore_trusted_device: _ignored, ...rest } = body as Record<
    string,
    unknown
  >;
  return rest;
}

/**
 * Installs the token pair of a completed login as the portal's session; a
 * failed install revokes the pair with that portal's logout.
 */
export function installLoginSession(
  request: NextRequest,
  data: Partial<TokenResponse>,
  { portal, setSession }: Pick<LoginPortal, "portal" | "setSession">,
): Promise<Response | null> {
  const pair = mintedPair(data);
  return installMintedSession(
    request,
    () => setSession(pair.access_token, pair.refresh_token),
    logoutRollback(request, portal.backend.logout, pair),
  );
}

/**
 * The BFF route of one login step of a portal. Only the password step can
 * answer with a next step (organization choice, MFA challenge, enrollment);
 * only the enrollment confirmation carries the limited enrollment proof.
 */
export function createPortalLoginRoute(
  login: LoginPortal,
  step: "login",
): ReturnType<LoginPortal["withSessionResponse"]>;
export function createPortalLoginRoute<R extends LoginRoute>(
  login: LoginPortal,
  step: Exclude<LoginStep, "login">,
  route: R,
): ReturnType<LoginPortal["withSessionResponse"]>;
export function createPortalLoginRoute(
  login: LoginPortal,
  step: LoginStep,
  route: LoginRoute = login.portal.backend.login,
) {
  const { backend } = login.portal;
  const path = route.pattern;
  const challenges = step === "login";
  const organizations = challenges && backend.organizationSelection === true;
  return login.withSessionResponse(async (request: NextRequest) => {
    const originError = sessionMutationOriginError(request);
    if (originError) return originError;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return problemResponse(400, "Invalid JSON", request);
    }
    // A sign-in that must prove the factor by code (a school without
    // remembered devices asked for it, #6955) leaves the device cookie
    // behind; the flag itself is the BFF's and never reaches the backend.
    const ignoreTrustedDevice = isIgnoringTrustedDevice(body);
    if (ignoreTrustedDevice) body = withoutIgnoreFlag(body);
    try {
      const trustedDevice = ignoreTrustedDevice
        ? undefined
        : request.cookies.get(TRUSTED_DEVICE_COOKIE)?.value;
      const enrollmentProof =
        step === "mfa/enroll/confirm"
          ? request.headers.get("authorization")
          : null;
      // Go validates the incoming body; the generated entry decodes its answer.
      const reply = await contractWrite(route, body, {
        request,
        timeout: "login",
        headers: {
          ...(trustedDevice && {
            Cookie: `${TRUSTED_DEVICE_COOKIE}=${trustedDevice}`,
          }),
          ...(enrollmentProof && { Authorization: enrollmentProof }),
        },
      });
      let response: Response;
      if (!reply.ok) {
        response = contractError(reply, request);
        // A locally refused success must not remember this device.
        if (reply.backend?.ok) return response;
      } else {
        const value: LoginData | { data: LoginData } = reply.value;
        const data = "data" in value ? value.data : value;
        const json = (body: SignInReply) =>
          Response.json(successResponse(body));
        const signIn = "status" in data ? data : undefined;
        if (
          organizations &&
          signIn?.status === "organization_selection_required"
        ) {
          if (!signIn.organizations)
            throw new Error("Invalid organization selection");
          response = json({
            status: signIn.status,
            organizations: signIn.organizations,
          });
        } else if (challenges && signIn?.status === "mfa_required") {
          if (
            typeof signIn.challenge_token !== "string" ||
            !signIn.challenge_token ||
            data.access_token ||
            data.refresh_token
          )
            throw new Error("Invalid MFA challenge response");
          response = json({
            status: signIn.status,
            challenge_token: signIn.challenge_token,
            masked_email: signIn.masked_email,
            ...(organizations
              ? { organization_id: signIn.organization_id }
              : {}),
            trusted_device_enabled: signIn.trusted_device_enabled,
            trusted_device_days: signIn.trusted_device_days,
          });
        } else if (challenges && signIn?.status === "mfa_enrollment_required") {
          if (
            typeof data.access_token !== "string" ||
            !data.access_token ||
            data.refresh_token
          )
            throw new Error("Invalid enrollment response");
          // A limited enrollment proof is not a completed session token.
          response = json({
            status: signIn.status,
            access_token: data.access_token,
            masked_email: signIn.masked_email,
            ...(organizations
              ? { organization_id: signIn.organization_id }
              : {}),
            mfa_enrollment_required: true,
          });
        } else {
          const failure = await installLoginSession(request, data, login);
          if (failure) return failure;
          response = json({ status: "authenticated" });
        }
      }
      // Includes trusted-device creation/expiry, independent of the Auth.js
      // cookie; a session cookie leaves only via its gate (#5399).
      for (const cookie of withoutSessionCookies(
        reply.backend?.headers?.getSetCookie?.() ?? [],
      ))
        response.headers.append("Set-Cookie", cookie);
      return response;
    } catch (error) {
      logger.error("login_failed", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      captureBffException(error, request);
      return problemResponse(500, "Login unavailable", request);
    }
  });
}
