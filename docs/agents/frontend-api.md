# Frontend API and server boundaries

Read before changing API clients, route handlers, server-only imports, env URL
resolution, or response mapping. Paths beginning with `src/` are relative to
`frontend/`; `lib/`, `app/`, and wrapper filenames start at `frontend/src/`.
`.claude/`, `frontend/`, and `docs/` paths start at the repository root.
Env files are relative to `frontend/`.

## Browser calls

Browser JSON calls to routes with a shared entry use
`bffJson(portal, route, options)` (`lib/bff-fetch.ts`, #7806). `route` is the
catalog key of a registered route for the portal, or the BFF entry of a
session step. A catalog entry types `params`, `query`, `body` and the answer. The
import is type-only, so no decoder reaches the browser bundle: the catalog
proxy or named route file has decoded the Go answer already.

| Portal | Example | In the code |
|---|---|---|
| Staff (`tenant`) | `bffJson("tenant", "GET /api/students/{id}/partial-absences", { params: { id }, query: { from, to } })` | [`student-partial-absences-api.ts`](../../frontend/src/lib/student-partial-absences-api.ts) |
| Parents (`parent`) | `bffJson("parent", "GET /parent/me/notifications/feed/", { query: { limit, cursor } })` | [`notification-feed-api.ts`](../../frontend/src/lib/notification-feed-api.ts) `parentNotificationFeedApi` |
| moto schule (`school`) | `bffJson("school", "GET /school/notifications/feed/", { query: { limit, cursor } })` | [`notification-feed-api.ts`](../../frontend/src/lib/notification-feed-api.ts) `schoolNotificationFeedApi` |
| Träger (`org`) | `bffJson("org", "GET /traeger/notifications/feed/unread-count")` | [`notification-feed-api.ts`](../../frontend/src/lib/notification-feed-api.ts) `traegerNotificationFeedApi` |
| Caterer (`caterer`) | `bffJson("caterer", "POST /caterer/notifications/feed/{id}/read", { params: { id } })` | [`notification-feed-api.ts`](../../frontend/src/lib/notification-feed-api.ts) `catererNotificationFeedApi` |
| Operator (`platform`) | `bffJson("platform", "GET /operator/invitations/")` | [`operator-invitation-api.ts`](../../frontend/src/lib/operator/operator-invitation-api.ts) |
| Ohne Sitzung (`public`) | `bffJson("public", "GET /auth/invitations/{token}", { params: { token } })` | [`invitation-api.ts`](../../frontend/src/lib/invitation-api.ts) `validateInvitation` |

The path is the pattern below the portal's BFF prefix, a route outside the
portal's mount (`/analytics-policy`) below the prefix as a whole; a trailing
slash is dropped and each parameter encoded.

- **Answer:** the `data` of the envelope; a paginated list resolves to
  `{ data, pagination }`; a route without data and a 204 resolve to `null`.
- **Query:** use the types in the route entry, not pre-serialized values.
  For `GET /api/students/{id}/partial-absences`, `params.id` is a string,
  and `query.from` and `query.to` are `YYYY-MM-DD` strings. The same
  rules apply to `bffFile`: `id` and `string` take strings, `int` takes a
  number, and `bool` takes a boolean. Registered string choices narrow the
  type; repeated keys take arrays. The catalog proxy forwards registered
  keys without validating or changing their values. Go validates them.
- **Variants:** a route with response variants (`GET /api/students/`) takes
  the variant in its query (`query: { view: "names" }`), and the answer has
  that variant's type; without it the route's default variant.
- **Missing `data`:** a 2xx answer without a `data` member
  is an `ApiError` 502, `general.write_answer_unreadable` for a write (as
  `decodeContract`). There is no fallback value.
- **Failure:** an `ApiError` with the backend's code, field errors and
  request ID. `errorMessage` sets its message, so a client keeps its text.
- **`public`:** the routes without a session (links, password reset,
  invitations) go without gate and renewal; a pattern names its portal
  (`/caterer/…` → `/api/caterer/…`), one under `/api` stays as it is.
- **401:** one table in `bff-fetch.ts` holds where the portals differ. Staff:
  the session gate before the request and, for replayable calls, one renewal with a retry
  (`requireTenantSession`, `renewTenantSession` in `lib/session-cache.ts`),
  or sign-out if renewal fails; `authRefusals` names codes that refuse
  only the operation. Operator: to `/operator/login`. Parents: to
  `/parents/login`, except for the call's explicit `authRefusals` (e.g. a
  wrong MFA confirmation code or current password). Träger, moto schule and
  caterer: the error stays on the page. A parent client that reports refusals
  (`PARENT_ACCESS_REFUSED_EVENT`) catches the `ApiError` itself.
