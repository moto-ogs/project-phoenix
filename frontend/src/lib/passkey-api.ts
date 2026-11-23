import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import type * as sharedContract from "./contract/shared.generated";
import type { PortalKey } from "./portal-paths";
import { sessionBff, type SessionAuthenticated } from "./session-bff";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { hasSessionAccess } from "./session-access";
import { getCachedSession } from "./session-cache";

export type PasskeyScope = Extract<
  PortalKey,
  "tenant" | "operator" | "caterer"
>;

/** The options of a ceremony; the backend may wrap them in `publicKey`. */
function extractOptions<TOptions>(
  response: sharedContract.PasskeyCeremonyOptions,
): TOptions {
  const maybeWrapped = response.options as { publicKey?: TOptions };
  return maybeWrapped.publicKey ?? (response.options as TOptions);
}

/**
 * Passkey management acts for the signed-in account. Its BFF routes read the
 * session cookie; the browser holds no token (#5005).
 */
async function requireSession(): Promise<void> {
  if (!hasSessionAccess(await getCachedSession())) {
    throw new ApiError("Nicht angemeldet.", 401);
  }
}

const PASSKEY_ERROR = "Passkey-Anfrage fehlgeschlagen.";

/**
 * The login options: a step before the session, whose route forwards the
 * browser's request (`authStepProxy`) and answers `{ status, data }`.
 */
function requestLoginOptions(
  scope: PasskeyScope,
  tenantSlug: string,
): Promise<sharedContract.PasskeyCeremonyOptions> {
  return bffJson("public", sessionBff.passkeyOptions(scope), {
    body: { tenant_slug: tenantSlug },
    errorMessage: PASSKEY_ERROR,
  });
}

export function isPasskeyCeremonyIncompleteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // WebAuthnError from @simplewebauthn/browser takes the name of the
  // browser's DOMException, so the name identifies a cancelled ceremony.
  return error.name === "AbortError" || error.name === "NotAllowedError";
}

export function isPasskeySupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function loginWithPasskey(
  scope: PasskeyScope,
  params: { tenantSlug?: string } = {},
): Promise<SessionAuthenticated> {
  const start = await requestLoginOptions(scope, params.tenantSlug ?? "");
  const assertion = await startAuthentication({
    optionsJSON: extractOptions<PublicKeyCredentialRequestOptionsJSON>(start),
  });
  return finishPasskeyLogin(scope, start.session_id, assertion);
}

/** The sign-in step of the BFF: it installs the session (`public`). */
async function finishPasskeyLogin(
  scope: PasskeyScope,
  sessionID: string,
  response: AuthenticationResponseJSON,
): Promise<SessionAuthenticated> {
  return bffJson("public", sessionBff.verifyPasskey(scope), {
    body: { session_id: sessionID, response },
    errorMessage: PASSKEY_ERROR,
  });
}

export async function startPasskeyEnrollment(
  scope: PasskeyScope,
): Promise<sharedContract.PasskeyEnrollmentChallenge> {
  await requireSession();
  const options = { errorMessage: PASSKEY_ERROR };
  switch (scope) {
    case "tenant":
      return bffJson(
        "tenant",
        "POST /auth/passkeys/enrollment/challenge",
        options,
      );
    case "operator":
      return bffJson(
        "platform",
        "POST /operator/auth/passkeys/enrollment/challenge",
        options,
      );
    case "caterer":
      return bffJson(
        "caterer",
        "POST /caterer/auth/passkeys/enrollment/challenge",
        options,
      );
  }
}

function registerOptions(
  scope: PasskeyScope,
  body: sharedContract.PasskeyRegisterOptionsRequest,
): Promise<sharedContract.PasskeyCeremonyOptions> {
  // A wrong mailed code answers 401 identity.mfa_code_invalid: it refuses
  // this step and leaves the session as it is.
  const options = {
    body,
    errorMessage: PASSKEY_ERROR,
    authRefusals: ["identity.mfa_code_invalid"] as const,
  };
  switch (scope) {
    case "tenant":
      return bffJson("tenant", "POST /auth/passkeys/register/options", options);
    case "operator":
      return bffJson(
        "platform",
        "POST /operator/auth/passkeys/register/options",
        options,
      );
    case "caterer":
      return bffJson(
        "caterer",
        "POST /caterer/auth/passkeys/register/options",
        options,
      );
  }
}

function registerVerify(
  scope: PasskeyScope,
  body: sharedContract.PasskeyRegisterVerifyRequest,
): Promise<sharedContract.PasskeyCredentialSummary> {
  // An expired ceremony refuses registration, not the signed-in session.
  const options = {
    body,
    errorMessage: PASSKEY_ERROR,
    authRefusals: ["identity.passkey_login_failed"] as const,
  };
  switch (scope) {
    case "tenant":
      return bffJson("tenant", "POST /auth/passkeys/register/verify", options);
    case "operator":
      return bffJson(
        "platform",
        "POST /operator/auth/passkeys/register/verify",
        options,
      );
    case "caterer":
      return bffJson(
        "caterer",
        "POST /caterer/auth/passkeys/register/verify",
        options,
      );
  }
}

export async function registerPasskey(
  scope: PasskeyScope,
  params: { code: string; name: string },
): Promise<sharedContract.PasskeyCredentialSummary> {
  await requireSession();
  const start = await registerOptions(scope, {
    code: params.code,
    name: params.name,
  });
  const registration = await startRegistration({
    optionsJSON: extractOptions<PublicKeyCredentialCreationOptionsJSON>(start),
  });
  return registerVerify(scope, {
    session_id: start.session_id,
    name: params.name,
    response: registration,
  });
}

export async function listPasskeys(
  scope: PasskeyScope,
): Promise<sharedContract.PasskeyCredentialSummary[]> {
  await requireSession();
  const options = { errorMessage: PASSKEY_ERROR };
  const passkeys = await (() => {
    switch (scope) {
      case "tenant":
        return bffJson("tenant", "GET /auth/passkeys/", options);
      case "operator":
        return bffJson("platform", "GET /operator/auth/passkeys", options);
      case "caterer":
        return bffJson("caterer", "GET /caterer/auth/passkeys", options);
    }
  })();
  return passkeys ?? [];
}

export async function revokePasskey(
  scope: PasskeyScope,
  id: string,
): Promise<void> {
  await requireSession();
  const options = { params: { passkeyId: id }, errorMessage: PASSKEY_ERROR };
  switch (scope) {
    case "tenant":
      await bffJson("tenant", "DELETE /auth/passkeys/{passkeyId}", options);
      return;
    case "operator":
      await bffJson(
        "platform",
        "DELETE /operator/auth/passkeys/{passkeyId}",
        options,
      );
      return;
    case "caterer":
      await bffJson(
        "caterer",
        "DELETE /caterer/auth/passkeys/{passkeyId}",
        options,
      );
      return;
  }
}
