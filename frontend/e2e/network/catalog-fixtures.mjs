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
  id: 1,
  first_name: "Test",
  last_name: "Fixture",
  email: "fixture@example.invalid",
  username: null,
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
