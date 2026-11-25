# Server seed inventory: School, Träger, Operator, Caterer

Scope: the 137 `page.tsx` entry points in these four portals as of #8103, including their first-render readers. Paths use the internal portal prefix (omit it on the respective portal host). API routes and PyrePortal are not pages. URLs and cache keys select a resource, never grant access.

Every seeded GET starts through `readContract` with that portal's fresh snapshot and Go authorization. It uses the browser's existing key and result shape; `seedRead`'s budget drops only the incomplete key. RSC contains no bearer or error object. The existing `SWRServerSeed` controls generation matching, expiry, refusal, handoff and browser recovery; Next's data cache is not used. There is no separate intent loader for these keys. Portal layouts seed only their own readers (School notices badge; Träger organization and own profile), never requests on a public path with a cookie. Push permission, notification dialogs, live counters/revalidation, service workers and navigation actions retain their existing client ownership.

An audited GET stays on its prescribed browser/opening path even if its hook currently uses display SWR. In particular, see `backend/api/operator_routes.go` (`AuditReadAccess`), `backend/modules/classday/internal/application`, `backend/modules/parentbilling/internal/application`, and `backend/modules/traegerview/internal/application`. A token-only route cannot use a portal/account SWR seed; its public flow retains its own token and session checks.

## School (16)

| Route under `/school` | Seeded or already server-side | Other first readers and intentional exclusions |
|---|---|---|
| `/` | Assigned classes and leadership notices. | `tag` and `liste` choose the day and expanded list. Class and school day reports log disclosures; their HTTP reads stay client-side. |
| `/aufsichten` | Today's assigned blocks; the roster of the running block if one automatically opens. | Other rosters need a selected block. The child information sheet is an audited opening read. |
| `/einstellungen` | Preferences on the notification tab; remembered devices on the device tab. | `tab` selects the panel. Privacy uses the existing consent state. Push key/setup depend on local device support, permission and subscription. |
| `/elternbriefe` | Own letters and assigned-class options. | Compose, placeholder resolution, personalised preview and release checks remain in the editor; export downloads on action. |
| `/elternbriefe/[id]` | Letter by announcement ID, published status or declaration status, and needed placeholder labels. | Prospective draft reach, attachment files and write previews are not seeded. |
| `/elternsprechtag` | Conference list and available classes. | `konferenz` selects the entry from that list; edits use draft state and delivery history opens on demand. |
| `/fehlzeiten` | Assigned-class options. | The default class and school half-year select the absence report; the report and its exports write access logs. |
| `/invite` | None. | Public invitation-token acceptance, not an authenticated school read. |
| `/kalender` | The initial Berlin week, same `from`/`to` as the browser. | Other windows, appointment edits and e-mail delivery reads are interaction-specific. |
| `/klasse` | Assigned classes and permissions. | `klasse`, `tag` and `liste` choose the class/day/list. The class-day report writes an access log; exception editing opens separately. |
| `/klasse/kind` | None. | `klasse`, `kind` and `tag`; the shared notes verify the class assignment and record access. |
| `/login` | None. | Public sign-in, school selection (`tenant`), MFA and handoff are authentication steps. |
| `/nachrichten` | Inbox with the default all-conversations filter. | Unread-only and composing (recipients) are subsequent actions. |
| `/nachrichten/[threadID]` | None. | GET advances the read cursor; never run on router/link prefetch. Compose/recipient data stays on action. |
| `/reset-password` | None. | Token-gated reset flow, no first private SWR resource. |
| `/tagesinformationen` | Today's leadership notices (shared with home and the shell badge). | Acknowledgement is an explicit write. |

## Operator (19)