- **Route files:** use the generated key if the BFF keeps the Go path and
  envelope. For session steps, use the shared BFF entry from
  [`session-bff.ts`](../../frontend/src/lib/session-bff.ts), for example
  `bffJson("public", sessionBff.login(scope), { body })`. The session route
  and its client share `SignInReply`; the Go session tokens are not part of
  this type. Use `bffJsonUncontracted` only for the remaining callers and
  reasons in the [BFF boundary rules](../../frontend/scripts/oxlint-plugin-bff-boundary.mjs).
  `bff-boundary/only-listed-uncontracted` rejects access outside that list
  and forwarding the helper, including renamed imports and re-exports.
  Each entry permits exactly one call for a file, portal, method and address.
  A second call or an unused entry fails lint. The enrollment bootstrap adds
  the Staff profile in its named route until #5018.
  Only `session-bff.ts` can import the session route constructor. Routes
  that live only in the BFF use keys checked against their route files.
- **Wait:** a refusal with `Retry-After` (429, 503) carries the wait as
  `retryAfterSeconds` on the `ApiError` (`apiErrorFromResponse`).
- **Keepalive cleanup:** `keepalive: true` starts the request immediately.
  Staff cleanup skips the browser session gate and its 401 renewal, because
  that lookup cannot outlive an unloading page. The BFF authenticates the
  cookie as usual; a refusal still reaches the caller as its `ApiError`.
- **Lists Go writes as `null`:** the generated type says so (`T[] | null`).
  Read it as an empty list where the screen needs one, once, in the client
  (`slot-lists-api.ts` derives `WithLists<…>` from the generated type); do not
  copy the answer into a hand-written type.
- **One transport:** use `bffJson` for JSON and `bffFile` for files.
  `bff-boundary/no-raw-browser-transport` rejects access to global `fetch`,
  `XMLHttpRequest`, `navigator.sendBeacon`, `EventSource` and `WebSocket`
  outside the same plugin's
  shrink-only infrastructure list. It also rejects names of retired fetch
  helpers. `bff-boundary/no-numeric-identifier` rejects coercions such as
  `Number(room.id)`, `+room.id`, arithmetic and `BigInt(id)`. For generated
  fields the Go contract's kind wins over the name; where an ordinary string
  has no contract provenance, ID-shaped names are a fallback. Keep IDs as
  text and use `compareIds` for ordering decimal IDs without rounding.
  All three rules run in `pnpm run check`.
  `frontend/scripts/backend-wire-types.mjs` (run by
  `frontend/scripts/backend-wire-types.node-test.mjs`)
  finds hand-written wire types by their form (two `snake_case` fields of
  their own in an interface, object alias or union branch, a generated type
  imported under another name, a type that only
  renames a generated one); its baseline only shrinks.
- **Tests:** a client test stubs the global `fetch` and mocks the session
  gate with
  `vi.mock("~/lib/session-cache", () => import("~/test/mocks/plain-session-fetch"))`;
  answers of a paginated route carry `pagination` (`pagedJson`), plain
  answer objects become Responses through `plainResponse`/`plainFetch`.
- **Files:** a route registered with `File: true` is called with
  `bffFile(portal, route, options)` from the same module: the same path,
  portal table and ApiError, resolving to the successful `Response` whose
  body and `Content-Disposition` the caller reads. A link the browser opens
  itself (`<a href>`, image or navigation) uses `bffFileHref(portal, route,
  { params, query })`. It accepts only registered GET file keys with their
  typed path parameters and query. For other registered addresses use `bffPath(portal, key, { params, query })`.
  Do not assemble a registered BFF address separately.
- **Deploy skew:** every call names its bundle's `NEXT_DEPLOYMENT_ID`, and
  the proxy refuses a call from another deployment with 412
  `general.route_not_found` before any route runs (`lib/deployment-skew.ts`).
  The tab then reloads by itself unless a typed-in form is on screen, a
  dialog is open or a navigation guard is active; only then the caller shows
  the „neue Version“ message (`lib/deployment-reload.ts`).

