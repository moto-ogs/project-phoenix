import type { SessionClaimsResponse } from "~/lib/contract/auth-session.generated";

/** A successful Go session check; individual tests override the session facts. */
export function sessionClaims(
  overrides: Partial<SessionClaimsResponse> = {},
): SessionClaimsResponse {
  return {
    id: "7",
    roles: ["user"],
    role_is_system: [true],
    permissions: [],
    iat: 1,
    exp: 4102444800,
    ...overrides,
  };
}
