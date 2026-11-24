import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { requiredEnum } from "./contract/known-enum";
import type * as sharedContract from "./contract/shared.generated";
import type { PortalKey } from "./portal-paths";
import {
  sessionBff,
  type SessionAuthenticated,
  type SessionBffRoute,
  type SessionLoginBody,
} from "./session-bff";
import { signInAnswer, type SignInAnswer } from "./sign-in-answer";

export type LoginScope = PortalKey;

export type MFAResult = SessionAuthenticated;

/**
 * A sign-in step: every portal's route answers `{ status, data }`, whether
 * the BFF answers it itself (password, code, enrollment confirmation) or
 * forwards the browser's proof (resend, enrollment start: `authStepProxy`;
 * the operator's start answers 204, `null`). The steps run without a session
 * (`public`); enrollment sends the login's enrollment token as its bearer.
 */
function postSignInStep<T, B>(
  route: SessionBffRoute<T, B>,
  body: NoInfer<B>,
  bearerToken?: string,
): Promise<T> {
  return bffJson("public", route, {
    body,
    ...(bearerToken && {
      headers: { Authorization: `Bearer ${bearerToken}` },
    }),
  });
}

interface LoginParams {
  email: string;
  password: string;
  tenantSlug?: string;
}

export async function login(
  scope: LoginScope,
  params: LoginParams,
): Promise<SignInAnswer> {
  // Tenant login requires a tenant slug. School login accepts one only for
  // a handoff from the OGS portal, where it pins a multi-school Lehrkraft to
  // the school they selected.
  const payload: SessionLoginBody =
    scope === "tenant" || (scope === "school" && params.tenantSlug)
      ? {
          email: params.email,
          password: params.password,
          tenant_slug: params.tenantSlug ?? "",
        }
      : { email: params.email, password: params.password };

  return signInAnswer(
    scope,
    await postSignInStep(sessionBff.login(scope), payload),
  );
}

interface VerifyParams {
  challengeToken: string;
  code: string;
  rememberDevice: boolean;
  /** The Träger the Träger-Portal login resolved (#4651). */
  organizationId?: string;
}

// The Träger-Portal names the Träger the login resolved when it redeems the
// code; the other portals have no such field.
function organizationField(organizationId?: string) {
  return organizationId ? { organization_id: organizationId } : {};
}

export async function verifyMFA(
  scope: LoginScope,
  params: VerifyParams,
): Promise<MFAResult> {
  const payload = {
    challenge_token: params.challengeToken,
    code: params.code,
    remember_device: params.rememberDevice,
    ...organizationField(params.organizationId),
  };
  return postSignInStep(sessionBff.verifyMfa(scope), payload);
}

interface ResendParams {
  challengeToken: string;
}

/**
 * resendChallenge re-issues an MFA email code AND returns the renewed
 * challenge JWT. Callers MUST swap their in-flight `challengeToken` for
 * the returned value before the next verify — the previous JWT will
 * expire on its own clock while the freshly emailed code is bound to
 * the new JWT's lifetime. (#1430 review round 2 — without this swap
 * users hit a dead end where the new code can't be verified.)
 */
export async function resendChallenge(
  scope: LoginScope,
  params: ResendParams,
): Promise<string> {
  const answer = await postSignInStep(sessionBff.resendMfa(scope), {
    challenge_token: params.challengeToken,
  });
  if (!answer?.challenge_token) {
    throw new ApiError("MFA resend returned no challenge token", 500);
  }
  return answer.challenge_token;
}

// ----- Enrollment (the login's enrollment token as Bearer) -----

/**
 * enrollStart mails the enrollment code. Tenant, school and Träger answer
 * with the challenge the code is bound to, and their confirm redeems exactly
 * that challenge; the operator answers 204 and returns null.
 */
export async function enrollStart(
  scope: LoginScope,
  bearerToken: string,
): Promise<string | null> {
  const answer = await postSignInStep(
    sessionBff.startEnrollment(scope),
    undefined,
    bearerToken,
  );
  if (scope === "operator") return null;
  if (!answer?.challenge_token) {
    throw new ApiError("Enrollment start returned no challenge token", 500);
  }
  return answer.challenge_token;
}

/**
 * enrollConfirm submits the emailed code. The BFF installs the session the
 * backend mints and answers with its status only.
 */
export async function enrollConfirm(
  scope: LoginScope,
  bearerToken: string,
  code: string,
  challengeToken: string | null,
  organizationId?: string,
): Promise<MFAResult> {
  const payload = {
    ...(challengeToken === null ? {} : { challenge_token: challengeToken }),
    code,
    remember_device: false,
    ...organizationField(organizationId),
  };
  return postSignInStep(
    sessionBff.confirmEnrollment(scope),
    payload,
    bearerToken,
  );
}

// ----- Self-service trusted devices (every portal) -----
//
// These and the admin calls below act for the signed-in account: their BFF
// routes read the session cookie, so no bearer token leaves the browser
// (#5005). Only enrollment above sends the login's enrollment token.

/** The remembered devices of a portal, through its catalog proxy (#2352). */
export async function listTrustedDevices(
  scope: LoginScope,
): Promise<sharedContract.TrustedDeviceDTO[]> {
  const devices = await (() => {
    switch (scope) {
      case "tenant":
        return bffJson("tenant", "GET /auth/mfa/trusted-devices");
      case "operator":
        return bffJson("platform", "GET /operator/auth/mfa/trusted-devices");
      case "parent":
        return bffJson("parent", "GET /parent/me/mfa/trusted-devices");
      case "school":
        return bffJson("school", "GET /school/auth/mfa/trusted-devices");
      case "caterer":
        return bffJson("caterer", "GET /caterer/auth/mfa/trusted-devices");
      case "traeger":
        return bffJson("org", "GET /traeger/auth/mfa/trusted-devices");
    }
  })();
  return devices ?? [];
}