## Environment & API URLs — Fail Fast, No Defaults

Required values fail fast through `src/env.js` and `src/lib/env-validation.js`.
Read `.claude/rules/env-docker-sync.md` for the canonical exceptions and change
checklist. Local values belong in `.env.local` using `.env.example` as the template.

| Variable                           | Scope           | Purpose                                                       |
| ---------------------------------- | --------------- | ------------------------------------------------------------- |
| `API_URL`                          | Server only     | Backend URL for route handlers (Docker: `http://server:8080`) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | Server          | NextAuth base URL + JWT secret                                |
| `SKIP_ENV_VALIDATION`              | Build           | `true` skips env validation (Docker builds)                   |

**`getServerApiUrl()`** (`lib/server-api-url.ts`) returns the startup-validated `process.env.API_URL` — no fallback chain; never `NEXT_PUBLIC_API_URL` on the server. Every server call to the backend goes through `sendBackend` (`lib/backend-client.server.ts`), its only reader: base URL, bearer, client identity, timeout, log line and metric in one place. Depcruise (`backend-only-through-send-backend`) rejects importing `server-api-url.ts` elsewhere; oxlint (`backend-url/only-server-api-url`) rejects reading `API_URL` from `process.env` or `~/env` outside it. Browser code calls only the BFF under `/api/`.

### Server-Only Import Isolation (`.server.ts`)

Server-only wrappers carry a `.server.ts` suffix (`lib/route-wrapper.server.ts`, `lib/operator/route-wrapper.server.ts`, `lib/parent/route-wrapper.server.ts`).

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
  rejects retired forwarding helpers even in a route with its own code, and
  checks the whole production source tree for registered BFF addresses
  built from literals, concatenations, templates, constants or helper returns.
  The host router’s incoming-path comparisons are not address builders.
- In named routes, layouts and server modules, read with
  `contractGet(entry, options)`; write with
  `contractWrite(entry, body, options)`. Import the entry from its
  generated resource file. The entry types the address and write body and decodes the
  full answer, with or without an envelope. A malformed answer is a 502,
  never an empty value. A request type has optional fields because Go
  reads absent keys as zero values; Go's `Bind` still validates the body.
  A read with response variants selects its decoder and answer type from the
  query, or uses the registered default when the variant is omitted:

  ```ts
  import { contractGet } from "~/lib/contract/client.server";
  import { routes } from "~/lib/contract/students.generated";

  const reply = await contractGet(routes["GET /api/students/"], {
    token,
    query: { view: "names" },
  });
  ```

- Pass `token` when the caller holds the bearer, or omit it for a public
  or pre-session step. Pass typed `params`; the entry supplies the backend
  path. For a named browser route with registered query keys, pass the incoming
  `request` so the transport forwards them. Other server calls pass typed
  `query`. There is no endpoint override. For a session-bound route that
  uses `backendFetch`, hand that transport to the contract helper as
  `send`; it keeps the portal's renewal policy.
- Return `contractResponse(reply, request)` for decoded JSON that the BFF
  forwards. If the route projects the answer, return
  `contractError(reply, request)` on refusal, then project the decoded
  value. In a portal handler that owns error handling, rethrow
  `reply.error.cause`. See
  [school switching](../../frontend/src/app/api/auth/switch-tenant/route.ts):
  the route decodes the token pair, installs it and returns only
  `successResponse(null)`.
- A portal other than `tenant` uses its own route wrapper with the same
  helpers; the route entry names its portals.
- Import generated wire types for closed fields, including nested
  snapshots and maps. An `unknown` value is intentionally open only where
  `contract_json` on the Go field explains the protocol or configuration
  that determines its shape. Narrow such values at the point of use.
  A typed response may also carry a documented `LegacyJSON` alternative
  when recorded data predates the typed shape.
- An open enum names the values this build knows but accepts any string;
  narrow it with `knownEnum`.
- A day is a `calendar.Date`, an instant a `time.Time`. A string field that
  carries a day or a wall-clock time says so in its tag: `contract:"date"`
  (`YYYY-MM-DD`) or `contract:"clock"` (`HH:MM`); the decoder then rejects
  another form. Closed value sets are registered in `Enums`.
