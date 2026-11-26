package api

import (
	"strings"

	settings "github.com/moto-ogs/project-phoenix/modules/settings"
)

// moduleRouteBasis marks a route of moto Basis: every school has it, no
// module switch locks it.
const moduleRouteBasis settings.ModuleKey = ""

// moduleRouteRule assigns every route below prefix to one module or to
// Basis (#4893). A prefix segment "*" stands for exactly one path segment,
// a path parameter such as {id} in the route table.
type moduleRouteRule struct {
	prefix string
	module settings.ModuleKey
}

// moduleRouteRules is the module map of the production router. Every route
// matches at least one rule; the most specific one wins (more segments,
// then fewer wildcards). There is deliberately no catch-all: a route under
// a new path prefix fails TestFullProductionRouterGolden until it gets a
// rule here. The reasons for borderline cases are in
// docs/reference/modulschalter.md, section "Routen".
//
// The lock in api.TenantScopeMiddleware refuses every module route except
// the surfaces in moduleRoutesLockedElsewhere. Kiosk routes carry no session;
// gateDeviceAuthentication locks them behind the device authenticator
// (#4896). The Träger portal binds a Träger, not a school;
// api.TraegerScopeMiddleware locks its routes (#6052).
var moduleRouteRules = []moduleRouteRule{
	// Infrastructure, sign-in and the operator portal.
	{"/", moduleRouteBasis},
	{"/health", moduleRouteBasis},
	{"/ready", moduleRouteBasis},
	{"/analytics-consent", moduleRouteBasis},
	{"/analytics-policy", moduleRouteBasis},
	{"/internal", moduleRouteBasis},
	{"/auth", moduleRouteBasis},
	{"/operator", moduleRouteBasis},
	{"/.well-known", moduleRouteBasis},
	{"/public/calendar", moduleRouteBasis},
	{"/public/login-image", moduleRouteBasis},
	{"/public/request-feed", moduleRouteBasis},
	{"/webhooks", moduleRouteBasis},
	// #4805: the payroll office's one-time link. The file was already sent;
	// only a close of a school that books Zeiterfassung queues one.
	{"/public/payroll-download", moduleRouteBasis},
	// #4679: the one-time link to sign a care contract of a Träger. Only a
	// Träger with Verträge und Dokumente sends one; parents finish what the
	// office already sent, like the payroll office its download (#6052).
	{"/public/care-contract-signing", moduleRouteBasis},
	// The return of a school's or Träger's data on a change of provider
	// (Data Act, ADR 0201) belongs to every contract, whatever its modules.
	{"/public/data-return", moduleRouteBasis},
	{"/public/enrollment-legal-documents", settings.ModuleOnlineAnmeldung},
	{"/public/enrollment-form-legal-documents", settings.ModuleOnlineAnmeldung},

	// Portals and devices (#4895, #4896).
	{"/auth/guardian-invitations", settings.ModuleElternApp},
	// The team resends a parent's invitation in the tenant chain (#4895).
	{"/auth/guardian-invitations/*/resend", settings.ModuleElternApp},
	{"/parent", settings.ModuleElternApp},
	{"/parent-sse", settings.ModuleElternApp},
	{"/parent-news-attachments", settings.ModuleElternApp},
	{"/parent/enrollments", settings.ModuleOnlineAnmeldung},
	{"/school", settings.ModuleUnterrichtVormittag},
	{"/school/auth", settings.ModuleUnterrichtVormittag},
	{"/school-sse", settings.ModuleUnterrichtVormittag},
	// Fotos und Dateien des Team-Chats im Schulportal (#6685).
	{"/school-staff-messages", settings.ModuleUnterrichtVormittag},

	// The Träger portal (#6052). Its frame is moto Basis: sign-in, the
	// office's accounts, the school list and a school's detail, settings and
	// master data, the Träger's documents, closing days, enrollment phases
	// and Personal. A module counts for the Träger once one of its schools
	// books it; TraegerScopeMiddleware locks the routes below.
	{"/traeger", moduleRouteBasis},

	// Träger-Übersicht: the dashboard, occupancy, utilization, arrival and
	// pickup, the comparison of schools, the daily report and the reports.
	{"/traeger/schools/alerts", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/day-changes", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/occupancy", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/utilization", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/*/utilization", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/arrival-pickup-times", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/comparison", settings.ModuleTraegerUebersicht},
	{"/traeger/schools/daily-attendance", settings.ModuleTraegerUebersicht},
	{"/traeger/reports", settings.ModuleTraegerUebersicht},
	{"/traeger/report-templates", settings.ModuleTraegerUebersicht},
	// "Länger als gebucht" is an evaluation behind the right "Berichte lesen".
	{"/traeger/care-time-overruns", settings.ModuleTraegerUebersicht},

	// Ferienbetreuung: holiday periods, their registrations and what one
	// registration costs. The public registration link carries no session.
	{"/traeger/holiday-periods", settings.ModuleFerienbetreuung},
	{"/traeger/holiday-contributions", settings.ModuleFerienbetreuung},
	{"/traeger/holiday-registrations", settings.ModuleFerienbetreuung},
	{"/traeger/holiday-quotes", settings.ModuleFerienbetreuung},

	// Verträge und Dokumente: care contracts with templates, signature,
	// notices, import and corrections.
	{"/traeger/contracts", settings.ModuleVertraege},
	{"/traeger/contract-templates", settings.ModuleVertraege},
	{"/traeger/contract-notices", settings.ModuleVertraege},
	{"/traeger/contract-imports", settings.ModuleVertraege},
	{"/traeger/contract-corrections", settings.ModuleVertraege},
	{"/traeger/contract-child-links", settings.ModuleVertraege},
	{"/traeger/contract-enrollments", settings.ModuleVertraege},
	{"/traeger/contract-changes", settings.ModuleVertraege},

	// Elternbeiträge und Abrechnung: billing runs, invoices and letters,
	// monthly contributions, SEPA and the finance export.
	{"/traeger/billing-runs", settings.ModuleElternbeitraege},
	{"/traeger/billing-run-due-dates", settings.ModuleElternbeitraege},
	{"/traeger/billing-document-kinds", settings.ModuleElternbeitraege},
	{"/traeger/billing-families", settings.ModuleElternbeitraege},
	{"/traeger/billing-terms", settings.ModuleElternbeitraege},
	{"/traeger/number-ranges", settings.ModuleElternbeitraege},
	{"/traeger/family-billing", settings.ModuleElternbeitraege},
	{"/traeger/family-children", settings.ModuleElternbeitraege},
	{"/traeger/cost-bearers", settings.ModuleElternbeitraege},
	// The rules of the holiday contribution stand on the billing defaults
	// behind the right "Abrechnung", beside the number ranges.
	{"/traeger/contribution-rules", settings.ModuleElternbeitraege},
	{"/traeger/care-billing-runs", settings.ModuleElternbeitraege},
	{"/traeger/care-tariffs", settings.ModuleElternbeitraege},
	{"/traeger/care-meal-tariffs", settings.ModuleElternbeitraege},
	{"/traeger/care-rules", settings.ModuleElternbeitraege},
	{"/traeger/care-evidences", settings.ModuleElternbeitraege},
	{"/traeger/care-cost-shares", settings.ModuleElternbeitraege},
	{"/traeger/care-notice-runs", settings.ModuleElternbeitraege},
	{"/traeger/sepa-creditor", settings.ModuleElternbeitraege},
	{"/traeger/sepa-mandates", settings.ModuleElternbeitraege},
	{"/traeger/sepa-debits", settings.ModuleElternbeitraege},
	{"/traeger/finance-exports", settings.ModuleElternbeitraege},
	{"/traeger/finance-handovers", settings.ModuleElternbeitraege},
	{"/traeger/export-recipient", settings.ModuleElternbeitraege},

	{"/api/iot", settings.ModuleNFCAnwesenheit},
	{"/api/iot/staff-clock", settings.ModuleZeiterfassung},

	// moto Basis under /api.
	{"/api/active", moduleRouteBasis},
	{"/api/activities", moduleRouteBasis},
	{"/api/admin", moduleRouteBasis},
	{"/api/birthdays", moduleRouteBasis},
	// "Heute anders" is a block of the Basis start page (#7659).
	{"/api/day-changes", moduleRouteBasis},
	{"/api/caldav", moduleRouteBasis},
	{"/api/calendar", moduleRouteBasis},
	{"/api/class-list-entries", moduleRouteBasis},
	{"/api/database", moduleRouteBasis},
	{"/api/display", moduleRouteBasis},
	{"/api/emergency", moduleRouteBasis},
	{"/api/feedback", moduleRouteBasis},
	{"/api/files", moduleRouteBasis},
	{"/api/groups", moduleRouteBasis},
	{"/api/guardians", moduleRouteBasis},
	// The hosting school's holiday guests (#4666) and participant lists
	// (#4665); see docs/reference/modulschalter.md.
	{"/api/holiday-guests", moduleRouteBasis},
	{"/api/holiday-weeks", moduleRouteBasis},
	{"/api/import", moduleRouteBasis},
	{"/api/me", moduleRouteBasis},
	{"/api/notifications", moduleRouteBasis},
	{"/api/platform", moduleRouteBasis},
	{"/api/pwa", moduleRouteBasis},
	{"/api/reminders", moduleRouteBasis},
	{"/api/rooms", moduleRouteBasis},
	{"/api/school-setup", moduleRouteBasis},
	// The school search (ADR 0231); see docs/reference/modulschalter.md.
	{"/api/search", moduleRouteBasis},
	{"/api/settings", moduleRouteBasis},
	{"/api/sse", moduleRouteBasis},
	{"/api/staff", moduleRouteBasis},
	{"/api/staff-messages", moduleRouteBasis},
	{"/api/staff-notices", moduleRouteBasis},
	// #4769: the weekly protocols of the groups record the Basis day log and
	// planning; the module catalog files them under Planung, which has no switch.
	{"/api/week-protocols", moduleRouteBasis},
	{"/api/staff-onboarding", moduleRouteBasis},
	{"/api/statistics", moduleRouteBasis},
	{"/api/students", moduleRouteBasis},
	{"/api/substitutions", moduleRouteBasis},
	// Staff and parent surveys (#4781); see docs/reference/modulschalter.md.
	{"/api/surveys", moduleRouteBasis},
	{"/api/timetable", moduleRouteBasis},
	// Changed opening hours (#7654) belong to the closing days of the timetable page.
	{"/api/opening-changes", moduleRouteBasis},
	// The notices of changed school closing days (ADR 0196) belong to the
	// closing days of the timetable page.
	{"/api/holiday-closure-notices", moduleRouteBasis},
	// Documents the Träger shared (#4692); see docs/reference/modulschalter.md.
	{"/api/traeger-documents", moduleRouteBasis},
	{"/api/users", moduleRouteBasis},

	// NFC-Anwesenheit: armbands and cards of a child.
	{"/api/students/*/rfid", settings.ModuleNFCAnwesenheit},

	// Mittagessen und Catering.
	{"/api/meal-plan", settings.ModuleMittagessen},
	{"/api/meal-caterer", settings.ModuleMittagessen},
	{"/api/meal-billing-months", settings.ModuleMittagessen},
	{"/caterer", settings.ModuleMittagessen},

	// Eltern-App: messages and letters to parents, parent-portal invitations.
	{"/api/messages", settings.ModuleElternApp},
	{"/api/parent-announcements", settings.ModuleElternApp},
	{"/api/announcement-attachments", settings.ModuleElternApp},
	{"/api/guardians/invitations", settings.ModuleElternApp},
	{"/api/guardians/invitable", settings.ModuleElternApp},
	{"/api/guardians/bulk-invite", settings.ModuleElternApp},
	{"/api/guardians/without-account", settings.ModuleElternApp},
	{"/api/guardians/*/invite", settings.ModuleElternApp},
	{"/api/guardians/students/*/invite", settings.ModuleElternApp},

	// Online-Anmeldung: phases, forms, care offerings and requests, and the
	// public intake and status links.
	{"/api/enrollment", settings.ModuleOnlineAnmeldung},
	{"/api/enrollment/*/submit", settings.ModuleOnlineAnmeldung},
	{"/api/enrollment/*/uploads", settings.ModuleOnlineAnmeldung},
	{"/api/enrollment/phases/public", settings.ModuleOnlineAnmeldung},
	{"/api/enrollment/form-bootstrap/public", settings.ModuleOnlineAnmeldung},
	{"/api/enrollment/legal", settings.ModuleOnlineAnmeldung},
	{"/api/enrollment/requests", settings.ModuleOnlineAnmeldung},
	// The contracts the Träger made from the application children, read on
	// the enrollment detail (#4788). Not Verträge und Dokumente: that module
	// counts for the Träger, and the school that received the application
	// reads what became of it whichever of the Träger's schools books it.
	{"/api/care-contracts", settings.ModuleOnlineAnmeldung},

	// Dienstplan.
	{"/api/staff-shifts", settings.ModuleDienstplan},
	// The Springer of the Träger are planned with the Dienstplan (#4709).
	{"/api/staff-pool", settings.ModuleDienstplan},
	{"/api/shift-types", settings.ModuleDienstplan},
	{"/api/timetable/shift-coverage", settings.ModuleDienstplan},

	// Zeiterfassung: clock, work-time models, staff absences and vacation,
	// balances and the payroll export.
	{"/api/time-tracking", settings.ModuleZeiterfassung},
	// Basis inside /api/time-tracking: the own care-plan blocks on the home
	// page, and the school's holidays and closing days the planning shows.
	{"/api/time-tracking/assignments", moduleRouteBasis},
	{"/api/time-tracking/holidays", moduleRouteBasis},
	{"/api/time-tracking/closing-days", moduleRouteBasis},
	// The own shifts behind "Mein Dienstplan".
	{"/api/time-tracking/shifts", settings.ModuleDienstplan},
	{"/api/work-time-models", settings.ModuleZeiterfassung},
	{"/api/absence-types", settings.ModuleZeiterfassung},
	{"/api/import/opening-balances", settings.ModuleZeiterfassung},
	{"/api/settings/payroll-status", settings.ModuleZeiterfassung},
	{"/api/staff/absences", settings.ModuleZeiterfassung},
	{"/api/staff/time-tracking", settings.ModuleZeiterfassung},
	{"/api/staff/*/absences", settings.ModuleZeiterfassung},
	{"/api/staff/*/time-tracking", settings.ModuleZeiterfassung},
	{"/api/staff/*/vacation", settings.ModuleZeiterfassung},
	{"/api/staff/*/target-overrides", settings.ModuleZeiterfassung},
	{"/api/staff/*/schedule", settings.ModuleZeiterfassung},
	{"/api/staff/*/payroll-number", settings.ModuleZeiterfassung},

	// Personalakte: HR file, documents and bank and tax data.
	{"/api/staff/*/stammdaten", settings.ModulePersonalakte},
	{"/api/staff/*/documents", settings.ModulePersonalakte},
	{"/api/staff/documents-directory", settings.ModulePersonalakte},
	{"/api/staff/documents-profile", settings.ModulePersonalakte},
	{"/api/staff/financial-profile", settings.ModulePersonalakte},
}