| Route under `/operator` | Seeded or already server-side | Other first readers and intentional exclusions |
|---|---|---|
| `/` | None; server redirect to `/operator/organizations`. | No independent reader. |
| `/accounts` | Träger options. | `orgId` and `schoolId`; school options and every account-list scope are audited. MFA, tenant grants and creation read on opening. |
| `/announcements` | Träger options. | List and school options are audited; editing/publishing, stats and per-notice views open on action. |
| `/billing` | Key-day settings and counted periods; Träger options if the newest period is the current Berlin month. | School list is audited. Other month selection and file generation are actions. |
| `/caterers` | None. | List access logs a disclosure; MFA administration opens on action. |
| `/devices` | Träger options and the exact all/Träger/school device list. | `schoolId` wins over `orgId`. School options and device history are audited. Transfer/delete checks open with the dialogue; device mapping never serializes credentials. |
| `/email-confirm` | None. | Public token confirmation changes the address. |
| `/invite` | None. | Public token/flow-cookie validation and account enrollment. |
| `/login` | None. | Public operator sign-in and MFA; no page SWR data. |
| `/operators` | Operator and invitation overview. | Changes and resend/revoke act on selection. |
| `/organizations` | Träger summaries and provisioning counts, as independent keys. | Test creation, delete and restore are explicit actions. |
| `/organizations/[slug]` | Träger summaries; on the device or erasure-order tab, that resource for the resolved organization ID. | School, accounts, persons, membership, invitations, staff release, settings and retention are audited. |
| `/organizations/[slug]/schools/[schoolSlug]` | Träger summaries. | `tab` chooses the section. School lists and required details are audited; PWA/device reads require their resolved school ID. Operator preview is a separate action and session. |
| `/persons` | Träger options. | `orgId` and `schoolId`; school filter and persons are audited; merge is a write preview. |
| `/provisioning` | None; server redirect to `/operator/organizations`. | No independent reader. |
| `/schools` | Träger options. | School summaries and missing details are audited. Opening and school creation are actions. |
| `/schools/[id]/settings` | None. | School ID and `back` navigation. School list, settings schema and booking impact are audited; reveals and writes stay at their intended opening. |
| `/settings` | Own profile, passkey summaries and remembered devices. | Enrollment/revocation, password and e-mail changes stay on action. |
| `/unregistered-tags` | Träger options. | `orgId`, `schoolId` and locally selected resolution filter; schools and scans are audited. Resolution is an action. |

## Caterer (5)

| Route under `/caterer` | Seeded or already server-side | Other first readers and intentional exclusions |
|---|---|---|
| `/` | Compact order overview for the default Berlin date window, including all currently supplied schools. | No details are seeded. Opening a school reads its orders for this window and grant. A failed school can be retried individually; a revoked supply disappears. Exports remain actions. |
| `/einladung/[schoolId]/[token]` | None. | Public acceptance is bound to the school and invitation token; no authenticated portal preload. |
| `/konto` | Own MFA state and passkey summaries; remembered devices only if the factor is enabled. | Uses session e-mail already in the layout. Credential changes and confirmation steps are actions. |
| `/login` | None. | Public sign-in, including account MFA/passkey challenge. |
| `/reset-password` | None. | Public token-gated reset flow. |

## Träger (97)