export async function revokeTrustedDevice(
  scope: LoginScope,
  deviceId: string,
): Promise<void> {
  const params = { deviceId };
  switch (scope) {
    case "tenant":
      await bffJson("tenant", "DELETE /auth/mfa/trusted-devices/{deviceId}", {
        params,
      });
      return;
    case "operator":
      await bffJson(
        "platform",
        "DELETE /operator/auth/mfa/trusted-devices/{deviceId}",
        { params },
      );
      return;
    case "parent":
      await bffJson(
        "parent",
        "DELETE /parent/me/mfa/trusted-devices/{deviceId}",
        { params },
      );
      return;
    case "school":
      await bffJson(
        "school",
        "DELETE /school/auth/mfa/trusted-devices/{deviceId}",
        { params },
      );
      return;
    case "caterer":
      await bffJson(
        "caterer",
        "DELETE /caterer/auth/mfa/trusted-devices/{deviceId}",
        { params },
      );
      return;
    case "traeger":
      await bffJson(
        "org",
        "DELETE /traeger/auth/mfa/trusted-devices/{deviceId}",
        { params },
      );
      return;
  }
}

// ----- Admin-Override (Tenant-only; requires users:manage) -----

const MFA_ADMIN_OVERRIDES = ["none", "force_off", "force_on"] as const;

export type MFAAdminOverride = (typeof MFA_ADMIN_OVERRIDES)[number];

export interface MFAAdminState {
  enrolled: boolean;
  override: MFAAdminOverride;
}

function toMFAAdminState(state: {
  enrolled: boolean;
  override: string;
}): MFAAdminState {
  return {
    enrolled: state.enrolled,
    override: requiredEnum(MFA_ADMIN_OVERRIDES, state.override, "override"),
  };
}

export async function adminResetMFA(
  accountId: string,
  reason: string,
): Promise<void> {
  await bffJson("tenant", "DELETE /auth/accounts/{accountId}/mfa/", {
    params: { accountId },
    body: { reason },
  });
}

export async function adminGetMFAState(
  accountId: string,
): Promise<MFAAdminState> {
  return toMFAAdminState(
    await bffJson("tenant", "GET /auth/accounts/{accountId}/mfa/", {
      params: { accountId },
    }),
  );
}

export async function adminSetMFAOverride(
  accountId: string,
  override: MFAAdminOverride,
  reason: string,
): Promise<void> {
  await bffJson("tenant", "PUT /auth/accounts/{accountId}/mfa/override", {
    params: { accountId },
    body: { override, reason },
  });
}

// ----- Operator-side admin (Operator dashboard; same modal, different URLs) -----

export async function operatorAdminResetMFA(
  schoolId: string,
  accountId: string,
  reason: string,
): Promise<void> {
  await bffJson(
    "platform",
    "DELETE /operator/schools/{id}/accounts/{accountId}/mfa/",
    { params: { id: schoolId, accountId }, body: { reason } },
  );
}

/**
 * Resets the second factor of a Träger-Büro member (#4651). The membership,
 * not a school, scopes the operator's reset; the person sets the factor up
 * again at the next sign-in.
 */
export async function operatorAdminResetTraegerMFA(
  organizationId: string,
  accountId: string,
  reason: string,
): Promise<void> {
  await bffJson(
    "platform",
    "DELETE /operator/organizations/{id}/traeger-members/{accountId}/mfa",
    { params: { id: organizationId, accountId }, body: { reason } },
  );
}

/**
 * Resets the second factor of one caterer account (#4497), scoped by the
 * caterer, not a school. Its passkeys stay; the backend mails the caterer.
 */
export async function operatorAdminResetCatererMFA(
  catererId: string,
  accountId: string,
  reason: string,
): Promise<void> {
  await bffJson(
    "platform",
    "DELETE /operator/caterers/{id}/accounts/{accountId}/mfa",
    { params: { id: catererId, accountId }, body: { reason } },
  );
}

export async function operatorAdminSetMFAOverride(
  schoolId: string,
  accountId: string,
  override: MFAAdminOverride,
  reason: string,
): Promise<void> {
  await bffJson(
    "platform",
    "PUT /operator/schools/{id}/accounts/{accountId}/mfa/override",
    { params: { id: schoolId, accountId }, body: { override, reason } },
  );
}

// ----- Operator account-wide override (the "mailbox lockout" switch) -----

// The account-wide override lives outside any school — it applies
// across every tenant the account belongs to. Only the operator
// surface can read or write it; tenant admins must use the per-school
// override (which only affects their own tenant). See #1430 review
// round 2 for the threat model.

export async function operatorAdminGetGlobalMFAOverride(
  accountId: string,
): Promise<MFAAdminState> {
  return toMFAAdminState(
    await bffJson(
      "platform",
      "GET /operator/accounts/{accountId}/mfa/global-override",
      { params: { accountId } },
    ),
  );
}

export async function operatorAdminSetGlobalMFAOverride(
  accountId: string,
  override: MFAAdminOverride,
  reason: string,
): Promise<void> {
  await bffJson(
    "platform",
    "PUT /operator/accounts/{accountId}/mfa/global-override",
    { params: { accountId }, body: { override, reason } },
  );
}
