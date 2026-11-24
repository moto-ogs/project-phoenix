import { bffPath } from "./bff-fetch";
// The browser contract of the session routes. Go's generated answers stay
// on the server; the BFF sends only the fields named here.
import type { LoginRequest } from "./contract/auth-login.generated";
import type { passkeyLoginOptionsRequest } from "./contract/auth-passkeys.generated";
import type {
  StaffPreviewEndRequest,
  StaffPreviewStartRequest,
  StaffPreviewStartResponse,
} from "./contract/auth-staff-preview.generated";
import type { SwitchTenantRequest } from "./contract/auth-switch-tenant.generated";
import type { catererLoginRequest } from "./contract/caterer-auth.generated";
import type { parentLoginRequest } from "./contract/parent-auth.generated";
import type { SchoolLoginRequest } from "./contract/school-auth.generated";
import type { confirmMFARequest } from "./contract/caterer-account.generated";
import type {
  MFAEnrollConfirmRequest,
  OperatorAcceptInvitationRequest,
  OperatorInvitationValidationResponse,
  OperatorLoginRequest,
  ValidateInvitationRequest,
} from "./contract/operator-auth.generated";
import type {
  TraegerLoginRequest,
  TraegerLoginResponse,
  TraegerMFAVerifyRequest,
} from "./contract/traeger-auth.generated";
import type {
  EnrollStartResponse,
  MFAResendResponse,
  MFAResendRequest,
  MFAVerifyRequest,
  PasskeyVerifyRequest,
  OperatorResponse,
  PasskeyCeremonyOptions,
} from "./contract/shared.generated";
import { portalAuthPath, type PortalKey } from "./portal-paths";
import { sessionPost as post, type SessionBffRoute } from "./session-bff-route";

export type SessionAuthenticated = { status: "authenticated" };

type ChallengeFields = Pick<
  TraegerLoginResponse,
  "masked_email" | "organization_id"
>;

export type SignInReply =
  | SessionAuthenticated
  | (ChallengeFields &
      Pick<
        TraegerLoginResponse,
        "trusted_device_enabled" | "trusted_device_days"
      > & {
        status: "mfa_required";
        challenge_token: NonNullable<TraegerLoginResponse["challenge_token"]>;
      })
  | (ChallengeFields & {
      status: "mfa_enrollment_required";
      /** Limited enrollment proof, never an access token for a session. */
      access_token: NonNullable<TraegerLoginResponse["access_token"]>;
      mfa_enrollment_required: true;
    })
  | {
      status: "organization_selection_required";
      organizations: NonNullable<TraegerLoginResponse["organizations"]>;
    };

export type OperatorInvitationFlow = { flow_id: string };

export type SessionRenewed = { session_renewed: boolean };

export type StaffPreviewReply = Pick<
  StaffPreviewStartResponse,
  "expires_in" | "target_account_id" | "target_name"
>;

type PasswordRequest = {
  tenant: LoginRequest;
  school: SchoolLoginRequest;
  traeger: TraegerLoginRequest;
  operator: OperatorLoginRequest;
  parent: parentLoginRequest;
  caterer: catererLoginRequest;
};

export type SessionLoginBody<P extends PortalKey = PortalKey> =
  PasswordRequest[P] & {
    /** BFF-only flag, stripped before the request reaches Go. */
    ignore_trusted_device?: boolean;
  };

type PasswordBody = { [P in PortalKey]: SessionLoginBody<P> };
type VerifyBody = {
  [P in PortalKey]: P extends "traeger"
    ? TraegerMFAVerifyRequest
    : MFAVerifyRequest;
};
type ConfirmBody = {
  [P in PortalKey]: P extends "operator"
    ? MFAEnrollConfirmRequest
    : VerifyBody[P];
};
type PasskeyOptionsBody = {
  [P in PortalKey]: P extends "tenant" ? passkeyLoginOptionsRequest : undefined;
};

type SessionPath = SessionBffRoute<unknown, unknown>["path"];

const loginPaths = {
  tenant: bffPath("tenant", "POST /auth/login"),
  school: bffPath("school", "POST /school/auth/login"),
  traeger: bffPath("org", "POST /traeger/auth/login"),
  operator: bffPath("platform", "POST /operator/auth/login"),
  parent: bffPath("parent", "POST /parent/auth/login"),
  caterer: bffPath("caterer", "POST /caterer/auth/login"),
} satisfies Record<PortalKey, SessionPath>;

const verifyPaths = {
  tenant: bffPath("tenant", "POST /auth/mfa/verify"),
  school: bffPath("school", "POST /school/auth/mfa/verify"),
  traeger: bffPath("org", "POST /traeger/auth/mfa/verify"),
  operator: bffPath("platform", "POST /operator/auth/mfa/verify"),
  parent: bffPath("parent", "POST /parent/auth/mfa/verify"),
  caterer: bffPath("caterer", "POST /caterer/auth/mfa/verify"),
} satisfies Record<PortalKey, SessionPath>;

