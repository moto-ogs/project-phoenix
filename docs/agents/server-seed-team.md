# Team portal server seed inventory (#8079)

Scope: `frontend/src/app/[tenant]`, excluding `database/**`, `students/search`,
`home`, `active-supervisions`, `time-tracking` and `anfragen`. The protected
routes below require the current Team portal school session on its canonical
host unless noted. A named permission or paid module narrows that gate; the
Go handler still enforces school, account and object access. URL parameter
names below are inputs, not authorization.

**Seeded** means the server runs the same generated GET and puts its
browser projection under the existing reader key. A failed seed leaves the
browser's original error and retry path in charge. **Deferred** means an
opening, audit, side effect, write draft, later interaction or download makes
speculative reads wrong. Nothing below changes #8085's supervision cache or
#8082's protected-tree lifecycle.

## Protected routes

| Route | First readers, inputs and gate | Disposition |
| --- | --- | --- |
| `/absences` | Status-day overview: Berlin today/range, search, group, state and page; `users:read` plus group reach. | **Deferred**: `status_day_overview_handlers.go` calls `writeStatusDayOverviewAudit` before responding. |
| `/activities` | Activity list, categories and optional own staff in one key; detailed presence, booked NFC, `activities:list` or `activities:read`. | **Seeded** catalog, categories and own staff under the aggregate key. Participant lists and edits are later openings. |
| `/admin/change-requests` | Redirect to `/anfragen`; no separate read. | No page resource. |
| `/admin/enrollments` | Phases, form schemas, all requests, change requests, settings schema and own `enrollment_submitted` e-mail switch; online enrollment, `config:manage`. | **Seeded** initial keys including phase expiry warnings and per-phase offering counts. Counts use one school catalog GET when phases exist; only the grouped totals cross RSC. |
| `/admin/enrollments/[id]` | Request by ID, form labels, outgoing mail and review data; `config:manage`. | **Deferred**: the main GET marks this request read; the subsequent labels and mail depend on the opened request. Signature proof and uploads are downloads. |
| `/admin/enrollments/change-requests` | Redirect to `/anfragen`; no list of its own. | No page resource. |
| `/admin/enrollments/change-requests/[id]` | Change request by ID; `canReviewEnrollmentChangeRequests`, online enrollment. | **Seeded** request and form labels once the authorized request provides the real request ID. No request-detail opening. |
| `/admin/enrollments/phases/[phaseId]` | Phase list, phase-filtered requests, response overview, school classes, default care usage and occupancy; online enrollment, enrollment administration, and child-read rights on classes. | **Seeded** phases, phase-filtered requests, responses, school classes with child-read permission, default unfiltered care usage and enabled occupancy. Later filters, manual enrollment bootstrap, decisions and exports stay explicit. |
| `/admin/guardian-approvals` | Pending guardian queue with school invite mode; `canReviewGuardianApprovals`, parents app booked. | **Seeded** pending queue under the review gate; invite mode already comes from the navigation context. Approve and decline stay explicit. |
| `/betreuungsplan` | Planning periods and slim grid for resolved Berlin window, group/staff/room filter; gap check for schedule managers. | Already seeded in #8103; unchanged. Drafts and exports stay deferred. |
| `/calendar` | Own appointments and school holidays for the visible day/week/month range; `calendar:own` and own staff for the personal calendar. | **Seeded** initial week and holidays, or the exact linked Betreuungsplan window. Edit, recipient picker, subscription and downloads remain opening/action reads. |
| `/calendar-periods` | Planning periods and school closing days; `schedules:manage` page, read permissions on resources. | **Seeded** periods, closing days, derived school-year or fallback holidays/vacations, and dated vacation hints. Phase options belong to the link-in-edit form. |
| `/care-offerings` | Phase list, planning periods, timetable templates; offerings and booking stats for initially selected phase from the phase list. Online enrollment, `config:manage`, timetable rights on planning resources. | **Seeded** phases, permitted planning periods and slim template metadata, and list and booking stats for the first active else first phase. Other phases are local selections. Editor drafts, previews and participant drilldowns stay deferred. |
| `/dashboard` | Client redirect with no separate display dataset. | No page resource. |
| `/dateien` | Folder overview, and shared Träger documents for `files:manage`. The school-side folder/document routes retain authority over audience. | **Seeded** both. Folder file lists load when their section opens; downloads, upload audience and deletion checks are actions. |
| `/day-log` | Group day log, Berlin day; `users:read`, school log enabled, group reach. | **Deferred**: `getStudentsDayLog` calls `writeDayLogAudit`; export also runs only on demand. |
| `/dienstplan` | Plan/rota for date window, role and selected view, planning periods and own staff; Dienstplan module and schedule rights. | **Seeded** initial role-projected view, its period, shift types and closing days. Full half-year intersection window is tracked in the planning inventory. |
| `/dienstplan/springer` | School's own and masked cross-school Springer blocks for Berlin Monday; `time_tracking:manage`, Dienstplan booked. | **Seeded** week. Later week navigation and block/release actions stay client-owned. |
| `/eltern/bankverbindungen` | Masked payment overview; `guardians:financial`. | **Deferred**: `guardian_payment_service.go` logs both the overview and separately the unmasked export. |
| `/emergency` | Static authenticated page; current children and health information assembled for explicit print/download. | **Deferred** export; no first-display resource. |
| `/enrollment-form` | Schema versions, phases and public legal texts by slug; online enrollment and `config:manage`. | **Seeded** schema versions, phases and the slug-scoped public legal texts without a staff bearer. Documents and write previews stay deferred. |
| `/enrollment-phases` | Phases, form schema versions, optional planning periods; online enrollment and `config:manage`. | **Seeded** first data with resource-specific checks. Edit draft, preview and delete-impact remain deferred. |
| `/enrollment-phases/[id]/review` | Rollover review queue for the phase; online enrollment, `config:manage`. | **Seeded** queue. Decisions still execute only when submitted. |
| `/enrollment-phases/[id]/rollover` | Existing source phase by ID; online enrollment, `config:manage`. | **Seeded** read-only phase. **Deferred** rollover preview with the selected grade promotion and submission. |
| `/ferienwochen` | Hosted weeks; school `config:read`. First displayed roster depends on returned weeks; a school with no hosted weeks initially sees home-school bookings. | **Seeded** hosted weeks and own-child assignment for the first hosted week. The named participant and home-school lists record access; health details and exports stay at their intended opening. |
| `/info-displays` | Display inventory when display feature enabled; `display:read` or `display:manage`. | **Seeded** list, not create/regenerate tokens. |
| `/lists` | Slot-list options for Berlin `datum`; report preview additionally depends on options' active instance IDs and validated URL filters; schedules enabled. | **Seeded** the `NoCommit` options contract. Report preview and exports still run with their existing checked filters. |
| `/meal-plan` | Menu days for current Berlin week, order counts and participant data when enabled; Mittagessen, `meals:read` / `meals:orders` / `meals:register`. | **Seeded** saved menu days, aggregate orders, eating pupils and the caterer relationship when allowed. The full pupil selection is a new read on opening the edit dialog. |
| `/meal-plan/freigabe` | Overview months, then the first non-running one (else the first month); Mittagessen, billing release permission. | **Seeded** the month list and its selected month. Release still needs the inspected fingerprint and explicit submit. |
| `/mein-dienstplan` | Own shifts for Berlin week, schedule targets when enabled, upcoming shifts iff the first week is empty. Own staff and Dienstplan. | **Seeded** current week and follow-on lookahead only if empty, plus allowed targets and closing days. |
| `/messages` | Unfiltered parent inbox; parents app and `users:read` with per-child reach. | **Seeded** unfiltered key. Unread filter, recipients/search, mark-read and attachments are interactions; header unread count is already a shell reader. |
| `/messages/[threadId]` | Parent thread by ID, mails and request review coverage with participant/child access. | **Deferred**: `parentmessages.Service.GetThread` advances the personal read cursor and may send an SSE read receipt; subsequent readers require the opened thread. |
| `/messages/groups` | Group inbox; parents app and `users:read`. | **Seeded** list; compose audience/recipients open only in the composer. |
| `/messages/groups/[groupThreadId]` | Group thread detail by ID; parents app, `users:read` and backend audience reach. | **Seeded** detail and the independent outgoing-mail counts. Both enforce audience reach and neither advances the caller’s read cursor. |
| `/ogs-groups` | Live roster for `group` or first permitted group from supervision context; not open-care mode. | **Seeded** the explicit authorized URL group. Without it the browser uses its account-local selection; there is no separate browser-intent GET. |
| `/ogs-groups/overview` | Visible group options and link for one group, same shell supervision context as navigation. | Already shell-seeded, single cache in #8085. No separate read. |
| `/parent-announcements` | Parent announcements including inactive; parents app, admin wildcard. | **Seeded** list. Recipient lookups and upload list during compose, preview, and downloads are deferred. |
| `/parent-announcements/[id]` | Announcement by ID; parents app and admin wildcard. | **Seeded** the object, target names without catalog personnel, and the matching poll evaluation, read statistics and recipients, letter status and placeholder labels, or declaration status. Write dialogs, audited previews, proof and downloads stay deferred. |
| `/parent-attention/[studentId]` | Hard route redirects to the child record with no card selection. | No page resource. |
| `@parentAttention/default.tsx` | Empty parallel-route fallback. | No page resource. |
| `@parentAttention/(.)parent-attention/[studentId]` | Overlay reads selected child's data only with the local card-attention snapshot. Parent thread details mark the shown messages read; requests only open when the snapshot says they are pending. | **Deferred**: no server substitute for the clicked card and no speculative mark-read. |
| `/payroll` | Status, latest dispatch, payroll rules and missing-target coverage for current month; Zeiterfassung and `config:manage`. | **Seeded** status, latest dispatch, rules, target coverage and SFTP status only for the selected SFTP channel with export authority. Preview, export and transfer stay explicit. |
| `/profile` | Own auth profile is already in session; preference/device/passkey lists, own qualifications, birthday and parent message-count preferences use account keys and feature gates. | **Seeded** the own preferences, birthday switch, passkeys, trusted devices and message-count setting under its feature and permission gate. The own qualifications GET can insert standard types and stays on the existing browser path, as do enrollment, revocation, push/device inspection and writes. |
| `/reminders` | Reminders from the same users:read shell slot as the bell. | Already shell-seeded; keep timer, focus and SSE policy. |
| `/rooms` | Room list (includes system rooms) and dashboard counts in detailed mode; `rooms:read` and `groups:read`, respectively. Filters apply to the existing list. | **Seeded** list and analytics under separate keys. |
| `/rooms/[id]` | Room and room history form one reader; history uses the school retention window and has its own disabled/refused state; room plan has its own tab/date/window. | **Seeded** room with its own history and explicit plan window. See the planning inventory for the room roster and action-dependent reads. |
| `/rooms/unterwegs` | Transit roster with optional day status from validated return URL; detailed presence. Check-in destinations depend on staff and target mode. | **Seeded** the slim transit roster with exact referrer filters. The full response can log a health read and is not needed here. |
| `/settings` | Role-projected settings schema; selected tab from URL. | **Seeded** the role-projected schema and login image metadata when the resolved initial tab is Personalisierung. The home-policy editor is a write draft; secret reveal and writes stay explicit. |
| `/staff` | Staff + live supervision projection, former staff, document-directory, pending absences and time accounts based on tab and roles. | **Seeded** the role-projected staff directory, applicable former staff and the selected time-account month. The documents directory GET retries queued file deletions, so it stays at the intended opening. See the planning inventory for dependent reads. |
| `/staff/[id]` | Profile/record selected by staff ID, role and tab; document/financial and attendance readers are differently scoped. | **Seeded** full or reduced identity as required by the tab and rights. See the planning inventory for dependent/opening reads. |
| `/statistics` | Dated 30-day initial report, group/class catalog and optional report sections; per-role and group reach. | **Deferred**: statistics report records audit (see `ErrStatisticsAuditFailed` in Student Presence); exports separate. |
| `/students/[id]` | Composite child detail, per-child access flags, plus gated arrival/pickup, absences, group options and tab-specific data. | **Seeded** separate arrival, pickup, dated statuses, partial absences and the open withdrawal. The Kindakte GET may write a health-audit entry and remains at its current opening. |
| `/students/[id]/change-history` | Child breadcrumb via detail plus change history under its own permission. | **Seeded** the independent change-history read with Go permission and document-category checks. The Kindakte breadcrumb read is not seeded. |
| `/students/[id]/feedback-history` | Child breadcrumb and dated feedback for authorized staff. | **Seeded** the feedback rows without the Go response’s embedded child. The Kindakte breadcrumb read is not seeded. |
| `/students/[id]/room-history` | Child breadcrumb and attendance/visits for the child and school retention period. | **Deferred**: detail audit and `writeAttendanceHistoryAudit` on each attendance history read; export and corrections only on action. |
| `/students/[id]/unfallanzeigen/[reportId]` | Report, supporting document list and child name. | **Deferred**: report version/draft and supporting document opening; the name fallback uses audited `fetchStudent`. |
| `/substitutions` | Own accessible representation of substitutes and running supervisions; schedule overview for Berlin today only with `schedules:read`. | **Seeded** both factory keys under the substitutions permission. Person selectors and decisions stay deferred. |
| `/tagesinformationen` | Today's notices, leadership list, optional `hinweis` deep link, all account-scoped. | Today already shell-seeded. **Seeded** leadership list (admin wildcard) and exact linked notice (`users:read`). Acknowledgement list/edit only on open. |
| `/tagesplan` | Planned day without roster for valid `d` or Berlin today; detailed presence, timetable enabled and `schedules:read`. | **Seeded** day. Roster/change/start actions are separate, not new supervision reads. |
| `/team-chat` | Unfiltered personal team inbox when enabled. | **Seeded** inbox. Its unread badge is shell data, recipients are read only when composing. |
| `/team-chat/[threadID]` | Personal/team thread by ID and participation. | **Deferred**: `staffmessages.Service.GetThread` marks the conversation read for the caller. |
| `/umfragen` | Surveys to answer for the caller, manage list with `surveys:manage`. | **Seeded** both keys. Answer form loaded on opening, not on list prefetch. |
| `/umfragen/[id]` | Survey by ID for `surveys:manage`; published results and nonanonymous respondents on the relevant tab. | **Seeded** the survey, non-draft results and respondents only when the initial tab requests them for a nonanonymous survey. Draft editing and export stay explicit. |
| `/vertretung` | Planning periods, timetable resources and coverage for resolved view window and scheduling permissions. | **Seeded** the selected coverage window and its independent prerequisites. It does not own a separate supervision cache. |
| `/wochenprotokolle` | Protocol list with optional first `group` query; group update/manage, then Go group reach. | **Seeded** metadata without day details. |
| `/wochenprotokolle/[protocolId]` | One protocol with named children/absences, group reach by ID. | **Deferred**: `week_protocols.go` calls `recordAccess` before rendering detail. Notes and PDF stay on their existing paths. |

