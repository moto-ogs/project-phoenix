import "server-only";
import type { CredentialsSignin } from "next-auth";
import { contractWrite } from "~/lib/contract/client.server";
import type { ContractBody } from "~/lib/contract/client.server";
import type { TokenResponse } from "~/lib/contract/shared.generated";
import { authLogger } from "./jwt-claims";
import { LOGIN_RATE_LIMITED, type LoginRefusalCode } from "~/lib/login-refusal";
import type { PasswordLogin, PortalDescriptor } from "./portals";

export type LoginOutcome =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; status?: number; code?: string };

/**
 * The password login of a portal's Credentials provider. Only status and
 * code leave this function; the backend body may name the account and is
 * never logged.
 */
export async function loginAtBackend(
  portal: PortalDescriptor,
  body: ContractBody<PortalDescriptor["backend"]["login"]>,
  request: Request | undefined,
): Promise<LoginOutcome> {
  try {
    const reply = await contractWrite(portal.backend.login, body, {
      request,
      timeout: "login",
    });
    if (!reply.ok) {
      if (!reply.backend && reply.error.status === 503) return { ok: false };
      const { status, code } = reply.error;
      authLogger.warn("portal_login_refused", {
        portal: portal.key,
        status,
        code,
      });
      return { ok: false, status, code };
    }
    const data = "data" in reply.value ? reply.value.data : reply.value;
    const status = reply.backend?.status;
    // A login that answers 200 with a further step is no session here.
    if (
      (typeof data?.status === "string" && data.status !== "authenticated") ||
      typeof data?.access_token !== "string" ||
      !data.access_token
    ) {
      const code = typeof data?.status === "string" ? data.status : undefined;
      authLogger.warn("portal_login_refused", {
        portal: portal.key,
        status,
        code,
      });
      return { ok: false, status, code };
    }
    return {
      ok: true,
      tokens: {
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? "",
      },
    };
  } catch (error) {
    authLogger.error("portal_login_unavailable", {
      portal: portal.key,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}

/**
 * The CredentialsSignin the login pages read by its `code`. Imported on use:
 * next-auth's entry pulls in next/server, which only resolves inside Next.
 */
async function credentialsRefusal(
  code: LoginRefusalCode,
): Promise<CredentialsSignin> {
  const { CredentialsSignin } = await import("next-auth");
  const error = new CredentialsSignin();
  error.code = code;
  return error;
}

export async function refusalFor(
  login: PasswordLogin,
  outcome: Extract<LoginOutcome, { ok: false }>,
): Promise<CredentialsSignin> {
  if (outcome.status === 429) return credentialsRefusal(LOGIN_RATE_LIMITED);
  const named = login.refusals.find((code) => code === outcome.code);
  return credentialsRefusal(named ?? "identity.invalid_credentials");
}
