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
| `NEXT_PUBLIC_API_URL`              | Client + Server | Browser-accessible backend URL (axios `baseURL`)              |
| `API_URL`                          | Server only     | Backend URL for route handlers (Docker: `http://server:8080`) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | Server          | NextAuth base URL + JWT secret                                |
| `SKIP_ENV_VALIDATION`              | Build           | `true` skips env validation (Docker builds)                   |

**`getServerApiUrl()`** (`lib/server-api-url.ts`) returns the startup-validated `process.env.API_URL` — no fallback chain. Route handlers must use it; never `NEXT_PUBLIC_API_URL` on the server.

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

### Route Handlers (Next.js 16)

Every portal's route handlers come from one factory,
`makePortalHandlers(portal)` (`lib/portal-handlers.server.ts`), bound once per
portal in `lib/route-wrapper.server.ts` (tenant) and
`lib/{operator,parent,school,caterer,traeger}/route-wrapper.server.ts` from the
portal object its entry module exports (`tenantPortal`, `parentPortal`, …).
It builds handlers (`get`, `post`, …, `del`), pure proxies (`proxyGet`, …),
the verbatim `jsonProxy`, `proxyFile`/`downloadFile` and `proxyUpload`, all
inside the portal's response wrapper. The helpers that read the session
(`backendFetch`, `downloadFile`, `forwardToBackend`, `runWithRenewal`) throw
outside that wrapper; `src/app/api/route-session-coverage.test.ts` runs every
route and fails on a session read outside it. One response contract: data answers
`{ success, message, data }`, a DELETE without a result answers 204, the
envelope's `data` is unwrapped in one place, a handler may return a Response
as it is. Public JSON routes use `createPublicJsonProxy`
(`lib/backend-proxy-route.server.ts`), login steps before a session
`authStepProxy` (`lib/auth-proxy.server.ts`). Do not move a route across
portal auth boundaries to share code. Streaming SSE uses its documented
exception in [the SSE contract](realtime.md).

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
The JSON of a call goes through `backendJson`: the portal handlers' `api`
and the tenant's `apiGet`/`apiPost`/… in `lib/api-helpers.server.ts` are
projections of it and run inside a portal route handler, whose retry policy
applies. Only the SSE stream
and the cached tenant resolve fetch the backend themselves; they add
`clientIdentityHeaders(request.headers)` or the headers handed in. A route
param in a backend path is encoded (`requirePathSegmentParam`,
`encodeURIComponent`); a query key never replaces a route param. Why and
the full chain:
[Client IP and rate limits](contracts.md#client-ip-and-rate-limits).

Backend error responses have one wire contract: the portal handlers
(`makePortalHandlers`) propagate `ApiResponseError` through `handleApiError`;
the JSON proxies, file responses and the audited direct-fetch exceptions use
`forwardBackendResponse`. These paths retain the
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
headers. Private file responses additionally use `withPrivateDownloadNoStore`
around the outer portal handler. This explicit download policy sets
`Cache-Control: private, no-store` for every MIME type and error status, even
when the backend supplies a different cache policy. It does not read the
response body or change download headers, status or session cookies.

Sentry ownership follows the same boundary: forwarding a backend HTTP error,
including 5xx, creates no BFF event. A caught network failure or BFF exception
uses `captureBffException(error, request)` once at the handler boundary so the
event carries the proxy-assigned `X-Request-ID`. `logger.error` records context
and a breadcrumb, never an event. Uncaught Next.js exceptions use
`onRequestError` in `src/instrumentation.ts`.

The following response paths intentionally do not use the ordinary JSON
success wrapper. Their **backend errors still use the shared error path**:

| Route(s)                                                                                                                                                                                                                                                   | Success-path reason                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `api/sse/events`, `api/parent/sse/events`, `api/school/sse/events`                                                                                                                                                                                         | `proxySSEStream` preserves a live event stream and abort propagation; a buffered JSON wrapper would prevent streaming.      |
| `api/meal-plan/participants/export`, `api/statistics/export`, `api/students/day-log/export`                                                                                          | CSV/PDF export bytes and download headers must remain intact.                                                               |
| `api/staff/[id]/time-tracking/export`, `api/birthdays/staff-export`, `api/emergency/snapshot/export`, `api/guardians/payment-overview/export` | CSV/PDF export bytes and download headers must remain intact; portal auth stays distinct.                                   |
| `api/enrollment/phases/[id]/export`, `api/enrollment/admin/reports/care-usage/export`, `api/enrollment/admin/reports/class-roster/export`, `api/enrollment/admin/students/[studentId]/requests/export`                                                     | Enrollment export formats and filenames come from backend headers.                                                          |
| `api/import/{students,teachers,class-list-entries,opening-balances}/template`                                                                                                                                                                              | Template file bytes and backend filenames cannot be JSON-wrapped.                                                           |
| `api/parent/me/news/[announcementId]/attachments/[attachmentId]/download`                                                                                                                                                                                  | Parent attachment bytes retain disposition and `nosniff` headers; parent relationship authorization remains in the backend. |
| `api/parent-announcements/[announcementId]/declaration-export`, `api/parent/me/news/[announcementId]/declaration/proof/pdf`                                                                                                                                | Declaration exports and parent proof PDFs retain backend download headers and portal-specific session refresh behavior. |
| `api/public/enrollment-form-legal-documents/[filename]`, `api/public/enrollment-legal-documents/[filename]`, `api/public/login-image/[filename]`, `api/me/profile/avatar/[filename]`, `api/staff/[id]/avatar`, `api/students/[id]/photo/[filename]`        | Public or user image/PDF responses retain content-type and caching behavior.                                                |
| `api/calendar-feed/[token]`, `api/request-feed/[token]`                                                                                                                                                                                                    | iCalendar/RSS subscriptions retain their wire format and cache policy; the path token is the subscription credential.       |

### Private download inventory (#5119)

The route/method inventory for downloads with a route file lives in
`frontend/src/test/private-download-routes.ts`. Catalog file routes instead
use the portal proxy's private, uncached response. The download
rule in `route-cache-policy.test.ts` requires the explicit wrapper on each
entry; an ordinary JSON or portal wrapper does not satisfy it. It also scans
file constructors, file factories and download paths for missing entries.

| Private download family | Coverage and reason |
| --- | --- |
| Tenant exports | Students, birthdays, emergency snapshot, enrollment phase/reports/student requests, guardian payments, attendance history/day log, statistics, staff time tracking, rooms, shifts, timetable, surveys, holiday participants: school/person data, including CSV/PDF/XLSX. |
| Meal exports | Tenant meal plan participants/week/month orders, meal-caterer orders and caterer delivery lists: session-bound school/participant data. |
| Documents and proofs | Staff/student/folder files, announcement attachments/declarations, enrollment uploads and signed proofs, care/pickup proofs, parent inbox PDFs: personal data, including arbitrary binary and image attachments. |
| School and operator | School parent-letter declarations and operator billing counts: portal-bound exports, without changing their auth boundary. |
| Träger | Access log, billing exports/letters/preview/print, holiday registration export and form documents: organization-session-bound files. |
| Token-bound downloads | Enrollment signature proof, holiday-form documents and the payroll office's one-time month file (`public/payroll-download/[link]`, POST only so a mail scanner cannot spend the link): access-link scope is still private, even without a browser session. |
| Appointment ICS downloads | Tenant and parent single-appointment files are session-bound downloads, unlike subscription feeds. |

Non-download responses retain their existing policies. The reasoned resource
inventory is `NON_DOWNLOAD_RESOURCES` in `route-cache-policy.test.ts`:

| Excluded resource | Retained policy and reason |
| --- | --- |
| Public login images and enrollment legal/form PDFs | Public assets, `public, max-age=86400` or the form PDF's upstream policy. |
| Profile/staff avatars and student photos | Existing private image cache/revalidation policy; these are display resources, not exports. |
| Träger logo | Brand image through `proxyFile`, existing `no-store` policy. |
| Calendar and request subscription feeds | Existing `private, max-age=3600` and `private, no-store`, respectively; subscription wire format unchanged. |
| Tenant, parent and school SSE | Existing SSE headers, live streaming and abort behavior unchanged. |
| Parent declaration proof metadata | JSON, protected by the ordinary policy; the sibling `proof/pdf` is a private download. |

### Audited direct-fetch exceptions

The routes below still call `fetch` directly
because they stream non-JSON content, use the shared file-upload wrapper, or
perform a route-specific business/session adaptation. Client-visible backend
errors use `forwardBackendResponse`; the demo
readiness probe and optional profile prefetch are intentionally consumed by
their surrounding BFF flow.
A direct fetch outside this inventory needs a reason and a shared proxy path.

| Route under `app/api/` | Reason the transparent JSON factory is not used |
| --- | --- |
| `activities/[id]/supervisors/[supervisorId]` | Refreshes the session before forwarding; an exhausted refresh answers 401 with `general.permission`. |
| `announcement-attachments/[announcementId]` | Multipart attachment upload uses the shared file-upload validator. |
| `auth/login` | Relays login response cookies as well as the backend body. |
| `auth/logout` | Uses the tenant refresh token for revocation; the browser still clears its local session. |
| `birthdays/staff-export` | Streams the staff-birthday export file. |
| `calendar-feed/[token]` | Returns iCalendar text; the path token is the subscription credential. |
| `demo/access/handoff` | Checks readiness and returns a portal redirect, not backend JSON. |
| `demo/access/reset` | Validates a demo credential and maps a reset result to the entry URL. |
| `demo/access/sessions` | Accepts a link or cookie token and stores a new httpOnly demo cookie on success. |
| `demo/access/status` | Uses the shared demo-token forwarding helper for credential-scoped status. |
| `emergency/snapshot/export` | Streams emergency-snapshot export bytes and filename. |
| `enrollment/admin/reports/care-usage/export` | Streams the care-usage export with backend filename. |
| `enrollment/admin/reports/class-roster/export` | Streams the class-roster export with backend filename. |
| `enrollment/admin/students/[studentId]/requests/export` | Streams one student’s enrollment requests export. |
| `enrollment/form-bootstrap/public/[tenantSlug]/[phaseId]` | Combines public form metadata with optional session-backed profile prefetch. |
| `enrollment/legal-documents` | Multipart legal-document upload uses the shared file-upload validator. |
| `enrollment/phases/[id]/export` | Streams a phase export in its backend-selected format. |
| `files/folders/[folderId]/files` | Multipart folder-file upload uses the shared file-upload validator. |
| `guardians/payment-overview/export` | Streams payment-overview export bytes with backend disposition. |
| `import/class-list-entries/template` | Returns the class-list CSV template and backend filename. |
| `import/opening-balances/template` | Returns the opening-balance CSV template and backend filename. |
| `import/students/template` | Returns the student CSV template and backend filename. |
| `import/teachers/template` | Returns the teacher CSV template and backend filename. |
| `invitations/accept` | Maps signup fields and chooses the signed invitation-owner session when an existing account accepts. |
| `me/profile/avatar` | Validates image magic bytes and MIME before upload through the shared upload wrapper. |
| `me/profile/avatar/[filename]` | Serves avatar image bytes with MIME and cache headers. |
| `meal-plan/participants/export` | Streams meal-plan CSV bytes with the backend filename. |
| `parent/me/news/[announcementId]/attachments/[attachmentId]/download` | Streams a parent-authorized attachment with disposition and nosniff headers. |
| `parent-announcements/[announcementId]/declaration-export` | Streams a declaration PDF or CSV report with tenant-session refresh. |
| `parent/me/news/[announcementId]/declaration/proof/pdf` | Streams a parent-authorized declaration proof PDF with parent-session refresh. |
| `public/enrollment-form-legal-documents/[filename]` | Serves a public form PDF as a body stream. |
| `public/enrollment-legal-documents/[filename]` | Serves a public legal PDF with MIME validation and cache policy. |
| `public/login-image/[filename]` | Serves a public login image with MIME validation and cache policy. |
| `request-feed/[token]` | Returns RSS/XML with subscription-token scope and private no-store cache policy. |
| `school/auth/logout` | Uses the school refresh token, not the access token, to revoke the scoped session. |
| `settings/enrollment/legal-agb-document` | Multipart legal PDF upload uses the shared file-upload validator. |
| `settings/login-image` | Uploads validated tenant image data and invalidates the tenant cache. |
| `staff/[id]/avatar` | Returns image bytes, MIME type, and cache headers. |
| `staff/[id]/documents` | Multipart staff-document upload uses the shared file-upload validator. |
| `staff/[id]/time-tracking/export` | Streams one staff member’s time-tracking export. |
| `statistics/export` | Streams statistics export bytes with no-store caching. |
| `students/[id]/photo/[filename]` | Serves student photo bytes with MIME, cache headers and the 304 revalidation path. |
| `traeger/auth/logout` | Uses the Träger refresh token, not the access token, to revoke the `org` session. |

File routes of every portal answer through one builder, `fileResponse`
(`lib/file-response.server.ts`: streaming, the backend's file headers,
`nosniff` by default, `no-store` unless the route names a cache policy, a
backend error as its problem body). Routes without route-specific logic use
the factory instead of a direct fetch: downloads `proxyFile` (client
identity, one refreshed retry; the route wraps it in
`withPrivateDownloadNoStore`), uploads `proxyFileUpload`
(`lib/file-upload-wrapper.server.ts`: file validation, listed form fields,
client identity, one refreshed retry). Under `students/` the day-log export
is the one download left with a route file, beside the three uploads
(documents, photo, accident-report paper copy); the other student downloads
stream through the catalog proxy (#2352). `students/export` keeps a literal
catalog hand-off.

The three SSE routes (`sse/events`, `parent/sse/events`, and
`school/sse/events`) use `proxySSEStream` separately: each must keep its own
portal credential and abortable event stream, which a JSON factory would buffer.

Helper-backed custom handlers without a direct `fetch` have narrower reasons:
`statistics/report` whitelists audit-sensitive queries, retries refreshed
tenant sessions, and keeps its established no-store success envelope
(`students/day-log` and `students/[id]/attendance-history` forward only their
audit-sensitive query keys through `proxyGet` with `forwardQuery`);
`auth/token` renews the tenant session and answers 204 without a token;
`auth/staff-preview/end` takes the running preview's token from the session
cookie; `logs` and `parent/logs` ingest client
telemetry. `enrollment/legal-documents/[filename]` retries deletion with a
refreshed tenant token. `timetable/betreuungsplan/export`,
`timetable/lists/export`, `rooms/export`, `staff-shifts/export`,
`calendar/appointments/[appointmentId]/ics`, and
`parent/calendar/appointments/[appointmentId]/ics` retain downloadable bytes
and headers. The remaining helper-backed routes use their portal's
`create*Handler` or `proxy*` factories, including the operator and parent
wrappers; they are not handwritten auth/fetch/error loops.

The student wire shape lives in `lib/student-wire.ts`; the browser client
`lib/student-api.ts` maps the catalog proxy's answers onto `Student` objects.
Demo handoff produces a redirect after checking readiness. An exhausted
auth refresh/retry answers 401 with `general.permission`. All other
backend errors in those routes retain the shared error contract. Logout
forwards backend errors unchanged even though the browser always clears its
local session.

Read [the tenant route wrapper](../../frontend/src/lib/route-wrapper.server.ts)
and the affected portal's wrapper before changing a handler. Existing consumers
such as [the rooms export route](../../frontend/src/app/api/rooms/export/route.ts) show the
request/response wiring; retain the affected endpoint's error contract.

Context params are async in Next.js 16: `params: Promise<...>` — always `await`.

### API Clients & Data Mapping

- `lib/{domain}-api.ts` — backend calls; `lib/{domain}-helpers.ts` — type mapping
- Backend `int64` IDs → frontend `string` (`data.id.toString()`); `snake_case` → `camelCase`
- Paginated lists arrive as `{ status, data, pagination: { current_page, page_size, total_pages, total_records } }` (`PaginatedResponse<T>` in `lib/api.ts`)

Inspect the domain's existing mapper, such as
[room response mapping](../../frontend/src/lib/room-helpers.ts), rather than
copying a generic mapper. Preserve nullability and date-vs-instant semantics.

### Generated contract (ADR 0270)

A backend route that is registered in Go has generated TypeScript types and
zod decoders in `lib/contract/<resource>.generated.ts`. Never edit these files
or write a `Backend*` interface for a registered route.

- Register a route in its owner's `http` role (`StudentRouteContracts` in
  `backend/modules/presenceprojection/http/student_contracts.go` is the
  example) and add its mount in `backend/api/route_contracts.go`.
- Regenerate with `scripts/run-go-toolchain.sh go -C backend run . gencontract`.
  `TestTheCommittedContractIsCurrent` (`backend/cmd`) and the backend quality
  job fail on a stale file.
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
- A new identifier is a `common.ID`, a count an `int`; the generator rejects a
  bare `int64` and a response shape that depends on a query parameter.
- In a request type an identifier is a `string`, except a field Go still
  reads only as a JSON number (`NumericIDs`): that one is a `number`. A
  request type with its own `UnmarshalJSON` needs an entry in `Readers`
  (`backend/api/route_contracts.go`), or the generator stops.
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
  Session, the single 401 renewal, body limit, `Idempotency-Key` and the
  response envelope come from the portal's handlers (`makePortalHandlers`).
- The BFF path must equal the backend path below the portal's prefix. A
  route whose BFF path differs (`/api/operator/provisioning/schools` for
  `/operator/schools`) moves its callers to the backend's path first.
- Next prefers an existing route file over the proxy. Keep a file only for
  what is specific to the browser: portal policy, session handling, a file
  or upload with behavior of its own (own cache header, BFF checks, public
  token link), login/MFA, the SSE pipe, or an aggregation without a Go view.
- A file answer registers `File: true`, a multipart upload `Multipart: true`
  with `MaxBodyBytes` and `TooLargeCode` (ADR 0270, addendum 2026-11-19).
  The proxy streams both unread: the file with the headers of
  `fileResponse`, every answer `private, no-store`; the upload once, without
  a retry after a renewal, and 413 with `TooLargeCode` above the limit. Such
  a route has no entry in `src/test/private-download-routes.ts`.
- To move a pure proxy route: register its Go route for the portal,
  regenerate, delete the route file and its row in
  `src/test/proxy-routes/**`. A file is deleted only when every method it
  exports is registered. `TestARegisteredRouteRunsBehindTheScopeOfItsOnePortal`
  (`backend/api`) fails when the route does not run behind that portal's
  scope middleware.
- A route file with a dynamic segment wins over the proxy too:
  `billing-families/[id]` answers `billing-families/debtor-number-format`.
  Such a registered route keeps a literal route file that hands the request
  to `catalogProxy` (see that Träger route);
  `app/api/catalog-route-selection.test.ts` fails when one is missing.
- Not served by a proxy: a route with response variants
  (`GET /api/students/`).
- A Go type two resources answer with (the staff portal and moto schule
  mount the same notification feed) is written once, in
  `lib/contract/shared.generated.ts`, and imported by both resource files.
- A route that answers 204 or the envelope without data registers
  `NoData: true` in place of a response type. Its decoder (`noData`) takes
  exactly those two answers, and the BFF answers `data: null` (a DELETE: 204).
- An identifier in `NumericIDs` leaves the proxy as a string, whatever Go
  sends. A client type for such a route reads `string`, never `number`.

The registered routes are the entries of `portals.generated.ts`.

### Auth Token Flow

Login (per portal — see `docs/agents/contracts.md`) returns access + refresh tokens with configured lifetimes; NextAuth stores them in the session; route handlers extract the token and forward it as `Authorization: Bearer`; refresh happens automatically on expiry. MFA can insert a challenge step between credentials and session. Invitation/password-reset token flows live at `app/invite/`, `app/[tenant]/(public)/invite/`, `app/reset-password/`, with API clients in `lib/invitation-api.ts` / `lib/invitation-helpers.ts` — use these instead of hitting backend routes directly.