// moduleRoutesLockedElsewhere names, per rule prefix, the module routes the
// tenant-scope lock leaves alone and who locks them instead: the portal
// sessions, or the owner where the route resolves its
// school from the path or a token rather than from a session.
var moduleRoutesLockedElsewhere = map[string]string{
	// The caterer portal spans schools: its session belongs to no school and
	// every school route re-checks the supply (ADR 0077).
	"/caterer": "#4895 Caterer-Portal: schulübergreifende Sitzung, Belieferung je Schule",
	// The parents portal spans schools: ParentScopeMiddleware locks the
	// account once none of its guardian schools books Eltern-App, login and
	// refresh refuse its session (#4895). Its enrollment routes additionally
	// need Online-Anmeldung at the school: enrollment.enabled counts only
	// while the module is booked.
	"/parent":                  "#4895 Elternportal: Eltern-Sitzung und ParentScopeMiddleware",
	"/parent-sse":              "#4895 Elternportal: Eltern-Sitzung und ParentScopeMiddleware",
	"/parent-news-attachments": "#4895 Elternportal: Eltern-Sitzung und ParentScopeMiddleware",
	"/parent/enrollments":      "#4895 Elternportal: Eltern-Sitzung, Anmeldung über enrollment.enabled",
	// The public sign-in of the school portal carries no session yet;
	// Identity & Access refuses its login, second factor and switch for a
	// school without Unterricht am Vormittag (#4895). Every other /school
	// route passes SchoolScopeMiddleware.
	"/school/auth": "#4895 Schulportal: Anmeldung prüft das Modul in Identity & Access",
	// Accepting an invitation creates the account, no session; the login
	// afterwards refuses a school without Eltern-App (#4895).
	"/auth/guardian-invitations": "#4895 Elternportal: Einladung annehmen stellt keine Sitzung aus, der Login sperrt",
	// Public enrollment: enrollment.enabled counts only while the module is
	// booked (EnrollmentIntakeValues.EnrollmentEnabled), status links close
	// in Intake.requestByStatusToken.
	"/api/enrollment/*/submit":                "Anmeldung: enrollment.enabled nur mit gebuchtem Modul",
	"/api/enrollment/*/uploads":               "Anmeldung: enrollment.enabled nur mit gebuchtem Modul",
	"/api/enrollment/phases/public":           "Anmeldung: enrollment.enabled nur mit gebuchtem Modul",
	"/api/enrollment/form-bootstrap/public":   "Anmeldung: enrollment.enabled nur mit gebuchtem Modul",
	"/api/enrollment/requests":                "Anmeldung: Statuslink schließt mit dem Modul",
	"/api/enrollment/legal":                   "Anmeldung: Rechtstexte der Schule, keine Personendaten",
	"/public/enrollment-legal-documents":      "Anmeldung: Rechtstexte der Schule, keine Personendaten",
	"/public/enrollment-form-legal-documents": "Anmeldung: Rechtstexte der Schule, keine Personendaten",
	// The public holiday registration carries no session: its link resolves
	// the Träger, and holidayTraegerDirectory closes the link of a Träger
	// none of whose schools books Ferienbetreuung (#6052). The quote of the
	// form and the PDFs of the period (#5199) resolve the same link.
	"/traeger/holiday-registrations": "#6052 Ferienanmeldung: der Link schließt mit dem Modul",
	"/traeger/holiday-quotes":        "#6052 Ferienanmeldung: der Link schließt mit dem Modul",
}