## Public and layout routes

| Route | First readers, inputs and gate | Disposition |
| --- | --- | --- |
| `/` | School login, branding from tenant layout; existing session check, login/MFA/passkeys and selected redirect. | No eligible page read; credential flows must remain interactive. |
| `/[...not-found]` | Unknown URL redirect. | No page resource. |
| `/anmeldung` | Public catalog of open phases for canonical school slug, no cookies/bearer. | **Seeded** directly into the page, not into an authenticated cache. A failed, missing or expired snapshot uses the existing browser fetch and displays the existing disabled/error state. |
| `/anmeldung/[phaseId]` | Form bootstrap by school/phase, optional `late_invite`, possibly signed-in guardian/profile data added by the named BFF. | **Deferred** form opening: staff/public membership must not stand in for the guardian enrichment or late-invite capability. Form version and CAPTCHA stay with the form path. |
| `/anmeldung/preview` | Staff editing preview: phases, selected phase/template bootstrap and legal text. | **Deferred** preview: preview input and staff config authority belong to the editor, not the public phase-list read. |
| `/anmeldung/status/[token]` | Family's enrollment status, changes and form labels by bearer link, which can belong to a different school from the host. | **Opening**. The capability is revalidated by `GetByStatusToken` on each opening, not by the tenant cookie or host. Do not place the request or its guardian/signature data in a prefetched protected seed. Signature proof is a download. |
| `/anmeldung/status/[token]/edit` | Edit bootstrap, selected family/form answers through capability token. | **Deferred** fresh form/draft. |
| `/anmeldung/status/[token]/adjust` | Adjustment bootstrap through capability token. | **Deferred** fresh form/draft. |
| `/anmeldung/submitted` | Confirmation text; no enrollment read. | No page resource. |
| `/demo` | Fragment access token, setup polling and redemption. | **Deferred** fragment unavailable server-side; redemption changes state. |
| `/display` | Screen data authorized by fragment token sent as `X-Display-Token`; live polling. | **Deferred** fragment unavailable server-side; not a staff session or browser-auth cache. |
| `/invite` | Invitation validation keyed by URL token followed by redemption. | **Opening**. Read-only validation still checks the single-use URL capability before the acceptance form; acceptance writes and consumes the invitation. |
| `/reset-password` | Reset link token and credential form. | **Deferred** credentials and password reset submission. |
| `/traeger-uebergabe` | Handoff exchange installs a different session and navigates to Team. | **Deferred** exchange changes the session. |
| `[tenant]/layout.tsx`, `(protected)/layout.tsx` | Tenant resolution, school/portal snapshot and existing shell keys, shell widgets/navigation and parallel slot. | Already uses shared server shell bootstrap; no new page reads in the shell. Per-route seeds are under the protected tree. |
| `(public)/display/layout.tsx`, `(public)/anmeldung/layout.tsx`, `(public)/anmeldung/[phaseId]/layout.tsx`, `(public)/anmeldung/preview/layout.tsx` | Public framing and translations. | No layout data fetch to move. |