- An identifier is an `ident.ID` in every role, a count an `int`; the
  generator rejects a bare `int64`. Use a discriminator in the response
  body or a separate path for a second shape. Only legacy
  `GET /api/students/` registers query-selected variants. Identifiers travel
  as decimal strings and decode with
  `int64String` (ADR 0300). An identifier-shaped field that carries genuine
  text instead stays a string, with a Go `contract_text` reason.
  A sign-in step or another route its portal's route file serves is typed
  too (`RouteFile`) and stays out of every proxy allowlist. `BrowserPath`
  exposes its exact same-origin address to `bffPath`; without it, only the
  server can use the Go key. `BrowserOwnContract` excludes the key from
  `bffJson` when the route file changes the request or answer. If the route
  file uses another HTTP method, name it in `BrowserMethod` (demo status). The catalog
  lines outside the contract (`Outside`: a device, webhook or protocol
  endpoint) only shrink: `scripts/check-contract-shrink.mjs <base>` fails on
  a new one unless a new ADR names its catalog line
  ([new route](new-route.md#routes-outside-the-contract)).
- In a request type an identifier is a `string`; Go rejects a JSON number
  for an `ident.ID` at the HTTP boundary. A request type with its own
  `UnmarshalJSON` needs an entry in `Readers`
  (`backend/api/route_contracts.go`), or the generator stops; an own reader
  does not make an `int64` an identifier.
- Removing or renaming a registered field or route needs one release as
  deprecated (`DeprecatedFields`, `Deprecated`);
  `scripts/check-contract-compat.mjs <base>` fails otherwise. Typing an open
  request field in place needs `contract_refines:"<compatibility evidence>"`
  and a reader that either accepts the previous input domain or already
  rejected everything outside the new shape. Expand first when callers need
  to move to a new wire shape.


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
  `lib/contract/portals.generated.ts`. It contains only the portal's proxied
  registrations; named handlers are listed separately in `routeFileRoutes`.
  A path outside the allowlist is a 404 from the proxy before it reads the
  session or calls the backend.
- Only the registered query parameters are forwarded, every path segment is
  encoded again, and the answer is checked against the route's decoder.
  The portal's handlers (`makePortalHandlers`) supply the session and
  the single 401 renewal. The catalog proxy forwards `Idempotency-Key`
  for POST, PUT and PATCH. The answer is the
  backend's envelope with the decoded data: `{ status, data, message }`, a
  paginated list also `pagination`, as `common.Response` writes them.
  The proxy retains the backend's success status for every method. A
  backend 204 still goes through the decoder and remains bodyless; a
  data-bearing DELETE with no answer fails with 502. The proxy
  and the server contract client share JSON reading: unreadable 2xx
  answers (including truncated JSON) are 502. After a write that may
  have committed, they carry `general.write_answer_unreadable`; reads
  and routes marked `NoCommit` keep the retryable error.
- The catalog proxy uses the backend path below the portal's prefix. A
  named `RouteFile` can instead register an exact `BrowserPath`. Both the
  file link and the browser transport use that path.
- Next prefers an existing route file over the proxy. Keep a file only for
  what is specific to the browser: portal policy, session handling, a file
  or upload with behavior the contract cannot name, login/MFA, or the SSE
  pipe. Reshaping or aggregating reads for a screen belongs in a Go view;
  see [when a route needs its own file](new-route.md#when-a-route-needs-its-own-routets).
- A file answer registers `File: true`, a multipart upload `Multipart: true`
  with `MaxBodyBytes` and `TooLargeCode` (ADR 0270, addendum 2026-11-19).
  The proxy streams both unread: the file with the headers of
  `fileResponse`, with `private, no-store` by default; the upload once, without
  a retry after a renewal, and 413 with `TooLargeCode` above the limit. Such
  a route needs no BFF route file. The backend
  names the file's `Content-Type` and `Content-Disposition` itself; the proxy
  adds no fallback. A BFF-side ID, query or format check moves to the Go
  handler, and the client sends the backend's parameters and body as they are.
  A file the browser may keep (an avatar, the Träger logo, whose address names
  its version) registers `PrivateCache: true`; the handler sets its private
  Cache-Control, and the proxy passes it on only for such a route and only
  when it says `private` and not `public`. Every refusal stays
  `private, no-store`.
- A file of the portal `public` (a token link) needs `PublicFile`, the reason
  its link alone may open it; the generator refuses an unmarked public file
  and a marker on any other route. A public multipart upload needs its own
  `PublicUpload` reason as well as the usual size limit and error code.
  The two enrollment uploads register this in
  `backend/modules/enrollment/http/public_route_contracts.go`. The proxy
  sends them without a session or bearer. The proxy fetches a public file
  without session, bearer, body and `Idempotency-Key`, `sendBackend` adds the
  client IP for the backend's limiter of the link, and every answer is
  `private, no-store` unless the route declares `FileCache` (ADR 0270,
  addendum "Öffentliche Datei-Routen"). The
  link's path prefix needs log redaction in `lib/log-redaction.ts` and
  `backend/middleware/log_redaction.go`.
- A file the browser may keep names its Cache-Control in `FileCache`, one
  of the reviewed `FileCache*` values; a public value needs `PublicFile`.
  `ConditionalGet` on a public or session GET file with `FileCache`
  forwards `If-None-Match`/`If-Modified-Since` and hands a
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
- A route file with a dynamic segment can shadow the proxy too. No route
  file may stand in front of a path on the catalog proxy allowlist except
  an Auth.js hand-off that uses `catalogProxyUnder`. Hand-offs live under
  the relevant portal's `auth` path, not just `/api/auth`.
  `app/api/catalog-route-selection.test.ts` checks the route selection.
- A route file that calls the backend itself must name at least one backend
  path outside the catalog proxy allowlists, such as a `RouteFile` sign-in
  step or an `Outside` stream. `app/api/route-backend-paths.test.ts` fails a
  file whose backend paths are all on the allowlists.
- A route with response variants (`GET /api/students/`) names its
  `variantParam`; the proxy decodes the answer with the variant the query
  asks for, else the default variant.
- A Go type two resources answer with (the staff portal and moto schule
  mount the same notification feed) is written once, in
  `lib/contract/shared.generated.ts`, and imported by both resource files.
- A route that answers 204 or the envelope without data registers
  `NoData: true` in place of a response type. Its decoder (`noData`) takes
  exactly those two answers. A 204 remains bodyless. Other success statuses
  keep their status and answer `{ status: "success", data: null }` with the
  backend's message, including for DELETE.
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
`runWithRenewal`) throw outside that wrapper;
`src/app/api/route-session-coverage.test.ts` runs every route and fails on a
session read outside it. Success answers the backend's envelope
`{ status: "success", data }` (`successResponse` in
`lib/route-wrapper-utils.server.ts`, type `ApiResponse` in `lib/api-envelope.ts`), a DELETE without a result answers 204, and a handler
may return a Response as it is. No BFF route invents another success
envelope (#2353); a sign-in step the BFF answers itself (password, code,
enrollment confirmation, second factor) answers `successResponse` too.
Pre-session steps that forward a limited proof use `authStepProxy`: it calls
`contractWrite` with the generated entry and wraps its decoded answer in
`successResponse`. A 204 stays bodyless. A `RouteFile` JSON answer must
pass through the generated decoder; `route-backend-paths.test.ts` rejects
a raw call. The demo access route files decode their conditional backend
`RouteFile` contracts with `contractGet` or `contractWrite` before wrapping
plain successes. Browser calls build their addresses with `bffPath` but
keep the route file's browser-facing payload and method. Do not move a route across
portal auth boundaries to share code. Streaming SSE uses its documented
exception in [the SSE contract](realtime.md).

No route file calls `fetch`; both contract helpers go through `sendBackend`. A file a named route answers goes through `fileResponse`
(`lib/file-response.server.ts`: streaming, the backend's file headers,
`nosniff` by default, `no-store` unless the route names a cache policy, a
backend error as its problem body). The login-image upload uses the catalog
multipart path: Go validates the file, while the proxy bounds transport bytes
and clears the school's lookup after a successful write.

Go owns validation of the domain request. Two named adapters check or map
only what they need to assemble that request:

- Tenant and operator school settings writes check the registry key's path
  segment before forwarding from `settings/values/[key]`. They keep the
  existing 400 for malformed segments; Go decides which keys and values are
  allowed. The named handlers invalidate the tenant cache after a write.
- `/api/invitations/accept` adapts the browser form to Go's
  `/auth/invitations/{token}/accept`: it moves the token to the encoded path,
  maps the camelCase form fields and resolves an owner session only for
  existing-account acceptance. Go validates the invitation and form values.

Use `problemResponse` directly from `lib/api-response-error.server.ts`.

Read the affected portal's route wrapper before changing a handler; retain the
affected endpoint's error contract. Logout uses the same error policy. If the
request gets no answer, the browser keeps the session and offers a retry. A
401 means there is no active session to revoke. Other failures that get an
HTTP answer end the local session and show that server revocation could not be
confirmed.

Context params are async in Next.js 16: `params: Promise<...>` — always `await`.

### Own time-tracking reads (#8078, #8081)

Use the three tenant entries in `time-tracking.generated.ts` with `bffJson`.
They need `time_tracking:own` and Zeiterfassung and infer the staff member
from the session. Do not send a staff ID. The standard catalog proxy forwards
each read once on a live session; there is no page-specific proxy.

- `period?view=week|month&start=YYYY-MM-DD`: pass a Monday or month start.
  `start` to `end` is the displayed period. `week_start` to `week_end` is
  the full ISO-week span used for session and labor warnings. A night block
  can begin before either span. `days` covers every displayed day;
  `has_target: false` means the target is unknown, not zero. Observe the
  selected block's `version` when saving a correction (ADR 0311).
  Only a month request carries `month_summary`. Its
  `planned_shift_state` governs `planned_shift_minutes`: show a missing
  plan only when the state is `ready` and minutes are absent. Hide the shift
  comparison when `not_booked`; show a load failure when `unavailable`.
- `overview`: current Berlin day, open block with pauses, today's absence
  warning and assignments, ten weekday chart points, clock subtotals and
  current week/month figures. `as_of` timestamps the figures; the client may
  advance the live clock without fetching history. `account_balance_minutes:
  null` means the account has not started. Do not enable stamping on a failed
  read: a null session or absence is authoritative only in a success.
- `leave-overview`: current Berlin year, quota, four counts, eight recent
  non-question requests at most, all open questions, own allowances and the
  initial mail outcomes. When `mails.state` is `ready`, use
  `mails.awaiting_feedback` to decide if fast polling of the existing small
  mail read is needed (#8094). Load the full year's absences and the
  absence-type catalog only when their dialogs need them.

For shifts, `not_booked` means Dienstplan is off; `unavailable` is a read
failure. Assignments remain part of Basis and have a separate read status.
For assignments and mail as well, only `ready` can mean an empty result.
The page opens the three RAM-only `useSWRAuth` families in parallel. The
period key uses the view and its canonical Berlin start, never previous data.
The clock and leave keys use the Berlin day and year. The page uses the shell's
known missing-profile state to avoid any own reads; a real authorization failure
is not the missing-profile state.

On a write, one short invalidation burst combines the local response and SSE
echo. Its predicate refreshes mounted readers and expires affected cached
periods without fetching them. `staff_leave_changed` invalidates the same
time views as `staff_time_tracking_changed`, plus leave and the open vacation
form's year list. Both are contentless tenant signals (ADR 0310). Timetable
events update the clock's assignments; a closing-day change also affects the
period. A reconnect reconciles all three. No historic period polls. The chart
and clock advance today's actual time from the snapshot and its open block,
not a second history reader. Only advance the week and month totals when
`today_counts_in_totals` is true.

The Admin table and the home assignment card still have their original reads.
The session editor receives the selected block and the rejecting
`revalidateOrThrow` of that period (ADR 0311). Action-bound reads keep their
existing routes: audit history, export, annual absence overlap and the
absence-type catalog. Run the seeded GET budget with
`PERF_PORT=<native-frontend-port> pnpm run perf:render time-tracking.perf.ts`
in `frontend/`; only the seeded measurement accepts `PERF_BASELINE=1` for
the pre-#8081 page.

### Backend calls

Every backend call goes through `sendBackend` (`lib/backend-client.server.ts`):
base URL, bearer, one client identity set (`backendIdentityHeaders`: client
IP, User-Agent, analytics session, Vorgangskennung, frontend origin),
`cache: "no-store"`, Idempotency-Key, a timeout from `BACKEND_TIMEOUTS_MS`
(90 s for headers by default; login, logout and public assets shorter;
session upkeep has 5 s for headers and body), a refused `.`/`..` path
segment, one log line and metric. Without a session (`bearer` null: public
routes and login steps) the same path applies. The portal's `backendFetch`
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
sets `NoRetryAfterRenewal` for a catalog route or passes
`retry: { off: "<reason>" }` to the named route's session transport;
`src/app/api/credential-retry.test.ts` proves the credential goes out once
after a 401. `contractGet` and `contractWrite` send once by default. Only a
portal's session transport or wrapper can renew and repeat the call.
In the browser, the staff client does not renew or replay a multipart call
or a route marked `NoRetryAfterRenewal` after a 401. A logout cleanup can
pass `skipAuthRecovery: true` to send the usual typed call with cookies but
without the browser's session gate, renewal or login redirect.
The Staff shell reads its startup data through the generated decoders;
a failed optional read is left out so the browser can load it normally.
`tenant-resolve.server.ts` uses the public `GET /auth/tenant/resolve`
entry without a session. Its own per-replica cache coalesces concurrent
lookups and keeps decoded successes and 404s for 60 seconds. Explicit
invalidation clears both; other failures are not cached. The unregistered SSE
stream uses `sendBackend` directly and keeps its connection open past the
header timeout. Before streaming begins, connection failures use
`handleApiError`, like the named and catalog JSON routes. A route
param in a backend path is encoded by `fillRoutePath` for a contract call;
encode it with `encodeURIComponent` when building an unregistered path.
A query key never replaces a route param. Why and
the full chain:
[Client IP and rate limits](contracts.md#client-ip-and-rate-limits).

### Errors, cache and Sentry

Backend error responses have one wire contract: the portal handlers
(`makePortalHandlers`, under the catalog proxy and every named route)
and public JSON proxies propagate `ApiResponseError` through `handleApiError`;
file responses use `forwardBackendResponse`. Both retain status
and `Retry-After` and replace 5xx bodies with safe Problem Details. The
forwarder streams other error bodies with their content type; the handler
instead replaces invalid or empty bodies and adds the BFF request ID to a
valid problem when it is missing. Use these helpers rather than
rebuilding errors in each route. Locally generated errors
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
headers. The catalog serves private files. `route-cache-policy.test.ts`
checks file constructors and download paths; only the SSE routes are
listed as `NON_DOWNLOAD_RESOURCES`.

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

### First display in a protected page

Load eligible first-display reads in the server page, not in a link handler
or on the first browser mount. Use
[`SWRServerSeed`](../../frontend/src/lib/swr/server-seed.tsx) with the existing
reader's key and mapper. Resolve the fresh snapshot for the actual portal
before the reads. In a tenant page, use `readTenantPageContext` to bind the
cookie to the host and resolved school. Go still checks the resource's
permissions and relationships. Keep any server fetches out of shared caches.

Use `seedRead` and `readContract` for each independently retriable answer.
Mark only entries needed for initial HTML as `render` and keep the seed
under the page's loading boundary. Use `claims` for known keys so a client
navigation waits for the same answer instead of starting a second GET.
Missing, refused and timed-out entries fall back to their existing browser
reader and its error UI. Pass only the displayed projection across RSC.
Keep bearer tokens and raw backend errors on the server.

The shell seeds only its own readers. An audited opening, a read with side
effects, a write preview, an edit, a download or a read for later local
interaction is not a seed. See [ADR 0311](../adr/0311-ein-speichern-traegt-den-gelesenen-stand.md).

### Auth Token Flow

Go sends the access and refresh tokens to the BFF, not to the browser.
Auth.js stores them in the encrypted httpOnly cookie. Server handlers forward
the bearer to Go and renew it as needed. For password, MFA, and passkey
steps, see [Login, refresh, and MFA](contracts.md#login-refresh-and-mfa). Invitation/password-reset token flows live at `app/invite/`, `app/[tenant]/(public)/invite/`, `app/reset-password/`, with API clients in `lib/invitation-api.ts` / `lib/invitation-helpers.ts` — use these instead of hitting backend routes directly.

### Mail delivery polling

Enrollment, appointment and absence readers reconcile quiet results every five
minutes and when the tab regains focus. Delivery's `awaiting_feedback` keeps
the 15-second cadence (30 seconds for absences) only while a send is active.
Plain SMTP or fallback acceptance stays **accepted**, not delivered, and uses
the slow cadence. A tracked provider acceptance waits up to 24 hours; a
provider-reported delay follows Delivery's five-day limit. Settled chats stop
polling; new messages refresh their mail status.