// moduleRouteFor returns the most specific rule covering a request path or
// a route pattern. Both shapes resolve alike: a rule segment "*" matches a
// concrete value and a {param} placeholder.
func moduleRouteFor(path string) (moduleRouteRule, bool) {
	segments := routeSegments(path)
	best, found := moduleRouteRule{}, false
	bestLength, bestWildcards := -1, 0
	for _, rule := range moduleRouteRules {
		ruleSegments := routeSegments(rule.prefix)
		wildcards, ok := matchRoutePrefix(ruleSegments, segments)
		if !ok {
			continue
		}
		if len(ruleSegments) > bestLength || (len(ruleSegments) == bestLength && wildcards < bestWildcards) {
			best, found = rule, true
			bestLength, bestWildcards = len(ruleSegments), wildcards
		}
	}
	return best, found
}

// matchRoutePrefix reports whether prefix covers the leading path segments
// and how many of its segments were wildcards.
func matchRoutePrefix(prefix, path []string) (int, bool) {
	// The root rule "/" covers only the root route, never every path.
	if len(prefix) > len(path) || (len(prefix) == 0 && len(path) > 0) {
		return 0, false
	}
	wildcards := 0
	for i, segment := range prefix {
		if segment == "*" {
			wildcards++
			continue
		}
		if segment != path[i] {
			return 0, false
		}
	}
	return wildcards, true
}

func routeSegments(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}
