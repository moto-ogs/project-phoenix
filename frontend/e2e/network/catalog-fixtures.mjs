// Answers of the fake backend that reach a portal's catalog proxy (#2352).
// The proxy checks each answer against the route's generated contract and
// answers 502 on a mismatch; `catalog-fixtures.test.ts` decodes them in PR CI,
// so a contract change fails there instead of in the nightly E2E run.

// Reads that reach the API through a portal's catalog proxy, not a route
// file. Keyed by the backend path the proxy builds.
export const catalogReads = new Map([
  ["/caterer/schools", { caterer_name: "Fixture-Küche", schools: [] }],
  ["/parent/me/calendar", { from: "2026-11-02", to: "2026-11-08", events: [] }],
  ["/school/staff-messages/unread-count", { unread_count: 2, internal: 1 }],
  // The proxy builds the path from segments: no trailing slash.
  ["/school/supervisions", { instances: [] }],
  [
    "/operator/billing/key-day",
    {
      key_day: 15,
      next_key_date: "2026-12-15",
      updated_at: "2026-11-01T08:00:00Z",
      overrides: [],
    },
  ],
]);

// The shape of GET /api/me/profile in the contract.
export const profile = {
  id: "1",
  first_name: "Test",
  last_name: "Fixture",
  email: "fixture@example.invalid",
  username: null,
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  version: "2026-01-01T00:00:00Z",
};

// Two synthetic accounts. The second may switch schools (#8082); the first
// keeps the second-factor refusal of the MFA regression.
/** @type {Record<string, { first_name: string, last_name: string, email: string }>} */
export const fixtureAccounts = {
  1: {
    first_name: "Test",
    last_name: "Fixture",
    email: "fixture@example.invalid",
  },
  2: {
    first_name: "Bea",
    last_name: "Zweitkonto",
    email: "fixture-b@example.invalid",
  },
};

/**
 * The claims of a synthetic session, as POST /auth/session/validate answers
 * them. Identifiers travel as decimal strings.
 * @param {{ scope?: string, account?: string, tenant?: string, now: number }} claims
 */
export function sessionClaims({
  scope = "",
  account = "1",
  tenant = "1",
  now,
}) {
  // The second account administrates its school: it may open a staff preview.
  const admin = String(account) === "2" && scope === "";
  return {
    id: String(account),
    sub: String(account),
    scope,
    tenant_id: scope === "parent" ? undefined : String(tenant),
    org_id: "1",
    ...fixtureAccounts[account],
    roles: [
      scope === "school"
        ? "lehrkraft"
        : scope === "parent"
          ? "guardian"
          : "user",
    ],
    role_is_system: [false],
    permissions: admin ? ["admin:*"] : [],
    iat: now,
    exp: now + 3600,
  };
}

/**
 * A completed login of every portal (LoginResponse).
 * @param {string} token
 */
export const loginAnswer = (token) => ({
  status: "authenticated",
  access_token: token,
  refresh_token: token,
});

// The parent's children (#8082): one relationship can be revoked.
export const parentChildren = [
  {
    student_id: "11",
    tenant_id: "1",
    first_name: "Mira",
    last_name: "Muster",
    school_class: "2a",
    status: "active",
    school_name: "School A",
    school_slug: "school-a",
    care_ended: false,
  },
  {
    student_id: "12",
    tenant_id: "1",
    first_name: "Ben",
    last_name: "Beispiel",
    school_class: "3b",
    status: "active",
    school_name: "School A",
    school_slug: "school-a",
    care_ended: false,
  },
];

/**
 * The parents' family read (`GET /parent/me/family-start`, #8106): one card
 * per linked child of `children`, without features or today's status, for
 * the Berlin day `day`.
 *
 * @param {typeof parentChildren} children
 * @param {string} day
 */
export const familyStart = (children, day) => ({
  day,
  day_remaining_seconds: 3600,
  cards: children.map((child) => ({
    access_version: "fixture",
    child,
    features: null,
    today: null,
  })),
});

// The one person the administrating account may preview (#2893, #8082).
export const staffPreviewCandidates = [
  {
    account_id: "1",
    first_name: "Test",
    last_name: "Fixture",
    email: "fixture@example.invalid",
    roles: ["user"],
  },
];
