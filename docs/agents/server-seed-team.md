# Team portal server seed inventory (#8079)

Scope: `frontend/src/app/[tenant]`, excluding `database/**`, `students/search`,
`home`, `active-supervisions`, `time-tracking` and `anfragen`. The protected
routes below require the current Team portal school session on its canonical
host unless noted. A named permission or paid module narrows that gate; the
Go handler still enforces school, account and object access. URL parameter
names below are inputs, not authorization.

**Seeded** means the server runs the same generated GET and puts its
browser projection under the existing reader key. A failed seed leaves the
browser's original error and retry path in charge. **Open** means not
converted in this slice; it does not mean ineligible. **Deferred** means an
opening, audit, side effect, write draft, later interaction or download makes
speculative reads wrong. Nothing below changes #8085's supervision cache or
#8082's protected-tree lifecycle.

## Protected routes

| Route | First readers, inputs and gate | Disposition |
| --- | --- | --- |
| `/absences` | Status-day overview: Berlin today/range, search, group, state and page; `users:read` plus group reach. | **Deferred**: `status_day_overview_handlers.go` calls `writeStatusDayOverviewAudit` before responding. |
| `/activities` | Activity list, categories and optional own staff in one key; detailed presence, booked NFC, `activities:list` or `activities:read`. | **Open**: seed the aggregate without rebuilding the shell's own-staff read. Editing and list of participants are separate openings. |
| `/admin/change-requests` | Redirect to `/anfragen`; no separate read. | No page resource. |
| `/admin/enrollments` | Phases, form schemas, all requests, change requests, settings schema and own `enrollment_submitted` e-mail switch; online enrollment, `config:manage`. | **Seeded** initial keys including phase expiry warnings and per-phase offering counts. Counts use one school catalog GET when phases exist; only the grouped totals cross RSC. |
| `/admin/enrollments/[id]` | Request by ID, form labels, outgoing mail and review data; `config:manage`. | **Deferred**: the main GET marks this request read; the subsequent labels and mail depend on the opened request. Signature proof and uploads are downloads. |
| `/admin/enrollments/change-requests` | Redirect to `/anfragen`; no list of its own. | No page resource. |
| `/admin/enrollments/change-requests/[id]` | Change request by ID; `canReviewEnrollmentChangeRequests`, online enrollment. | **Seeded** request and form labels once the authorized request provides the real request ID. No request-detail opening. |
| `/admin/enrollments/phases/[phaseId]` | Phase list, phase-filtered requests, response overview, school classes, default care usage and occupancy; online enrollment, enrollment administration, and child-read rights on classes. | **Seeded** phases, phase-filtered requests, responses, school classes with child-read permission, default unfiltered care usage and enabled occupancy. Later filters, manual enrollment bootstrap, decisions and exports stay explicit. |
| `/admin/guardian-approvals` | Pending guardian queue with school invite mode; `canReviewGuardianApprovals`, parents app booked. | **Seeded** pending queue under the review gate; invite mode already comes from the navigation context. Approve and decline stay explicit. |
| `/betreuungsplan` | Planning periods and slim grid for resolved Berlin window, group/staff/room filter; gap check for schedule managers. | Already seeded in #8103; unchanged. Drafts and exports stay deferred. |
| `/calendar` | Own appointments and school holidays for the visible day/week/month range; `calendar:own` and own staff for the personal calendar. | **Open**: exact range and own-staff-dependent gate. The edit detail, recipient picker, subscription link and downloads stay tied to their panels/actions. |
| `/calendar-periods` | Planning periods and school closing days; `schedules:manage` page, read permissions on resources. | **Seeded** periods and closing days. **Open**: holidays/vacations derived from loaded periods, school vacation hints, and phases (only needed by the link-in-edit form). |
| `/care-offerings` | Phase list, planning periods, timetable templates; offerings and booking stats for initially selected phase from the phase list. Online enrollment, `config:manage`, timetable rights on planning resources. | **Seeded** phases, permitted planning periods and slim template metadata, and list and booking stats for the first active else first phase. Other phases are local selections. Editor drafts, previews and participant drilldowns stay deferred. |
| `/dashboard` | Client redirect with no separate display dataset. | No page resource. |
| `/dateien` | Folder overview, and shared Träger documents for `files:manage`. The school-side folder/document routes retain authority over audience. | **Seeded** both. Folder file lists load when their section opens; downloads, upload audience and deletion checks are actions. |
| `/day-log` | Group day log, Berlin day; `users:read`, school log enabled, group reach. | **Deferred**: `getStudentsDayLog` calls `writeDayLogAudit`; export also runs only on demand. |
| `/dienstplan` | Plan/rota for date window, role and selected view, planning periods and own staff; Dienstplan module and schedule rights. | **Open**: scope/window-specific readers, except own profile if already supplied by the shell. Editing, conflict details and exports are not initial reads. |
| `/dienstplan/springer` | School's own and masked cross-school Springer blocks for Berlin Monday; `time_tracking:manage`, Dienstplan booked. | **Seeded** week. Later week navigation and block/release actions stay client-owned. |
| `/eltern/bankverbindungen` | Masked payment overview; `guardians:financial`. | **Deferred**: `guardian_payment_service.go` logs both the overview and separately the unmasked export. |
| `/emergency` | Static authenticated page; current children and health information assembled for explicit print/download. | **Deferred** export; no first-display resource. |
| `/enrollment-form` | Schema versions, phases and public legal texts by slug; online enrollment and `config:manage`. | **Seeded** schema versions, phases and the slug-scoped public legal texts without a staff bearer. Documents and write previews stay deferred. |
| `/enrollment-phases` | Phases, form schema versions, optional planning periods; online enrollment and `config:manage`. | **Seeded** first data with resource-specific checks. Edit draft, preview and delete-impact remain deferred. |
| `/enrollment-phases/[id]/review` | Rollover review queue for the phase; online enrollment, `config:manage`. | **Seeded** queue. Decisions still execute only when submitted. |
| `/enrollment-phases/[id]/rollover` | Existing source phase by ID; online enrollment, `config:manage`. | **Seeded** read-only phase. **Deferred** rollover preview with the selected grade promotion and submission. |
| `/ferienwochen` | Hosted weeks; school `config:read`. First displayed roster depends on returned weeks; a school with no hosted weeks initially sees home-school bookings. | **Seeded** hosted weeks and own-child assignment for the first hosted week. The named participant and home-school lists record access; health details and exports stay at their intended opening. |
| `/info-displays` | Display inventory when display feature enabled; `display:read` or `display:manage`. | **Seeded** list, not create/regenerate tokens. |
| `/lists` | Slot-list options for Berlin `datum`; report preview additionally depends on options' active instance IDs and validated URL filters; schedules enabled. | **Open** options. **Deferred** preview and exports; never guess the allowed slots, drop invalid filters, or make the speculative read as a print action. |
| `/meal-plan` | Menu days for current Berlin week, order counts and participant data when enabled; Mittagessen, `meals:read` / `meals:orders` / `meals:register`. | **Open**: preserve visible week and the tab's permission/settings checks. Editing, versioned per-day drafts, participant selection and exports remain action-scoped. |
| `/meal-plan/freigabe` | Overview months, then the first non-running one (else the first month); Mittagessen, billing release permission. | **Open** overview and exact dependent month. Release still requires the inspected month's fingerprint and explicit submit. |
| `/mein-dienstplan` | Own shifts for Berlin week, schedule targets when enabled, upcoming shifts iff the first week is empty. Own staff and Dienstplan. | **Open** initial own schedule and the empty-week dependency. |
| `/messages` | Unfiltered parent inbox; parents app and `users:read` with per-child reach. | **Seeded** unfiltered key. Unread filter, recipients/search, mark-read and attachments are interactions; header unread count is already a shell reader. |
| `/messages/[threadId]` | Parent thread by ID, mails and request review coverage with participant/child access. | **Deferred**: `parentmessages.Service.GetThread` advances the personal read cursor and may send an SSE read receipt; subsequent readers require the opened thread. |
| `/messages/groups` | Group inbox; parents app and `users:read`. | **Seeded** list; compose audience/recipients open only in the composer. |
| `/messages/groups/[groupThreadId]` | Group thread detail by ID; parents app, `users:read` and backend audience reach. | **Seeded** detail and the independent outgoing-mail counts. Both enforce audience reach and neither advances the caller’s read cursor. |
| `/ogs-groups` | Live roster for `group` or first permitted group from supervision context; not open-care mode. | **Open**: ID/default and authorization must agree with the groups from #8085; existing live-roster intent remains. Local selection, supervision and transfer actions stay deferred. |
| `/ogs-groups/overview` | Visible group options and link for one group, same shell supervision context as navigation. | Already shell-seeded, single cache in #8085. No separate read. |
| `/parent-announcements` | Parent announcements including inactive; parents app, admin wildcard. | **Seeded** list. Recipient lookups and upload list during compose, preview, and downloads are deferred. |
| `/parent-announcements/[id]` | Announcement by ID; parents app and admin wildcard. | **Seeded** the object, target names without catalog personnel, and the matching poll evaluation, read statistics and recipients, letter status and placeholder labels, or declaration status. Write dialogs, audited previews, proof and downloads stay deferred. |
| `/parent-attention/[studentId]` | Hard route redirects to the child record with no card selection. | No page resource. |
| `@parentAttention/default.tsx` | Empty parallel-route fallback. | No page resource. |
| `@parentAttention/(.)parent-attention/[studentId]` | Overlay reads selected child's data only with the local card-attention snapshot. Parent thread details mark the shown messages read; requests only open when the snapshot says they are pending. | **Deferred**: no server substitute for the clicked card and no speculative mark-read. |
| `/payroll` | Status, latest dispatch, payroll rules and missing-target coverage for current month; Zeiterfassung and `config:manage`. | **Seeded** status, latest dispatch, rules, target coverage and SFTP status only for the selected SFTP channel with export authority. Preview, export and transfer stay explicit. |
| `/profile` | Own auth profile is already in session; preference/device/passkey lists, own qualifications, birthday and parent message-count preferences use account keys and feature gates. | **Seeded** the own preferences, qualifications, birthday switch, passkeys, trusted devices and message-count setting under its feature and permission gate. Enrollment, revocation, push/device inspection and writes stay client-owned. |
| `/reminders` | Reminders from the same users:read shell slot as the bell. | Already shell-seeded; keep timer, focus and SSE policy. |
| `/rooms` | Room list (includes system rooms) and dashboard counts in detailed mode; `rooms:read` and `groups:read`, respectively. Filters apply to the existing list. | **Seeded** list and analytics under separate keys. |
| `/rooms/[id]` | Room and room history form one reader; history uses the school retention window and has its own disabled/refused state; room plan has its own tab/date/window. | **Open** composite and overview roster. Blindly seeding only a room would falsely turn history failure into an empty history; no #8085 supervision-context changes here. Changes/exports stay deferred. |
| `/rooms/unterwegs` | Transit roster with optional day status from validated return URL; detailed presence. Check-in destinations depend on staff and target mode. | **Open** first roster with exact filter; reuse #8085 where already provided, keep interaction-dependent target reads separate. |
| `/settings` | Role-projected settings schema; selected tab from URL. | **Seeded** the role-projected schema and login image metadata when the resolved initial tab is Personalisierung. The home-policy editor is a write draft; secret reveal and writes stay explicit. |
| `/staff` | Staff + live supervision projection, former staff, document-directory, pending absences and time accounts based on tab and roles. | **Open**: reuse exact staff projection and preserve #8085's separate supervision data; audit and exports only on their existing tabs/actions. |
| `/staff/[id]` | Profile/record selected by staff ID, role and tab; document/financial and attendance readers are differently scoped. | **Open** eligible record/profile and default tab. Personal document/finance opening restrictions, planned-exit impact and drafts stay in their existing paths. |
| `/statistics` | Dated 30-day initial report, group/class catalog and optional report sections; per-role and group reach. | **Deferred**: statistics report records audit (see `ErrStatisticsAuditFailed` in Student Presence); exports separate. |
| `/students/[id]` | Composite child detail, per-child access flags, plus gated arrival/pickup, absences, group options and tab-specific data. | **Deferred** detail: `getStudent` calls `writeStudentHealthViewAudit` when health data is present; do not duplicate #8085 group hints. **Open** remaining independently eligible overview data; audited/opening readers and drafts stay deferred. |
| `/students/[id]/change-history` | Child breadcrumb via detail plus change history under its own permission. | **Deferred** child detail audit. **Open** change-history reader, including its refusal handling. |
| `/students/[id]/feedback-history` | Child breadcrumb and dated feedback for authorized staff. | **Deferred** the audited detail. **Open** dated feedback reader under its own guard. |
| `/students/[id]/room-history` | Child breadcrumb and attendance/visits for the child and school retention period. | **Deferred**: detail audit and `writeAttendanceHistoryAudit` on each attendance history read; export and corrections only on action. |
| `/students/[id]/unfallanzeigen/[reportId]` | Report, supporting document list and child name. | **Deferred**: report version/draft and supporting document opening; the name fallback uses audited `fetchStudent`. |
| `/substitutions` | Own accessible representation of substitutes and running supervisions; schedule overview for Berlin today only with `schedules:read`. | **Seeded** both factory keys under the substitutions permission. Person selectors and decisions stay deferred. |
| `/tagesinformationen` | Today's notices, leadership list, optional `hinweis` deep link, all account-scoped. | Today already shell-seeded. **Seeded** leadership list (admin wildcard) and exact linked notice (`users:read`). Acknowledgement list/edit only on open. |
| `/tagesplan` | Planned day without roster for valid `d` or Berlin today; detailed presence, timetable enabled and `schedules:read`. | **Seeded** day. Roster/change/start actions are separate, not new supervision reads. |
| `/team-chat` | Unfiltered personal team inbox when enabled. | **Seeded** inbox. Its unread badge is shell data, recipients are read only when composing. |
| `/team-chat/[threadID]` | Personal/team thread by ID and participation. | **Deferred**: `staffmessages.Service.GetThread` marks the conversation read for the caller. |
| `/umfragen` | Surveys to answer for the caller, manage list with `surveys:manage`. | **Seeded** both keys. Answer form loaded on opening, not on list prefetch. |
| `/umfragen/[id]` | Survey by ID for `surveys:manage`; published results and nonanonymous respondents on the relevant tab. | **Seeded** the survey, non-draft results and respondents only when the initial tab requests them for a nonanonymous survey. Draft editing and export stay explicit. |
| `/vertretung` | Planning periods, timetable resources and coverage for resolved view window and scheduling permissions. | **Open**: exact selected window and dependent coverage. No new shell supervision cache. |
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
| `/anmeldung/status/[token]` | Family's enrollment status, changes and form labels by bearer link, which can belong to a different school from the host. | **Open**: a capability-bound status read would need the equivalent safe lifetime/identity in the server handoff, not the staff seed; signature proof is a download. |
| `/anmeldung/status/[token]/edit` | Edit bootstrap, selected family/form answers through capability token. | **Deferred** fresh form/draft. |
| `/anmeldung/status/[token]/adjust` | Adjustment bootstrap through capability token. | **Deferred** fresh form/draft. |
| `/anmeldung/submitted` | Confirmation text; no enrollment read. | No page resource. |
| `/demo` | Fragment access token, setup polling and redemption. | **Deferred** fragment unavailable server-side; redemption changes state. |
| `/display` | Screen data authorized by fragment token sent as `X-Display-Token`; live polling. | **Deferred** fragment unavailable server-side; not a staff session or browser-auth cache. |
| `/invite` | Invitation validation keyed by URL token followed by redemption. | **Open** read-only validation (anonymous token boundary); accepting invitation is a write. |
| `/reset-password` | Reset link token and credential form. | **Deferred** credentials and password reset submission. |
| `/traeger-uebergabe` | Handoff exchange installs a different session and navigates to Team. | **Deferred** exchange changes the session. |
| `[tenant]/layout.tsx`, `(protected)/layout.tsx` | Tenant resolution, school/portal snapshot and existing shell keys, shell widgets/navigation and parallel slot. | Already uses shared server shell bootstrap; no new page reads in the shell. Per-route seeds are under the protected tree. |
| `(public)/display/layout.tsx`, `(public)/anmeldung/layout.tsx`, `(public)/anmeldung/[phaseId]/layout.tsx`, `(public)/anmeldung/preview/layout.tsx` | Public framing and translations. | No layout data fetch to move. |
