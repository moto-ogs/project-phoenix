# Frontend API and server boundaries

Read before changing API clients, route handlers, server-only imports, env URL
resolution, or response mapping. Paths beginning with `src/` are relative to
`frontend/`; `lib/`, `app/`, and wrapper filenames start at `frontend/src/`.
`.claude/`, `frontend/`, and `docs/` paths start at the repository root.
Env files are relative to `frontend/`.

## Environment & API URLs — Fail Fast, No Defaults

Required values fail fast through `src/env.js` and `src/lib/env-validation.js`.
Read `.claude/rules/env-docker-sync.md` for the canonical exceptions and change
checklist. Local values belong in `.env.local` using `.env.example` as the template.

| Variable                           | Scope           | Purpose                                                       |
| ---------------------------------- | --------------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | Client + Server | Public backend URL; validated, read by no frontend code       |
| `API_URL`                          | Server only     | Backend URL for route handlers (Docker: `http://server:8080`) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | Server          | NextAuth base URL + JWT secret                                |
| `SKIP_ENV_VALIDATION`              | Build           | `true` skips env validation (Docker builds)                   |

**`getServerApiUrl()`** (`lib/server-api-url.ts`) returns the startup-validated `process.env.API_URL` — no fallback chain; never `NEXT_PUBLIC_API_URL` on the server. Every server call to the backend goes through `sendBackend` (`lib/backend-client.server.ts`), its only reader: base URL, bearer, client identity, timeout, log line and metric in one place. Browser code calls only the BFF under `/api/`.

### Server-Only Import Isolation (`.server.ts`)

Server-only wrappers carry a `.server.ts` suffix (`lib/route-wrapper.server.ts`, `lib/api-helpers.server.ts`, `lib/operator/route-wrapper.server.ts`, `lib/parent/route-wrapper.server.ts`).

