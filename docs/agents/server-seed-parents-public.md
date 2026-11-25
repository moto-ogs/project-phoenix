# Server-seed inventory: parents and standalone pages (#8079)

Scope: the 30 `page.tsx` routes under `app/parents` and the 9 pages outside all portal trees. The table uses internal Next.js paths. On the parent host, drop the `/parents` prefix. Team-owned `app/[tenant]`, including its public route group, and the other private portals have separate inventories. The parents tree has no parallel page segment.

## Parents: authenticated pages

All portal seeds use the fresh **parent** snapshot, generated Go GET contracts, `seedRead`, `seedOf` and `SWRServerSeed`. Go derives account and school scope from the session and checks the individual relationship and endpoint permission. A child ID or school selector in the URL does not grant access. When a seed fails, the same browser reader handles the error and can retry.

| Route | First display, key inputs and disposition |
| --- | --- |
| Shell for protected routes | **Seeded:** live-session snapshot, the bundled family key with children, features and day status (#8106); account profile (name and locale), message count (from both accessible inbox lists), news count and availability, and notification count. The shell sends counts and the availability flag, not the underlying inboxes. Its news check and the start/news page share the request-local read when both need it. Opening the bell loads its first page; scroll loads its cursor pages. Push subscription sync and install prompts depend on browser state. No shell seed on public parent paths, even with a parent cookie. |
| `/parents` | **Seeded:** the bundled family key with children, per-relationship features and Berlin-day status (#8106), holiday offers and registrations, announcements, message summaries and calendar (Berlin today through +90 days). The profile comes from the shell. Holiday and to-do requests start alongside the cards; the first HTML for the cards does not await those ancillary results. Opening a letter, survey, appointment response overview or attachment remains an interaction. |
| `/parents/children` | **Seeded:** linked children and their daily status. One child opens the care profile and uses the same scoped detail reads as the ID route; multiple children open the selector and do not load care details for any child. |
| `/parents/children/[id]` | **Seeded:** the bundled family key (#8106), sick days, excused requests, conference summary and, for a child with a place, exceptions, pickup requests, weekly schedule, care offerings and courses. Date-sensitive keys carry the Berlin day; Go's existing default ranges are unchanged. The heading waits on the list only. **Unchanged:** the mixed master-data GET serves both the departure widget and the private Details tab. Its full response carries contact, health and pending-change fields not needed by the initial departure widget; do not serialize that response into the first page. A narrower display projection is needed to seed it. Contacts, consents, signatures, request history and form catalogues stay at their existing tab/dialog/action. |
| `/parents/children/[id]/elternsprechtag` | **Seeded:** authorized child, relationship features and future conference offers and current booking for that child. Booking and cancellation remain user actions. |
| `/parents/messages` | **Seeded:** linked children and group summaries, direct-thread summaries when multiple children have a place. With one child with a place, seed its audience summaries and care reads plus the family key the embedded composer uses. **Unchanged:** fetching the open conversation marks it read; it must run on opening, not prefetch. |
| `/parents/messages/[studentId]` | **Seeded:** the bundled family key, both audience summaries and the selected child's care reads used by the composer. **Unchanged:** exactly the opened conversation GET (team by default, leadership by `audience`) still marks it read. Attachments/downloads and composer actions are not seeded. |
| `/parents/messages/group/[groupThreadId]` | **Seeded:** the linked children and relationship features for the reply control. **Unchanged:** the group thread GET marks it read; opening it still checks its audience. File downloads and replies remain actions. |
| `/parents/news` | **Seeded:** announcement cards for the live parent's audience. **Unchanged:** opening a letter can mark it read and request survey/attachment data; neither runs in the seed. |
| `/parents/news/[id]/nachweis?student=…` | **Seeded:** JSON display proof for this account, announcement and linked child; Go checks the specific submission. **Unchanged:** optional file previews and PDF download. Missing child query makes no proof request. |
| `/parents/calendar` | **Seeded:** calendar window (Berlin today through +91 days), distinct from the start key. The local displayed month does not widen the read. **Unchanged:** appointment response details, external calendar feed setup, and downloads. |
| `/parents/documents` | **Unchanged:** letters and contracts both write read-audit records for the runs or contracts shown. The shared-document list has no such side effect, but the existing browser key aggregates all three sources and retains its partial-source retry path. Downloads and signing, SEPA, family declaration and termination forms stay on opening. |
| `/parents/documents/vertrag/[organizationId]/[contractId]` | **Unchanged:** contract signing view and PDF, or `family=1` (family-size declaration) or `lastschrift=1` (SEPA mandate). These are the current inputs for a signature/declaration or bank authorization, not a general contract listing. SEPA uses `useOpeningRead`; PDFs stay at the original open/download. Go checks the recipient and qualifying relationship at the time of the read. |
| `/parents/documents/vertraege/[organizationId]/[contractId]` | **Unchanged:** day-specific notice options and current termination/revocation record open the legal declaration form. The available deadlines/recipient are inputs to that declaration, not a standalone history view; opening or retrying the form keeps its current live read. |
| `/parents/meal-plan` | **Seeded:** relationship features and plan of the initial eligible child/school and Monday. `school` only selects a linked school with an enabled plan; absent/invalid week uses the current week, with the same reachable range as the client. Later school/week choices and participation editing stay with their readers. |
| `/parents/ferienanmeldungen` | **Seeded:** the live account's holiday registration cards and consent state, including an account linked only to a Träger. Writes and status links stay separate. |
| `/parents/anmeldung` | **Seeded:** account-eligible schools and open phases; the backend filters both linked and eligible unlinked schools. |
| `/parents/anmeldung/[tenantSlug]/[phaseId]` | **Unchanged:** school metadata, parent-only form bootstrap (including optional late-invite proof) and scoped autofill belong to the `useReadDraft` form opening. An anonymous bootstrap cannot stand in for a parent-restricted phase. |
| `/parents/settings` | **Seeded:** notification preference catalogue for the default/notifications tab; MFA status and its dependent trusted-device list for `tab=signIn` when enabled. Language uses shell profile; privacy uses local consent. Push permissions, installed status and subscription are browser state, and account changes are actions. |

## Parents: public and token pages

An authenticated parent's cache is not an authority for an invitation, enrollment or contract token. A read-only status page can load on the server at its actual opening, never in a prefetch or under an account key. The token remains the credential checked by Go with the existing client-IP read limits. Drafts, downloads and any read with a side effect remain at their designated opening.

| Route | First display and disposition |
| --- | --- |
| `/parents/login` | **Unchanged:** sign-in form and portal session check. Credentials, reset and MFA happen on submit. No use of personal page-seed data. |
| `/parents/invite` | **Unchanged:** invitation check for query token and account setup form; new account not yet authenticated. |
| `/parents/reset-password` | **Unchanged:** reset form from the link inputs; consumption/validation of the credential takes place with the password change, not in a seed. |
| `/parents/demo` | **Unchanged:** demo entry progress; demo start/advance and sign-in create state and must not run on prefetch. |
| `/parents/accept-guardian-invite/[token]` | **Already server-side:** invitation summary and school branding from `GET /auth/guardian-invitations/{token}` with same-token authorization. Accepting it is a distinct action. |
| `/parents/anmeldung/status/[token]` | **Seeded at opening:** token-authorized JSON status and change requests in parallel; form labels follow a nonempty list. Only visible status fields and formatted changes cross RSC. The family-children GET takes row locks and stays at its card opening; signature proof, edit/adjust and writes remain separate. The Team route `/anmeldung/status/[token]` follows the same rule. |
| `/parents/anmeldung/status/[token]/edit` | **Unchanged:** token-authorized edit bootstrap belongs to its write form. |
| `/parents/anmeldung/status/[token]/adjust` | **Unchanged:** same bootstrap path with the adjustment form mode, read for that opening. |
| `/parents/ferienanmeldung/[token]` | **Unchanged:** offer/form bootstrap by token and separately authorized parent family prefill. Go logs family-prefill access; neither draft inputs nor the audited read run on prefetch. |
| `/parents/ferienanmeldung/status/[token]` | **Seeded at opening:** token-authorized status and placement, independent of the parent's account. No unused allocation mode or account key in the payload. |
| `/parents/ferienkonto/[token]` | **Unchanged:** account setup data by one-time holiday registration proof. Setup actions need that live proof. |
| `/parents/vertrag-unterschreiben/[link]` | **Unchanged:** signing view and PDF from the mail credential, or the family/mandate operation offered by the link. Reauthorization, file read and write inputs stay on the current opening. |

## Standalone pages

| Route | First display and disposition |
| --- | --- |
| `/` | **Server read:** the bare-domain school picker uses the registered public schools GET directly via `readContract` and `seedRead`, shipping only slug, school name and subdomain. No session or SWR key. On failure the existing browser reader retries; success (including an empty list) does not issue a browser GET. Canonical portal redirects are unchanged. |
| `/start` | **Unchanged:** static intake prompts and local fields; submit opens a mail client. No initial data GET. |
| `/onboarding` | **Already server-side:** redirect to `/start`; no data. |
| `/invite` | **Unchanged:** token validation for the staff invitation and public account setup form; the token is checked on opening. |
| `/reset-password` | **Unchanged:** link-based password reset form; the current link is consumed/validated by the write, not a display GET. |
| `/demo` | **Unchanged:** demo creation/progress and sign-in are state changes, not display reads. |
| `/help/[[...topic]]` | **Unchanged:** compiled help content selected by route/query; no backend GET. |
| `/help/nfc/erste-schritte` | **Unchanged:** static printable help content. |
| `/lohnbuero/[link]` | **Unchanged:** static download explanation; the one-time link is checked and consumed by the explicit file-download POST, not by opening or prefetching the page. |

## Integration checks

- Parent normal entry: `/` on the parent host. Wait for a named child card under `[data-parent-tour="start-child"]`, not just the heading/skeleton. Inspect browser `/api/parent/me/family-start`, news/messages/holiday and the exact 90-day calendar query.
- Parent profile: `/children/<linked-id>`, wait for visible booked hours under `[data-parent-tour="child-care-times"]`. Confirm no browser GET for the seeded schedule, offerings or request lists. Repeat for a child at a second school and an unlinked ID. For a failed care key the other keys must remain usable and only the missing key should follow the browser load/retry path.
- Document inbox: verify that the audit-producing list reads still run at opening, not while the link is prefetched. A denied or failed inbox source leaves the aggregate to its partial-load path. `/calendar` can be checked by a seeded appointment title and the distinct +91-day query.
- Parent messages: `/messages/<linked-id>` and `/messages/group/<id>`. The actual conversation/group read should appear exactly on opening and still mark it read; do not count it as a redundant mount GET. The separately seeded summary key should not make a duplicate cold-mount GET.
- Public picker: bare-host `/`, combobox labelled `Einrichtung` enabled with a known public school option. The successful first read should not repeat in the browser.
- No separate parent intent loader exists for these keys. The shared boundary owns the handoff and shares generation/invalidation handling with #8103. The family contract from #8106 is the only source for children, features and today. The shell and page share it within a server request; per-child seeds use the confirmed relationships and the server Berlin day.