| Route under `/traeger` | Seeded or already server-side | Other first readers and intentional exclusions |
|---|---|---|
| `/` | Schools of the current Träger. | Per-school navigation/handoff and exports remain actions. |
| `/abrechnung` | Aggregate run list and creator's eligible holiday periods. | `zeitraum` can anchor the UI; the separate run detail is audited. |
| `/abrechnung/[id]` | None. | Holiday run detail and letter/mail/history reads are audited; previews, documents, CSVs and SEPA actions stay on action. |
| `/abrechnung/[id]/faelligkeiten` | None. | Existing holiday-run read is audited; the due-date form depends on its result. |
| `/abrechnung/ermaessigungen` | Care reduction rules. | Editing rule and changing scope is local form state. |
| `/abrechnung/exporte` | First page of runs and protocol, export settings and recipients, then DATEV states when ready. | More pages require an action; generating a file is a write. |
| `/abrechnung/exporte/empfaenger` | Recipient list and assignments in its existing result. | Saves use version checks. |
| `/abrechnung/exporte/empfaenger/[id]` | Recipient and deliveries by ID. | Settings form remains on display/draft paths; retrieval is not a download. |
| `/abrechnung/exporte/empfaenger/neu` | None. | Blank form, creates only on submit. |
| `/abrechnung/exporte/feldzuordnung` | Export settings. | Mapping editor and number adjustment are writes. |
| `/abrechnung/exporte/konten` | Booking accounts and cost centres. | Changes are explicit actions. |
| `/abrechnung/familien` | Debtor-number format and scope. | Family/document list, child/family number projections and detail write read trails; selected editor comes from `?familie`. |
| `/abrechnung/familien/[id]` | None. | Family detail and debtor-number lookup log reads. |
| `/abrechnung/familien/zahlung/[contractId]` | Billing terms and debtor-number settings. | Family billing and SEPA mandates are opening reads; the contract ID alone grants nothing. |
| `/abrechnung/jahresbescheide` | Run summaries and tariffs. | Preparing the annual run requires the form. |
| `/abrechnung/jahresbescheide/[id]` | None. | Annual notice details log contracts shown. |
| `/abrechnung/jahresbescheide/[id]/bescheid/[contractId]` | None. | Letter opening reads an individual contract notice and records access; print/download stay on action. |
| `/abrechnung/jahresbescheide/[id]/lastschrift` | None. | The run read is audited and controls whether debit preparation exists. |
| `/abrechnung/jahresbescheide/[id]/versand` | None. | Run and notice-letter status are audited; recipient documents and delivery actions are not prefetched. |
| `/abrechnung/kinderzahl` | None. | Child-number list records every number shown. |
| `/abrechnung/kinderzahl/import` | None. | File picker, preview and import run only from interaction. |
| `/abrechnung/kostentraeger` | None. | Shares log each contract shown; form select/edits remain opening-specific. |
| `/abrechnung/lastschrift` | None. | Mandate search, list/detail and histories run as prescribed by their opening contracts; no passive prefetch of bank data. |
| `/abrechnung/lastschrift/[contractId]` | None. | Mandate and history are opening reads; collections depend on authorized mandates. |
| `/abrechnung/lastschrift/import` | Creditor and import log for billing managers. | File preview/import gated by local upload; references to office members use fresh reads. |
| `/abrechnung/mensa` | School meal tariffs. | Editor selection and writes stay local. |
| `/abrechnung/monatsbeitraege` | Run summaries and tariffs. | School choices for a new month load after opening the create action. |
| `/abrechnung/monatsbeitraege/[id]` | None. | Run, letter status and invoice previews are audited or write previews. |
| `/abrechnung/monatsbeitraege/[id]/empfaenger/[contractId]` | Debtor-number settings. | Run, family and mandates are opening reads. |
| `/abrechnung/monatsbeitraege/[id]/faelligkeiten` | None. | Run detail is audited and gates due-date form. |
| `/abrechnung/monatsbeitraege/[id]/rechnung/[contractId]` | None. | Audited run/history and amendment write preview. |
| `/abrechnung/monatsbeitraege/[id]/schreiben` | None. | Run, letter status and documents are audited or downloads. |
| `/abrechnung/nachweise` | None. | Evidence reads log each contract shown. |
| `/abrechnung/preise` | Tariffs and care reduction rules. | School/price edits and local tabs do not add first-view reads. |
| `/ankunft-abholung` | Aggregate heatmap, last 28 Berlin days through yesterday. | Other dates and school selection belong to the view. |
| `/anmeldephasen` | Phase list and schools. | Phase changes/downloads stay on action. |
| `/anmeldephasen/[id]` | Phase by ID and schools. | Versioned edits and rollout are not seeded. |
| `/anmeldephasen/[id]/angebote/[offeringId]` | Parent phase by ID; client selects offering from that same result. | Offering form writes keep their existing version behavior. |
| `/anmeldephasen/[id]/angebote/neu` | Parent phase by ID. | New offering uses form state. |
| `/anmeldephasen/[id]/vorschau` | Phase and schools. | Rollout preview is a POST write preview. |
| `/anmeldephasen/neu` | Schools. | Blank form, creates only on submit. |
| `/auslastung` | Aggregate utilization with the initial Berlin preset. | Named children load on explicit click and log access. Other filters and export stay on action. |
| `/belegung` | Aggregate school occupancy. | Local filters reuse the result; exports remain actions. |
| `/berichte` | Templates and key-date report (standard or resolved template). | `vorlage` and `stichtag` choose the report. Unknown template falls back only after the template list succeeds. |
| `/berichte/vorlagen/[id]` | Templates and schools. | Local editor chooses ID from the list, with version checks on writes. |
| `/berichte/vorlagen/neu` | Templates and schools. | `kopie` can fill the new form from the list, without reading a different record. |
| `/demo` | None. | Public demo entry establishes a session; setup and exit are actions. |
| `/dokumente` | Document and release metadata, and schools. | Upload/release actions and file downloads stay out of the seed. |
| `/dokumente/[id]` | Document list, schools and authorized release audiences. | Client locates ID in the same list. File reads and release changes stay on action. |
| `/einstellungen` | Organization settings schema. | `bereich` selects the section; contact uses the master-data response (see below); future shifts appear in the disable confirmation only. |
| `/einstellungen/abrechnung` | Settings schema and issuers; billing defaults and number ranges under existing module/right gates. | The master-data GET writes a read audit. Issuer ranges require nonempty issuer metadata. Edits still use saved versions and explicit actions. |
| `/einstellungen/briefkopf` | Settings schema. | Master data writes a read audit. Logo file handling and editing use their existing routes. |
| `/einstellungen/briefkopf/vorlagen` | Template summaries. | Form previews occur on opening the appropriate editor. |
| `/einstellungen/briefkopf/vorlagen/[kind]` | Saved template for a supported kind. | Master data writes a read audit. Version-bound draft/visual preview goes through the existing editor, not the server seed. |
| `/einstellungen/dokumentarten` | Document kinds and issuers, only for a billing manager. | Editing kinds/issuers and previews stay on action. |
| `/einstellungen/mitglieder` | None. | Office members and invitations use a fresh opening read; account history stays in its audit context. |
| `/einstellungen/module` | Current organization and booked modules (also used by shell). | Module booking controls remain unchanged. |
| `/einstellungen/schulrollen` | Roles and permission catalog as one complete key. | Removal impact is a fresh opening preview. |
| `/einstellungen/zugriffsprotokoll` | Schools. | The audit log page and identity-filter options both log access; local window/as-of and paging remain client-owned. |
| `/einstellungen/zustaendigkeiten` | Settings schema. | The responsibilities GET writes a read audit; issuer status depends on that opening. Changes stay in their versioned editors. |
| `/ferien` | Period summaries. | Downloads and creation are actions. |
| `/ferien/[id]` | Period and schools. | Calendar/draft editing and links stay client-side. |
| `/ferien/[id]/anmeldungen` | Period, schools and confirmation settings. | Registration list, sibling/look-up and named entries follow reviewed/audited paths; filter and retry actions are not seeded. |
| `/ferien/[id]/anmeldungen/[registrationId]` | Period and confirmation settings. | Registration detail, contribution/debtor reads, health, known children and documents stay on audited/opening paths. |
| `/ferien/[id]/formular` | Period and saved form. | Draft editing, files and test/preview remain interaction-specific. |
| `/ferien/[id]/plaetze` | Period and schools. | Counts write a holiday read audit. Exports and edits remain explicit. |
| `/ferien/[id]/vergabe` | Period and schools. | Allocation board records every read; proposal/history stays under the period policy and opening. |
| `/ferien/kriterien` | Criteria and order. | Reordering and edits use versions/actions. |
| `/ferien/neu` | Schools. | Blank period creation form. |
| `/invite` | None. | Public token-bound invitation flow. |
| `/konto` | Own profile, shared with the shell, then remembered devices. | Name and password updates are actions. |
| `/login` | None. | Public login, MFA, choose organization and destination discovery for the successful session. |
| `/nachweise` | School proof kind metadata. | Disclosed personnel proofs are audited; file and edit reads stay on action. |
| `/personal` | None. | Personnel directory uses released school data and logs read access; personnel link preview is a write preview. |
| `/personal/[id]` | None. | Personnel record/financial data, absence and time accounts are audited/opening reads; ID does not set authority. |
| `/personal/abwesenheitsarten` | Current absence types. | Edits/toggles maintain versioned read state. |
| `/personal/einsatzplanung` | None. | Named personnel planning writes school access entries. Week selection and edit previews are local. |
| `/personal/einstellen` | None. | Staff overview is audited and controls the available schools; new staff data comes from the wizard. |
| `/personal/import` | Import history. | File picker and write preview stay local. |
| `/personal/lohnexport` | Settings schema and employers for the setup tab (`tab=einrichtung` or legacy `lohnarten`). | Payroll and time checks are previews for the selected month/file; downloading is an action. |
| `/personal/vertretungspool` | None. | Named personnel pool/assignment data uses the workforce access gate. Week selection and blocking/unblocking are existing interactions. |
| `/reset-password` | None. | Public token-reset flow. |
| `/schliesstage` | Calendar of the initial Berlin year and pending notices for settings managers. | Other years, closure impact and delete preview are actions. |
| `/schulen/[id]` | Data of one school by ID; Go checks its membership in the current Träger. | `bereich` switches to contacts/responsibilities (additional reads are listed below); school handoff is a write. |
| `/standortvergleich` | Aggregate comparison over the initial Berlin preset and school options. | User-chosen schools/time windows and exports stay on their own keys/actions. |
| `/tagesmeldung` | None. | Daily attendance logs reads per school and period. |
| `/uebersicht` | Aggregate school alerts/counts and missing-details notice. | Retry and count refresh remain in existing readers; dashboard module/portal rights stay in Go. |
| `/vertraege` | Conclusion methods and school options. | Initial list, filters and candidate intake log disclosure. Additional pages and exports stay on action. |
| `/vertraege/[id]` | None. | Contract and document openings are fresh/audited; notices, family billing, changes and confirmation previews stay at their existing gates. |
| `/vertraege/anmeldungen` | Schools. | A chosen school's contract enrollment data is a fresh/write preview. |
| `/vertraege/bedingungen` | Saved contract templates. | Writes and their previews are not seeded. |
| `/vertraege/geschwister` | None. | Named sibling/contract families are audited; histories and editor stay separate. |
| `/vertraege/import` | Import history for contract managers. | Upload preview, import and named performer lookup are not seeded. |
| `/vertraege/module-zuordnen` | None. | File flow without a first read; preview and apply wait for upload. |
| `/vertraege/nachpflege` | Correction history for contract managers. | File-based write preview and performer lookup stay unchanged. |
| `/vertraege/verknuepfen` | None. | Pairing preview/review depends on a local file or chosen records and logs reads. |
| `/zeitvergleich` | None. | Named opening reads always log access; summary reads log it on a throttle, so neither may run during prefetch. |