Read the existing server-only wrappers and keep server auth/env imports out
of client components. Modules outside `src/server/`, `src/app/api/` and
`*.server.ts` import nothing from `src/server/`, not even a type
(dependency-cruiser rule `browser-not-to-server-auth`, #5005); the auth
modules there carry `import "server-only"`. A dynamic import is not itself an authorization or
server-only boundary; inspect the caller and execution path.

The same applies to `auth` and any other server-only import in mixed files.

## Architecture Patterns

One way across the seam: a Go route registered with `common.RouteContract`,
generated types and decoders, one catalog proxy per portal, a named
`route.ts` only for browser-specific behavior. Steps and ownership:
[new API route](new-route.md).

### Generated contract (ADR 0270)

A backend route that is registered in Go has generated TypeScript types and
zod decoders in `lib/contract/<resource>.generated.ts`. Never edit these files
or write a `Backend*` interface for a registered route.

- Registering, mounting and regenerating: [new API route](new-route.md).
  `TestTheCommittedContractIsCurrent` (`backend/cmd`) and the backend quality
  job fail on a stale file.
- A portal forwards its backend routes through one catalog proxy, so a new
  backend route needs no pass-through `route.ts`. `app/api/proxy-routes.test.ts`
  fails on a `route.ts` whose only code is `proxyGet(...)` and its siblings.
- Read a registered route with `contractGet` (`lib/contract/client.server.ts`).
  It returns the decoded value or a typed failure with status, registry code
  and request ID; rethrow `error.cause` so the handler boundary forwards the
  backend error unchanged. An answer outside the contract is a 502, never an
  empty value.
- Write to a registered route with `contractWrite` (same file): it takes the
  generated route entry, checks the body against the route's request type at
  compile time and decodes the answer like `contractGet`. A request type has
  only optional fields, because Go reads an absent key as the zero value;
  what is required stays Go's `Bind` and reaches the client through the error
  contract.
- A portal other than `tenant` uses its own route wrapper with the same
  helpers; the route entry names its portals.
- Identifiers leave the decoder as strings. A registered enum is typed as its
  known values but decodes any string; narrow it with `knownEnum`.
- A day is a `calendar.Date`, an instant a `time.Time`. A string field that
  carries a day or a wall-clock time says so in its tag: `contract:"date"`
  (`YYYY-MM-DD`) or `contract:"clock"` (`HH:MM`); the decoder then rejects
  another form. Closed value sets are registered in `Enums`.
- An identifier is a `common.ID` (`ident.ID` outside `http` roles), a count
  an `int`; the generator rejects a bare `int64` and a response shape that
  depends on a query parameter. Every answer sends identifiers as strings,
  and the generated decoder (`int64String`) takes nothing else (ADR 0300).
  The backend routes without a contract only shrink:
  `scripts/check-contract-shrink.mjs <base>` fails on a new one. A route the contract cannot carry
  (a sign-in step, a device or webhook endpoint) needs a new ADR that names
  its catalog line.
- In a request type an identifier is a `string`; Go still reads a JSON number
  there. A request type with its own `UnmarshalJSON` needs an entry in
  `Readers` (`backend/api/route_contracts.go`), or the generator stops;
  `ReadsLaxIDs` is for a request only.
- Removing or renaming a registered field or route needs one release as
  deprecated (`DeprecatedFields`, `Deprecated`);
  `scripts/check-contract-compat.mjs <base>` fails otherwise.


#### Portal proxy (#2352)

A registered route without behavior of its own in the BFF needs no route
file. Each portal has one proxy, a catch-all route built by the `catalogProxy`
of its route wrapper (`lib/contract/catalog-proxy.server.ts`):

| Portal | Proxy route under `app/api/` | BFF path → backend | `portalRoutes` key |
|---|---|---|---|
| Staff (tenant) | `[...path]` | `/api/x` → `/api/x` | `tenant` |
| Parents | `parent/[...path]` | `/api/parent/x` → `/parent/x` | `parent` |
| moto schule | `school/[...path]` | `/api/school/x` → `/school/x` | `school` |
| Träger | `traeger/[...path]` | `/api/traeger/x` → `/traeger/x` | `org` |
| Caterer | `caterer/[...path]` | `/api/caterer/x` → `/caterer/x` | `caterer` |
| Operator | `operator/[...path]` | `/api/operator/x` → `/operator/x` | `platform` |

The key is the scope claim of the portal's session token
(`common.PortalScope`).

- The allowlist is `portalRoutes.<key>` in the generated
  `lib/contract/portals.generated.ts`: the routes whose registration names
  the portal. A path outside it is a 404 before the session is read and
  before any backend call.
- Only the registered query parameters are forwarded, every path segment is
  encoded again, and the answer is checked against the route's decoder.
  Session, the single 401 renewal, body limit and `Idempotency-Key` come
  from the portal's handlers (`makePortalHandlers`). The answer is the
  backend's envelope with the decoded data: `{ status, data, message }`, a
  paginated list also `pagination`, as `common.Response` writes them.
- The BFF path must equal the backend path below the portal's prefix. A
  route whose BFF path differs (`/api/operator/provisioning/schools` for
  `/operator/schools`) moves its callers to the backend's path first.
- Next prefers an existing route file over the proxy. Keep a file only for
  what is specific to the browser: portal policy, session handling, a file
  or upload with behavior the contract cannot name (reshaping, several
  backend calls), login/MFA, the SSE pipe, or an aggregation without a Go view.
- A file answer registers `File: true`, a multipart upload `Multipart: true`
  with `MaxBodyBytes` and `TooLargeCode` (ADR 0270, addendum 2026-11-19).
  The proxy streams both unread: the file with the headers of
  `fileResponse`, every answer `private, no-store`; the upload once, without
  a retry after a renewal, and 413 with `TooLargeCode` above the limit. Such
  a route has no entry in `src/test/private-download-routes.ts`. The backend
  names the file's `Content-Type` and `Content-Disposition` itself; the proxy
  adds no fallback. A BFF-side ID, query or format check moves to the Go
  handler, and the client sends the backend's parameters and body as they are.
  A file the browser may keep (an avatar, the Träger logo, whose address names
  its version) registers `PrivateCache: true`; the handler sets its private
  Cache-Control, and the proxy passes it on only for such a route and only
  when it says `private` and not `public`. Every refusal stays
  `private, no-store`.
- A file of the portal `public` (a token link) needs `PublicFile`, the reason
  its link alone may open it; the generator refuses an unmarked public file,
  a public upload, and a marker on any other route. The proxy fetches it
  without session, bearer, body and `Idempotency-Key`, `sendBackend` adds the
  client IP for the backend's limiter of the link, and every answer is
  `private, no-store` (ADR 0270, addendum "Öffentliche Datei-Routen"). The
  link's path prefix needs log redaction in `lib/log-redaction.ts` and
  `backend/middleware/log_redaction.go`.
- A file the browser may keep names its Cache-Control in `FileCache`, one
  of the reviewed `FileCache*` values; a public value needs `PublicFile`.
  `ConditionalGet` forwards `If-None-Match`/`If-Modified-Since` and hands a
  304 back with `ETag` and `Last-Modified`. Only the served file keeps the
  value; refusals stay `private, no-store` (ADR 0270, addendum of
  2026-11-20). `FileCache` takes precedence over `PrivateCache` when both
  are present. A subscription address that predates its backend path is a
  `beforeFiles` rewrite in `next.config.js`, never a route file.
- To move an old route file onto the proxy: register its Go route for the
  portal, regenerate and delete the route file. A file is deleted only when
  every method it exports is registered. `TestARegisteredRouteRunsBehindTheScopeOfItsOnePortal`
  (`backend/api`) fails when the route does not run behind that portal's
  scope middleware.
- A route file with a dynamic segment wins over the proxy too:
  `billing-families/[id]` answers `billing-families/debtor-number-format`.
  No route file may stand in front of a registered path, literal or dynamic;
  only the hand-off files below `/api/auth` that pass the request to
  `catalogProxyUnder` do. `app/api/catalog-route-selection.test.ts` fails
  otherwise.
- A route file that calls the backend itself must name at least one backend
  path the contract does not register (a sign-in step, a stream, a bundle);
  `app/api/route-backend-paths.test.ts` fails a file whose backend paths are
  all registered.
- Not served by a proxy: a route with response variants
  (`GET /api/students/`).
- A Go type two resources answer with (the staff portal and moto schule
  mount the same notification feed) is written once, in
  `lib/contract/shared.generated.ts`, and imported by both resource files.
- A route that answers 204 or the envelope without data registers
  `NoData: true` in place of a response type. Its decoder (`noData`) takes
  exactly those two answers, and the BFF answers `{ status: "success",
  data: null }` with the backend's message (a DELETE: 204).
- A client type reads an identifier as `string`, never `number`.

The registered routes are the entries of `portals.generated.ts`.

### Named route handlers

A route file exists only for behavior the catalog proxy cannot carry; the
list of allowed reasons is in [new API route](new-route.md#when-a-route-needs-its-own-routets).
Its handlers come from the portal's route wrapper: `makePortalHandlers(portal)`
(`lib/portal-handlers.server.ts`), bound once per portal in
`lib/route-wrapper.server.ts` (tenant) and
`lib/{operator,parent,school,caterer,traeger}/route-wrapper.server.ts` from
the portal object its entry module exports (`tenantPortal`, `parentPortal`,
…). The same object builds the portal's `catalogProxy`. A handler (`get`,
`post`, `put`, `patch`, `del`) runs inside the portal's `withAuth`, reads the
session, renews it once on a backend 401 and answers errors through
`handleApiError`. The helpers that read the session (`backendFetch`,
`forwardToBackend`, `runWithRenewal`) throw outside that wrapper;
`src/app/api/route-session-coverage.test.ts` runs every route and fails on a
session read outside it. Success answers the backend's envelope
`{ status: "success", data }` (`successResponse`, type `ApiResponse` in
`lib/api-envelope.ts`), a DELETE without a result answers 204, and a handler
may return a Response as it is. No BFF route invents another success
envelope (#2353). Public JSON routes use `createPublicJsonProxy`
(`lib/backend-proxy-route.server.ts`), login steps before a session
`authStepProxy` (`lib/auth-proxy.server.ts`). Do not move a route across
portal auth boundaries to share code. Streaming SSE uses its documented
exception in [the SSE contract](realtime.md).

No route file calls `fetch`; every backend call of a route file goes through
`sendBackend`. A file a named route answers goes through `fileResponse`
(`lib/file-response.server.ts`: streaming, the backend's file headers,
`nosniff` by default, `no-store` unless the route names a cache policy, a
backend error as its problem body). An upload the BFF must check before
forwarding uses `createFileUploadHandler` (`lib/file-upload-wrapper.server.ts`;
`settings/login-image` checks the image and purges the tenant cache).

Read the affected portal's route wrapper before changing a handler; retain the
affected endpoint's error contract. Logout forwards backend errors unchanged
even though the browser always clears its local session.

Context params are async in Next.js 16: `params: Promise<...>` — always `await`.

### Backend calls

Every backend call goes through `sendBackend` (`lib/backend-client.server.ts`):
base URL, bearer, one client identity set (`backendIdentityHeaders`: client
IP, User-Agent, analytics session, Vorgangskennung, frontend origin),
`cache: "no-store"`, Idempotency-Key, a header timeout from
`BACKEND_TIMEOUTS_MS` (90 s by default; login, logout, session upkeep and
public assets shorter), a refused `.`/`..` path segment, one log line and
metric. Without a session (`bearer` null: public routes, login steps,
refresh, token checks) the same path applies. The portal's `backendFetch`
binds it to the request's session: a backend 401 repeats once with the
renewed session. No session answers 401 "Unauthorized"; a renewal the backend
refused (revoked or foreign family, invalid refresh token) answers 401
"Token expired", so the browser signs out (#5194); a renewal that could not
be decided (refresh unreachable, timeout, 5xx) answers 503
`general.unavailable` and leaves the session as it is; a second 401 for the
renewed token is the backend's own answer and passes through. An unreachable
backend or a header timeout answers 503 `general.unavailable` everywhere.
Retry is on by default; every
route that carries the current password or a code (password change, e-mail
change, MFA off, confirm code, a declaration with the account password)
passes `retry: { off: "<reason>" }`, whichever helper sends it;
`src/app/api/credential-retry.test.ts` proves each sends it once after a 401.
The JSON of a call goes through `backendJson`: the portal handlers' `api`,
the catalog proxy and `contractGet`/`contractWrite` build on it and run
inside a portal route handler, whose retry policy applies. The SSE stream
and the cached tenant resolve call `sendBackend` without that wrapper; the
stream keeps its connection open past the header timeout. A route
param in a backend path is encoded (`requirePathSegmentParam`,
`encodeURIComponent`); a query key never replaces a route param. Why and
the full chain:
[Client IP and rate limits](contracts.md#client-ip-and-rate-limits).

### Errors, cache and Sentry

Backend error responses have one wire contract: the portal handlers
(`makePortalHandlers`, under the catalog proxy and every named route)
propagate `ApiResponseError` through `handleApiError`; the public JSON
proxies and file responses use `forwardBackendResponse`. These paths retain the
backend status, body bytes, `Content-Type`, and `Retry-After`. Do not parse and
rebuild an error body, infer status from an error string, or substitute a
message when the backend returned an empty body. Locally generated errors
(validation, missing session, network failure) are separate from backend
responses.

Cache policy (#4999): every BFF answer that is JSON or bodyless and sets no
`Cache-Control` of its own leaves as `private, no-store`
(`lib/private-no-store.ts`). The portal auth handlers
(`server/auth/route-handler.ts`), `forwardBackendResponse` and the public
proxy factories apply it; a route that builds its answer itself (login, MFA,
passkeys, demo access, invitations, Auth.js endpoints) wraps its handler in
`withPrivateNoStore`. `src/app/api/route-cache-policy.test.ts` fails for an
exported handler that is neither built by a policy factory nor listed with a
reason in its exception table, and for every re-export (`export * from`,
`export { GET } from`) in a route file. Files, images and event streams keep their own
headers. A private file a route file answers additionally uses
`withPrivateDownloadNoStore` around the outer portal handler and an entry in
`src/test/private-download-routes.ts` (empty: every private file is a catalog
route, answered `private, no-store` by the proxy). `route-cache-policy.test.ts`
scans file constructors and download paths for missing entries; the SSE routes
are its only `NON_DOWNLOAD_RESOURCES`.

Sentry ownership follows the same boundary: forwarding a backend HTTP error,
including 5xx, creates no BFF event. A caught network failure or BFF exception
uses `captureBffException(error, request)` once at the handler boundary so the
event carries the proxy-assigned `X-Request-ID`. `logger.error` records context
and a breadcrumb, never an event. Uncaught Next.js exceptions use
`onRequestError` in `src/instrumentation.ts`.

### API clients and data mapping

- `lib/{domain}-api.ts` — browser calls to the portal's BFF paths;
  `lib/{domain}-helpers.ts` — mapping to view types. A registered route's
  answer is typed with its generated type; identifiers already arrive as
  strings, `snake_case` maps to `camelCase` in the helper.

Inspect the domain's existing mapper, such as
[room response mapping](../../frontend/src/lib/room-helpers.ts), rather than
copying a generic mapper. Preserve nullability and date-vs-instant semantics.

### Auth Token Flow

Login (per portal — see `docs/agents/contracts.md`) returns access + refresh tokens with configured lifetimes; NextAuth stores them in the session; route handlers extract the token and forward it as `Authorization: Bearer`; refresh happens automatically on expiry. MFA can insert a challenge step between credentials and session. Invitation/password-reset token flows live at `app/invite/`, `app/[tenant]/(public)/invite/`, `app/reset-password/`, with API clients in `lib/invitation-api.ts` / `lib/invitation-helpers.ts` — use these instead of hitting backend routes directly.