const resendPaths = {
  tenant: bffPath("tenant", "POST /auth/mfa/resend"),
  school: bffPath("school", "POST /school/auth/mfa/resend"),
  traeger: bffPath("org", "POST /traeger/auth/mfa/resend"),
  operator: bffPath("platform", "POST /operator/auth/mfa/resend"),
  parent: bffPath("parent", "POST /parent/auth/mfa/resend"),
  caterer: bffPath("caterer", "POST /caterer/auth/mfa/resend"),
} satisfies Record<PortalKey, SessionPath>;

const enrollmentStarts = {
  tenant: bffPath("tenant", "POST /auth/mfa/enroll/start"),
  school: bffPath("school", "POST /school/auth/mfa/enroll/start"),
  traeger: bffPath("org", "POST /traeger/auth/mfa/enroll/start"),
  operator: bffPath("platform", "POST /operator/auth/mfa/enroll/start"),
  parent: portalAuthPath("parent", "mfa/enroll/start"),
  caterer: portalAuthPath("caterer", "mfa/enroll/start"),
};
const enrollmentConfirms = {
  tenant: bffPath("tenant", "POST /auth/mfa/enroll/confirm"),
  school: bffPath("school", "POST /school/auth/mfa/enroll/confirm"),
  traeger: bffPath("org", "POST /traeger/auth/mfa/enroll/confirm"),
  operator: bffPath("platform", "POST /operator/auth/mfa/enroll/confirm"),
  parent: portalAuthPath("parent", "mfa/enroll/confirm"),
  caterer: portalAuthPath("caterer", "mfa/enroll/confirm"),
};
const passkeyOptions = {
  tenant: bffPath("tenant", "POST /auth/passkeys/login/options"),
  operator: bffPath("platform", "POST /operator/auth/passkeys/login/options"),
  caterer: bffPath("caterer", "POST /caterer/auth/passkeys/login/options"),
};
const passkeyVerifies = {
  tenant: bffPath("tenant", "POST /auth/passkeys/login/verify"),
  operator: bffPath("platform", "POST /operator/auth/passkeys/login/verify"),
  caterer: bffPath("caterer", "POST /caterer/auth/passkeys/login/verify"),
};

// The other portals' logout only clears the BFF session and has no Go route.
function logoutPath(portal: PortalKey): SessionPath {
  if (portal === "tenant") return bffPath("tenant", "POST /auth/logout");
  if (portal === "operator")
    return bffPath("platform", "POST /operator/auth/logout");
  return portalAuthPath(portal, "logout");
}

export const sessionBff = {
  login: <P extends PortalKey>(portal: P) =>
    post<SignInReply, PasswordBody[P]>(loginPaths[portal]),
  verifyMfa: <P extends PortalKey>(portal: P) =>
    post<SessionAuthenticated, VerifyBody[P]>(verifyPaths[portal]),
  resendMfa: (portal: PortalKey) =>
    post<MFAResendResponse, MFAResendRequest>(resendPaths[portal]),
  startEnrollment: (portal: keyof typeof enrollmentStarts) =>
    post<EnrollStartResponse | null>(enrollmentStarts[portal]),
  confirmEnrollment: <P extends keyof typeof enrollmentConfirms>(portal: P) =>
    post<SessionAuthenticated, ConfirmBody[P]>(enrollmentConfirms[portal]),
  passkeyOptions: <P extends keyof typeof passkeyOptions>(portal: P) =>
    post<PasskeyCeremonyOptions, PasskeyOptionsBody[P]>(passkeyOptions[portal]),
  verifyPasskey: (portal: keyof typeof passkeyVerifies) =>
    post<SessionAuthenticated, PasskeyVerifyRequest>(passkeyVerifies[portal]),
  logout: (portal: PortalKey) => post<null>(logoutPath(portal)),
  switchTenant: post<null, SwitchTenantRequest>(
    bffPath("tenant", "POST /auth/switch-tenant"),
  ),
  startPreview: post<StaffPreviewReply, StaffPreviewStartRequest>(
    bffPath("tenant", "POST /auth/staff-preview"),
  ),
  endPreview: post<null, StaffPreviewEndRequest>(
    bffPath("tenant", "POST /auth/staff-preview/end"),
  ),
  confirmCatererFactor: post<SessionRenewed, confirmMFARequest>(
    bffPath("caterer", "POST /caterer/account/mfa/confirm"),
  ),
  confirmParentFactor: post<SessionRenewed, MFAVerifyRequest>(
    bffPath("parent", "POST /parent/me/mfa/confirm"),
  ),
  verifyTraegerStepUp: post<SessionRenewed, MFAVerifyRequest>(
    bffPath("org", "POST /traeger/auth/mfa/step-up/verify"),
  ),
  startOperatorInvite: post<
    OperatorInvitationFlow,
    Pick<ValidateInvitationRequest, "token">
  >("/api/operator/auth/invitations/session"),
  validateOperatorInvite: post<
    OperatorInvitationValidationResponse,
    ValidateInvitationRequest
  >(bffPath("platform", "POST /operator/auth/invitations/validate")),
  acceptOperatorInvite: post<OperatorResponse, OperatorAcceptInvitationRequest>(
    bffPath("platform", "POST /operator/auth/invitations/accept"),
  ),
};