## Projection boundaries and verification

- The Operator school drill-in resolves the school via audited summaries; device and PWA reads stay after that authorization chain. The server does not resolve it from an untrusted slug alone.
- The Träger school responsibility tab uses the organization-wide responsibility/issuer payload. It stays in the client: it would serialize contacts for schools not displayed on that route. The master-data GET also writes a read audit; on the contact-only settings tab the full payload would embed unused bank data. The existing keys require the full values.
- Browser/performance and live session invalidation are integration checks, not proven by loader tests alone.

## Local performance candidates

| Portal | Internal route | Visible seed-dependent anchor |
|---|---|---|
| School | `/school/tagesinformationen` | Exact title of a seeded leadership notice inside the main content, not the page heading. |
| Träger | `/traeger` | School-name cell of the seeded school in the school table. |
| Operator | `/operator/organizations` | Träger-name cell in the organization table. Count/stat cards are a separate key. |
| Caterer | `/caterer` | Seeded school row with a numeric order total and no loading state in the selected week. |

Measure hard load, cold navigation with and without intent, then warm/back navigation. Count the identical BFF GET for the seeded key separately from ordinary focus/SSE/refusal reloads. For Caterer also fail one supplied school inside the compact read: the aggregate must be incomplete and only that school retried. Revoke a supply during refresh: its row and cached details must disappear.
