package api

import (
	"fmt"
	"reflect"
	"strings"

	birthdaysAPI "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/birthdays"
	groupsHTTP "github.com/moto-ogs/project-phoenix/modules/schoolstructure/http"
	statisticsHTTP "github.com/moto-ogs/project-phoenix/modules/statistics/http"
	gradeTransitionHTTP "github.com/moto-ogs/project-phoenix/workflows/gradetransition/http"

	parentMessagingAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/parentmessages"
	platformAnnouncementsHTTP "github.com/moto-ogs/project-phoenix/modules/communication/http/platformannouncements"
	devicesAPI "github.com/moto-ogs/project-phoenix/modules/devicefleet/http/devices"
	roomsHTTP "github.com/moto-ogs/project-phoenix/modules/facilities/http"
	filestoreAPI "github.com/moto-ogs/project-phoenix/modules/filestorage/http/files"
	mealplanHTTP "github.com/moto-ogs/project-phoenix/modules/mealplan/http"
	guardiansHTTP "github.com/moto-ogs/project-phoenix/modules/peopledirectory/http"
	classListHTTP "github.com/moto-ogs/project-phoenix/modules/schoolmembership/http/classlistentries"
	"github.com/moto-ogs/project-phoenix/modules/schoolsetup"
	schoolSetupHTTP "github.com/moto-ogs/project-phoenix/modules/schoolsetup/http"

	"github.com/moto-ogs/project-phoenix/analytics"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/contract"
	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	careStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/careplan/http"
	requestFeedHTTP "github.com/moto-ogs/project-phoenix/modules/careplan/requestfeed/http"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	classdayHTTP "github.com/moto-ogs/project-phoenix/modules/classday/http"
	operatorAnnouncementsHTTP "github.com/moto-ogs/project-phoenix/modules/communication/http/operatorannouncements"
	announcementAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/parentannouncements"
	staffMessagingAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/staffmessages"
	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
	notificationsHTTP "github.com/moto-ogs/project-phoenix/modules/delivery/http/notifications"
	tagScanOperatorAPI "github.com/moto-ogs/project-phoenix/modules/devicefleet/inbound/operator"
	enrollmentOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	exportTransferHTTP "github.com/moto-ogs/project-phoenix/modules/exporttransfer/http"
	meAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/me"
	identityOperatorAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/operator"
	provisioningOperatorAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	organizationTenancyTraeger "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/traeger"
	parentBillingHTTP "github.com/moto-ogs/project-phoenix/modules/parentbilling/http"
	peopleStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/peopledirectory/inbound/students"
	projectionStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	"github.com/moto-ogs/project-phoenix/modules/requestreview"
	reviewStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/requestreview/http"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	settingsHTTP "github.com/moto-ogs/project-phoenix/modules/settings/http"
	settingsOperatorAPI "github.com/moto-ogs/project-phoenix/modules/settings/inbound/operator"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	presenceStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/studentpresence/http"
	timetableHTTP "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	traegerPortalHTTP "github.com/moto-ogs/project-phoenix/modules/traegerportal"
	traegerViewHTTP "github.com/moto-ogs/project-phoenix/modules/traegerview/http"
	statsContract "github.com/moto-ogs/project-phoenix/modules/transactionruntime/stats"
	workforceModule "github.com/moto-ogs/project-phoenix/modules/workforce"
	absencetypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
	staffShiftsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/staffshifts"
	substitutionsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/substitutions"
	timeTrackingHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/timetracking"
	workforceTraegerStaff "github.com/moto-ogs/project-phoenix/modules/workforce/http/traegerstaff"
	worktimemodelsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/worktimemodels"
	catererPortalHTTP "github.com/moto-ogs/project-phoenix/workflows/catererportal/http"
	holidayClosureHTTP "github.com/moto-ogs/project-phoenix/workflows/holidayclosurenotification/http"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
	staffPersonMergeHTTP "github.com/moto-ogs/project-phoenix/workflows/staffpersonmerge/http"
	deleteStudentsHTTP "github.com/moto-ogs/project-phoenix/workflows/studentdeletion/http"
	traegerCatalogHTTP "github.com/moto-ogs/project-phoenix/workflows/traegercatalog/http"
)

// contractMount is the typed registration of an owner under its mount.
type contractMount struct {
	prefix string
	routes []common.RouteContract
}

// traegerBillingContractMounts are the Elternabrechnung, the care contracts
// and their evaluations in the Träger-Portal (#2352).
func traegerBillingContractMounts() []contractMount {
	return []contractMount{
		{"/traeger/billing-runs", parentBillingHTTP.BillingRunRouteContracts()},
		{"/traeger/number-ranges", parentBillingHTTP.NumberRangeRouteContracts()},
		{"/traeger/billing-document-kinds", parentBillingHTTP.DocumentKindRouteContracts()},
		{"/traeger/contribution-rules", parentBillingHTTP.ContributionRuleRouteContracts()},
		{"/traeger/cost-bearers", parentBillingHTTP.CostBearerRouteContracts()},
		{"/traeger/care-tariffs", parentBillingHTTP.CareTariffRouteContracts()},
		{"/traeger/care-meal-tariffs", parentBillingHTTP.CareMealTariffRouteContracts()},
		{"/traeger/care-billing-runs", parentBillingHTTP.CareRunRouteContracts()},
		{"/traeger/care-notice-runs", parentBillingHTTP.CareNoticeRunRouteContracts()},
		{"/traeger/care-rules", parentBillingHTTP.CareRuleRouteContracts()},
		{"/traeger/care-evidences", parentBillingHTTP.CareEvidenceRouteContracts()},
		{"/traeger/care-cost-shares", parentBillingHTTP.CareCostShareRouteContracts()},
		{"/traeger/family-children", parentBillingHTTP.FamilyChildrenRouteContracts()},
		{"/traeger/billing-terms", parentBillingHTTP.BillingTermsRouteContracts()},
		{"/traeger/family-billing", parentBillingHTTP.FamilyBillingRouteContracts()},
		{"/traeger/billing-run-due-dates", parentBillingHTTP.DueDateRouteContracts()},
		{"/traeger/sepa-creditor", parentBillingHTTP.SEPACreditorRouteContracts()},
		{"/traeger/sepa-mandates", parentBillingHTTP.SEPAMandateRouteContracts()},
		{"/traeger/sepa-debits", parentBillingHTTP.SEPADebitRouteContracts()},
		{"/traeger/finance-exports", parentBillingHTTP.FinanceExportRouteContracts()},
		{"/traeger/finance-handovers", parentBillingHTTP.ExportHandoverRouteContracts()},
		{"/traeger/contracts", careContractHTTP.ContractRouteContracts()},
		{"/traeger/contract-templates", careContractHTTP.TemplateRouteContracts()},
		{"/traeger/contract-notices", careContractHTTP.NoticeRouteContracts()},
		{"/traeger/contract-changes", careContractHTTP.ChangeRouteContracts()},
		{"/traeger/care-time-overruns", careContractHTTP.OverrunRouteContracts()},
	}
}

// contractRegistrations lists every typed registration under its mount and
// refuses one the route catalog does not know.
func contractRegistrations() ([]contract.Registration, error) {
	mounts := append(contractMounts(), traegerBillingContractMounts()...)
	mounts = append(mounts, operatorContractMounts()...)
	mounts = append(mounts, traegerContractMounts()...)
	mounts = append(mounts, staffPortalContractMounts()...)
	mounts = append(mounts, staffPortalAdminContractMounts()...)
	mounts = append(mounts, staffPortalEnrollmentContractMounts()...)
	mounts = append(mounts, staffPortalCalendarContractMounts()...)
	mounts = append(mounts, staffPortalLiveContractMounts()...)
	mounts = append(mounts, rootContractMounts()...)
	mounts = append(mounts, publicContractMounts()...)
	mounts = append(mounts, staffPortalInvitationContractMounts()...)
	catalog, err := RouteCatalog()
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(catalog))
	for _, route := range catalog {
		known[route.Method+" "+route.Pattern] = true
		// A router mounted at "/" shows as "/*/" in the catalog; a request
		// reports the pattern without it, as chi's RoutePattern does.
		known[route.Method+" "+strings.ReplaceAll(route.Pattern, "/*/", "/")] = true
	}
	var registrations []contract.Registration
	for _, mount := range mounts {
		for _, route := range mount.routes {
			registration := contractRegistration(mount.prefix, route)
			if !known[registration.Method+" "+registration.Pattern] {
				return nil, fmt.Errorf("typed route %s %s is not in the route catalog", registration.Method, registration.Pattern)
			}
			registrations = append(registrations, registration)
		}
	}
	return registrations, nil
}

// contractMounts lists every owner's typed registrations under its mount.
func contractMounts() []contractMount {
	return []contractMount{
		{"/api/students", projectionStudentsHTTP.StudentRouteContracts()},
		// The projection renders the answer of Care Plan's student writes
		// (studentHTTPResources binds it), so its type is named here.
		{"/api/students", careStudentsHTTP.StudentWriteContracts(projectionStudentsHTTP.StudentResponse{})},
		// Request Review renders the answers of Care Plan's review routes.
		{"/api/students", careStudentsHTTP.StudentRouteContracts(careStudentsHTTP.DecisionResponses{
			CareDecision: requestreview.CareRequestResponse{}, CareDetail: reviewStudentsHTTP.CareRequestDetailResponse{},
			MasterDataDecision: requestreview.MasterDataChangeRequestResponse{}, ExcusedDecision: requestreview.StaffExcusedRequestResponse{},
		})},
		{"/api/students", peopleStudentsHTTP.RouteContracts()},
		{"/api/students", presenceStudentsHTTP.StudentRouteContracts()},
		{"/api/students", deleteStudentsHTTP.StudentRouteContracts()},
		{"/api/students", reviewStudentsHTTP.StudentRouteContracts()},
		{"/api/students", enrollmentHTTP.StudentRouteContracts()},
		{"/parent", parentAPI.MeRouteContracts()},
		{"/parent", parentPortalRouteContracts()},
		{"/api/notifications", notificationRouteContracts(common.PortalTenant)},
		{"/school/class-day", classdayHTTP.RouteContracts()},
		{"/school/notifications", notificationRouteContracts(common.PortalSchool)},
		{"/api/parent-announcements", announcementAPI.RouteContracts(common.PortalTenant)},
		{"/school/parent-letters", announcementAPI.RouteContracts(common.PortalSchool)},
		{"/api/staff-messages", staffMessagingAPI.RouteContracts(common.PortalTenant)},
		{"/api/time-tracking", timeTrackingRouteContracts()},
		{"/api/work-time-models", worktimemodelsHTTP.RouteContracts()},
		{"/api/staff", timeTrackingHTTP.StaffAdminRouteContracts()},
		{"/api/staff", staffMembershipRouteContracts()},
		{"/api/absence-types", absenceTypeRouteContracts()},
		{"/api/shift-types", shiftTypeRouteContracts()},
		{"/api/staff-shifts", staffShiftRouteContracts()},
		// Class Day owns the child sheet the supervision route answers with.
		{"/school/calendar", calendarAPI.SchoolRouteContracts()},
		{"/api/timetable", timetableHTTP.RouteContracts()},
		{"/api/week-protocols", timetableHTTP.WeekProtocolRouteContracts()},
		{"/school/staff-notices", timetableHTTP.SchoolStaffNoticeRouteContracts()},
		{"/school/supervisions", timetableHTTP.SchoolSupervisionRouteContracts(classday.SupervisionStudentSheet{})},
		{"/school/staff-messages", staffMessagingAPI.RouteContracts(common.PortalSchool)},
		{"/operator/schools", provisioningOperatorAPI.SchoolDeviceSlotRouteContracts()},
		{"/traeger/master-data", organizationTenancyTraeger.MasterDataRouteContracts()},
		{"/traeger/documents", organizationTenancyTraeger.DocumentRouteContracts()},
		{"/traeger/report-templates", organizationTenancyTraeger.ReportTemplateRouteContracts()},
		{"/traeger/billing-families", parentBillingHTTP.BillingFamilyRouteContracts()},
		{"/traeger/notifications", schoolFeedRouteContracts(common.PortalTraeger)},
		{"/traeger/staff-records", workforceTraegerStaff.RecordRouteContracts()},
		{"/caterer", catererPortalHTTP.RouteContracts()},
		{"/caterer/notifications", schoolFeedRouteContracts(common.PortalCaterer)},
	}
}

// operatorContractMounts are the registered routes of the operator portal
// (#2352), under their /operator mounts.
func operatorContractMounts() []contractMount {
	return []contractMount{
		{"/operator", provisioningOperatorAPI.ProvisioningRouteContracts()},
		{"/operator", identityOperatorAPI.RouteContracts()},
		{"/operator/announcements", operatorAnnouncementsHTTP.RouteContracts()},
		{"/operator/unregistered-tag-scans", unregisteredTagScanRouteContracts()},
		// Data Import fills a test Träger; its http role names no contract types.
		{"/operator/organizations", []common.RouteContract{{
			Method: "POST", Pattern: "/{id}/sample-children", Portals: []common.PortalScope{common.PortalOperator},
			Response: importModels.SampleChildrenResult{},
		}}},
		{"/operator/schools/{id}/settings", careStudentsHTTP.BookingAuthorityImpactRouteContracts()},
		{"/operator/organizations/{id}/beleg-retention", parentBillingHTTP.BelegRetentionRouteContracts()},
		{"/operator/organizations/{id}/staff-release", workforceTraegerStaff.ReleaseRouteContracts()},
		{"/operator/billing", provisioningOperatorAPI.BillingRouteContracts()},
		{"/operator/devices", provisioningOperatorAPI.DeviceRouteContracts()},
		{"/operator/staff-person-merges", staffPersonMergeHTTP.RouteContracts()},
		{"/operator/schools/{id}/settings", settingsOperatorAPI.SchoolRouteContracts(configModels.SettingsSchema{})},
		{"/operator/organizations/{id}/traeger-settings", settingsOperatorAPI.TraegerRouteContracts(configModels.SettingsSchema{})},
	}
}

// ContractDocument builds the model of the frontend/backend contract from
// the typed registrations of every owner (ADR 0270). The mounts repeat the
// ones in the serve mounts; the catalog check fails when they drift apart.
func ContractDocument() (contract.Document, error) {
	registrations, err := contractRegistrations()
	if err != nil {
		return contract.Document{}, err
	}
	substitutions := substitutionsHTTP.RouteContractTypes()
	options := contract.Legacy(map[reflect.Type]string{
		reflect.TypeFor[common.ID]():     contract.KindID,
		reflect.TypeFor[common.JSONID](): contract.KindLaxID,
		// The device management renders its instants in whole seconds.
		reflect.TypeFor[devicesAPI.WireTime](): contract.KindInstant,
		// The answers of an enrollment form: an object of the form's own
		// fields, whatever the school's schema asks for.
		reflect.TypeFor[enrollmentOwner.FormValues](): contract.KindJSON,
		// The substitution bodies take an id as a number or a decimal string.
		reflect.TypeOf(substitutions.LaxID): contract.KindLaxID,
	})
	// Both student bodies only refuse retired keys before the plain decode;
	// CompanionEntry takes its companion id as a number or a decimal string.
	options.Readers = map[reflect.Type]string{
		reflect.TypeFor[careStudentsHTTP.StudentRequest]():       contract.ReadsFields,
		reflect.TypeFor[careStudentsHTTP.UpdateStudentRequest](): contract.ReadsFields,
		reflect.TypeFor[careStudentsHTTP.CompanionEntry]():       contract.ReadsLaxIDs,
		// The absence bodies take absence_type_id as a number or a decimal string.
		reflect.TypeFor[workforceModule.CreateAbsenceRequest](): contract.ReadsLaxIDs,
		reflect.TypeFor[workforceModule.UpdateAbsenceRequest](): contract.ReadsLaxIDs,
		// A corrected break names its id as a number or a decimal string.
		reflect.TypeFor[workforceModule.BreakDurationUpdate](): contract.ReadsLaxIDs,
		// A presence is an object or, from older clients, a bare staff id.
		reflect.TypeFor[timetableHTTP.DeviationPresence](): contract.ReadsFields,
		// The template writes tell an absent key from null.
		reflect.TypeFor[timetableHTTP.NullableInt]():         contract.ReadsValue,
		reflect.TypeFor[timetableHTTP.NullableInt64]():       contract.ReadsValue,
		reflect.TypeFor[timetableHTTP.NullableIntSlice]():    contract.ReadsValue,
		reflect.TypeFor[timetableHTTP.NullableInt64Slice]():  contract.ReadsValue,
		reflect.TypeFor[timetableHTTP.NullableStringSlice](): contract.ReadsValue,
		reflect.TypeFor[timetableHTTP.NullableStr]():         contract.ReadsValue,
		// A phase body tells an absent calendar_period_id from null.
		reflect.TypeFor[enrollmentHTTP.EnrollmentPhaseRequest](): contract.ReadsFields,
		// A school update tells an absent child quota from null (#3567).
		reflect.TypeFor[provisioningOperatorAPI.ChildQuotaField](): contract.ReadsValue,
	}
	// Appointments and the whole-day substitution keep their own day types.
	options.Dates = []reflect.Type{reflect.TypeFor[appointments.Date](), reflect.TypeOf(substitutions.Day)}
	return contract.Build(registrations, options)
}

// notificationRouteContracts registers the notification routes, with patterns
// relative to the /notifications mount of the portal. The staff portal and
// moto schule mount the same routes; only the staff portal has opt-in e-mails.
// Delivery's http role may not import the contract types, so it hands over
// the body types only.
func notificationRouteContracts(portal common.PortalScope) []common.RouteContract {
	types := notificationsHTTP.RouteContractTypes()
	portals := []common.PortalScope{portal}
	page := []common.QueryParam{{Name: "limit", Kind: common.QueryInt}, {Name: "cursor", Kind: common.QueryString}}
	endpoint := []common.QueryParam{{Name: "endpoint", Kind: common.QueryString}}
	routes := []common.RouteContract{
		{Method: "GET", Pattern: "/feed/", Portals: portals, Query: page, Response: types.FeedPage},
		{Method: "GET", Pattern: "/feed/unread-count", Portals: portals, Response: types.FeedCount},
		{Method: "POST", Pattern: "/feed/read-all", Portals: portals, Response: types.FeedCount},
		{Method: "POST", Pattern: "/feed/{id}/read", Portals: portals, Response: types.FeedCount},
		{Method: "GET", Pattern: "/preferences/", Portals: portals, Response: types.Preferences},
		{Method: "DELETE", Pattern: "/preferences/", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/preferences/{type}", Portals: portals, Request: types.PreferenceRequest, NoData: true},
		{Method: "GET", Pattern: "/push/public-key", Portals: portals, Response: types.PushPublicKey},
		{Method: "POST", Pattern: "/push/subscriptions", Portals: portals, Request: types.PushSubscription, NoData: true},
		{Method: "DELETE", Pattern: "/push/subscriptions", Portals: portals, Query: endpoint, NoData: true},
		{Method: "POST", Pattern: "/test", Portals: portals, NoData: true},
	}
	if portal != common.PortalTenant {
		return routes
	}
	return append(routes,
		common.RouteContract{Method: "GET", Pattern: "/email-subscriptions/{type}", Portals: portals, Response: types.EmailSubscription},
		common.RouteContract{Method: "PUT", Pattern: "/email-subscriptions/{type}", Portals: portals, Request: types.PreferenceRequest, NoData: true},
	)
}

// unregisteredTagScanRouteContracts registers the operator's review of
// unregistered RFID scans (#2352), relative to its mount. Device Fleet's
// operator package may not import the contract types, so it hands over the
// answer type only.
func unregisteredTagScanRouteContracts() []common.RouteContract {
	resolveRequest, resolveResponse := tagScanOperatorAPI.ResolveTypes()
	return []common.RouteContract{{
		Method: "POST", Pattern: "/{id}/resolve", Portals: []common.PortalScope{common.PortalOperator},
		Request: resolveRequest, Response: resolveResponse,
	}, {
		Method: "GET", Pattern: "/", Portals: []common.PortalScope{common.PortalOperator},
		Query: []common.QueryParam{
			{Name: "school_id", Kind: common.QueryID}, {Name: "organization_id", Kind: common.QueryID},
			{Name: "resolved", Kind: common.QueryString},
		},
		Response: tagScanOperatorAPI.ListResponse(),
	}}
}

// schoolFeedRouteContracts registers the bell of a portal across schools,
// the Träger-Portal's (#7146) or the caterer portal's (#7147), with patterns
// relative to its /notifications mount.
func schoolFeedRouteContracts(portal common.PortalScope) []common.RouteContract {
	types := notificationsHTTP.RouteContractTypes()
	portals := []common.PortalScope{portal}
	page := []common.QueryParam{{Name: "limit", Kind: common.QueryInt}, {Name: "cursor", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/feed/", Portals: portals, Query: page, Response: types.SchoolFeedPage},
		{Method: "GET", Pattern: "/feed/unread-count", Portals: portals, Response: types.FeedCount},
		{Method: "POST", Pattern: "/feed/read-all", Portals: portals, Response: types.FeedCount},
		{Method: "POST", Pattern: "/feed/{id}/read", Portals: portals, Response: types.FeedCount},
	}
}

func contractRegistration(prefix string, route common.RouteContract) contract.Registration {
	registration := contract.Registration{
		Method: route.Method, Pattern: prefix + route.Pattern,
		Request: route.Request, Response: route.Response, Paginated: route.Paginated, NoData: route.NoData,
		Deprecated: route.Deprecated, DeprecatedFields: route.DeprecatedFields,
		NoRetryAfterRenewal: route.NoRetryAfterRenewal, MaxBodyBytes: route.MaxBodyBytes,
	}
	for _, portal := range route.Portals {
		registration.Portals = append(registration.Portals, string(portal))
	}
	for _, param := range route.Query {
		registration.Query = append(registration.Query, contract.QueryParam{Name: param.Name, Kind: string(param.Kind), Repeated: param.Repeated, Values: param.Values})
	}
	if route.Variants != nil {
		registration.Variants = &contract.VariantSpec{QueryParam: route.Variants.QueryParam, Default: route.Variants.Default, ByValue: route.Variants.ByValue}
	}
	for _, enum := range route.Enums {
		registration.Enums = append(registration.Enums, contract.EnumSpec{Name: enum.Name, Type: enum.Type, Fields: enum.Fields, Values: enum.Values})
	}
	return registration
}

// timeTrackingRouteContracts names the row types the root's adapters render
// for the planned shifts and the allowances of the own time tracking.
func timeTrackingRouteContracts() []common.RouteContract {
	return timeTrackingHTTP.RouteContracts([]staffShiftsHTTP.ShiftResponse{}, []absencetypesHTTP.OwnAllowanceResponse{})
}

// traegerContractMounts are the Träger-Portal's staff, holiday and master
// data routes (#2352), mounted like their resources in the serve mounts.
func traegerContractMounts() []contractMount {
	return []contractMount{
		{"/traeger/absence-types", workforceTraegerStaff.AbsenceTypeRouteContracts()},
		{"/traeger/staff-proofs", workforceTraegerStaff.ProofRouteContracts()},
		{"/traeger/staff-planning", workforceTraegerStaff.PlanningRouteContracts()},
		{"/traeger/staff-pool", workforceTraegerStaff.PoolRouteContracts()},
		{"/traeger/staff-exports", workforceTraegerStaff.ExportRouteContracts()},
		{"/traeger/accounts", traegerPortalHTTP.AccountRouteContracts()},
		{"/traeger/profile", traegerPortalHTTP.ProfileRouteContracts()},
		{"/traeger/school-sessions", traegerPortalHTTP.SchoolSessionRouteContracts()},
		{"/traeger/auth", traegerPortalHTTP.StepUpRouteContracts()},
		{"/traeger/schools", traegerViewHTTP.SchoolRouteContracts()},
		{"/traeger/organization", traegerViewHTTP.OrganizationRouteContracts()},
		{"/traeger/access-log", traegerViewHTTP.AccessLogRouteContracts()},
		{"/traeger/reports", traegerViewHTTP.ReportRouteContracts()},
		{"/traeger/holiday-periods", enrollmentHTTP.HolidayPeriodRouteContracts()},
		{"/traeger/holiday-closures", enrollmentHTTP.HolidayClosureRouteContracts()},
		{"/traeger/holiday-closures/pending", holidayClosureHTTP.TraegerRouteContracts()},
		{"/traeger/closing-days", calendarAPI.TraegerClosingDayRouteContracts()},
		// Enrollment renders the registration a rebooking answers.
		{"/traeger/holiday-contributions", parentBillingHTTP.HolidayRouteContracts(enrollmentOwner.HolidayRegistrationDetail{})},
		{"/traeger/required-details", parentBillingHTTP.RequiredDetailsRouteContracts()},
		{"/traeger/export-recipient", exportTransferHTTP.RecipientRouteContracts()},
		{"/traeger/settings", settingsHTTP.TraegerRouteContracts(configModels.SettingsSchema{})},
		{"/traeger/catalog", traegerCatalogHTTP.RouteContracts()},
	}
}

// ContractDocument builds the model of the frontend/backend contract from
// the typed registrations of every owner (ADR 0270). The mounts repeat the

// parentPortalRouteContracts registers the guardians' routes below /parent.
// Enrollment renders the form load and submission (parentEnrollmentForms
// binds it) and Care Contract the contract to sign
// (NewParentContractDocuments), so their types are named here.
func parentPortalRouteContracts() []common.RouteContract {
	return parentAPI.PortalRouteContracts(parentAPI.ForeignContractTypes{
		EnrollmentBootstrap:     enrollmentHTTP.PublicEnrollmentFormBootstrapResponse{},
		EnrollmentSubmitRequest: enrollmentHTTP.SubmitEnrollmentRequest{},
		EnrollmentSubmit:        enrollmentHTTP.SubmitEnrollmentResponse{},
		ContractSigning:         carecontract.SigningView{},
	})
}

// staffPortalContractMounts lists the staff portal's routes that left their
// pass-through route files in #2352.
func staffPortalContractMounts() []contractMount {
	return []contractMount{
		{"/api/surveys", announcementAPI.SurveyRouteContracts()},
		{"/api/messages", parentMessagingAPI.RouteContracts()},
		{"/api/guardians", guardianRouteContracts()},
		{"/api/files", filestoreAPI.RouteContracts()},
		{"/api/enrollment/phases", enrollmentHTTP.PhaseRouteContracts()},
		{"/api/holiday-closure-notices", holidayClosureHTTP.SchoolRouteContracts()},
		{"/api/rooms", roomsHTTP.RouteContracts()},
		{"/api/traeger-documents", organizationTenancyTraeger.SchoolDocumentRouteContracts()},
		{"/api/meal-caterer", catererPortalHTTP.SchoolRouteContracts()},
		{"/api/class-list-entries", classListEntryRouteContracts()},
		{"/api", schoolSetupRouteContracts()},
		{"/api/staff-pool", workforceTraegerStaff.SchoolPoolRouteContracts()},
		{"/api", mealPlanRouteContracts()},
		{"/api/settings", settingsRouteContracts()},
		// The platform announcements' http role may not import the contract
		// types; the root names their answer.
		{"/api/platform", []common.RouteContract{
			{Method: "GET", Pattern: "/announcements/unread", Portals: []common.PortalScope{common.PortalTenant}, Response: []platformAnnouncementsHTTP.PlatformAnnouncementResponse{}},
			{Method: "POST", Pattern: "/announcements/{id}/dismiss", Portals: []common.PortalScope{common.PortalTenant}, NoData: true},
		}},
		// Delivery's http role may not import the contract types; the report
		// answers no data.
		{"/api/pwa", []common.RouteContract{{Method: "POST", Pattern: "/usage", Portals: []common.PortalScope{common.PortalTenant}, NoData: true}}},
		{"/api/announcement-attachments", filestoreAPI.AnnouncementAttachmentRouteContracts()},
		{"/api/students/change-requests/rss-feed", requestFeedRouteContracts()},
		{"/api/substitutions", substitutionRouteContracts()},
		// The Datenverwaltung hub's counts (#4013), served by the root.
		{"/api/database", []common.RouteContract{{Method: "GET", Pattern: "/stats", Portals: []common.PortalScope{common.PortalTenant}, Response: statsContract.StatsResponse{}}}},
	}
}

// rootContractMounts are the routes the root mounts outside every portal's
// mount (#2352). Each portal's proxy reaches them through its fixed list of
// such paths (frontend/src/lib/contract/catalog-outside-mounts.ts).
func rootContractMounts() []contractMount {
	return []contractMount{
		{"/analytics-consent", meAPI.AnalyticsConsentRouteContracts()},
		// The analytics package writes its envelope without api/common; the
		// root names its answer.
		{"/analytics-policy", []common.RouteContract{{
			Method: "GET", Pattern: "", Portals: []common.PortalScope{common.PortalParent, common.PortalSchool},
			Response: analytics.PolicyResponse{},
		}}},
		{"/parent-news-attachments", filestoreAPI.ParentAnnouncementAttachmentRouteContracts()},
	}
}

// guardianRouteContracts registers the guardian routes of the staff portal,
// with patterns relative to /api/guardians. People Directory's http role may
// not import the contract types, so it hands over the body types only.
func guardianRouteContracts() []common.RouteContract {
	types := guardiansHTTP.RouteContractTypes()
	portals := []common.PortalScope{common.PortalTenant}
	search := []common.QueryParam{{Name: "q", Kind: common.QueryString}, {Name: "page", Kind: common.QueryInt}, {Name: "page_size", Kind: common.QueryInt}}
	deleteQuery := []common.QueryParam{{Name: "force", Kind: common.QueryString}, {Name: "expected_link_ids", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/search", Portals: portals, Query: search, Paginated: true, Response: types.Pickers},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: types.Guardian},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: types.GuardianUpdate, Response: types.Guardian},
		// Without force a guardian still linked to children is refused; the
		// expected links pin the confirmed state of the full delete.
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, Query: deleteQuery, NoData: true},
		{Method: "GET", Pattern: "/{id}/delete-preview", Portals: portals, Response: types.DeletePreview},
		{Method: "POST", Pattern: "/{id}/email-stop", Portals: portals, NoData: true},
		{Method: "DELETE", Pattern: "/{id}/email-stop", Portals: portals, NoData: true},
		{Method: "DELETE", Pattern: "/{id}/email-block", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{id}/payment", Portals: portals, Response: types.PaymentMasked},
		{Method: "PUT", Pattern: "/{id}/payment", Portals: portals, Request: types.PaymentRequest, NoData: true},
		{Method: "POST", Pattern: "/{id}/payment/reveal", Portals: portals, Response: types.PaymentReveal},
		{Method: "GET", Pattern: "/{id}/phone-numbers/", Portals: portals, Response: types.Phones},
		{Method: "POST", Pattern: "/{id}/phone-numbers/", Portals: portals, Request: types.PhoneCreate, Response: types.Phone},
		{Method: "PUT", Pattern: "/{id}/phone-numbers/{phoneId}", Portals: portals, Request: types.PhoneUpdate, Response: types.Phone},
		{Method: "DELETE", Pattern: "/{id}/phone-numbers/{phoneId}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/{id}/phone-numbers/{phoneId}/set-primary", Portals: portals, Response: types.Phone},
		{Method: "POST", Pattern: "/bulk-invite", Portals: portals, Request: types.BulkInviteRequest, Response: types.BulkInvite},
		{Method: "GET", Pattern: "/invitations/pending-approval", Portals: portals, Response: types.Approvals},
		{Method: "GET", Pattern: "/payment-overview", Portals: portals, Response: types.Overview},
		{Method: "PUT", Pattern: "/relationships/{relationshipId}", Portals: portals, Request: types.LinkUpdate, NoData: true},
		{Method: "GET", Pattern: "/students/{studentId}/guardians", Portals: portals, Response: types.WithRelationships},
		{Method: "POST", Pattern: "/students/{studentId}/guardians", Portals: portals, Request: types.LinkRequest, Response: types.Link},
		{Method: "POST", Pattern: "/students/{studentId}/guardians/batch", Portals: portals, Request: types.BatchRequest, NoData: true},
		{Method: "DELETE", Pattern: "/students/{studentId}/guardians/{guardianId}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/students/{studentId}/email-status", Portals: portals, Response: types.EmailStatuses},
		{Method: "POST", Pattern: "/students/{studentId}/invite", Portals: portals, Request: types.InviteRequest, Response: types.Invite},
		{Method: "PUT", Pattern: "/students/{studentId}/payer", Portals: portals, Request: types.PayerRequest, NoData: true},
	}
}

// classListEntryRouteContracts registers the class list entries (#2352),
// with patterns relative to /api/class-list-entries. School Membership's
// http role may not import the contract types.
func classListEntryRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []classListHTTP.ClassListEntryResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: classListHTTP.ClassListEntryRequest{}, Response: classListHTTP.ClassListEntryResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: classListHTTP.ClassListEntryRequest{}, Response: classListHTTP.ClassListEntryResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/{id}/assign", Portals: portals, Request: classListHTTP.ClassListAssignRequest{}, NoData: true},
	}
}

// schoolSetupRouteContracts registers the onboarding wizard of a school
// (#2832) and the first steps of a care worker (#3748), with patterns
// relative to /api. Every write answers the fresh state.
func schoolSetupRouteContracts() []common.RouteContract {
	types := schoolSetupHTTP.RouteContractTypes()
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/school-setup/", Portals: portals, Response: schoolsetup.Status{}},
		{Method: "PUT", Pattern: "/school-setup/steps/{step}", Portals: portals, Request: types.Skip, Response: schoolsetup.Status{}},
		{Method: "POST", Pattern: "/school-setup/complete", Portals: portals, Response: schoolsetup.Status{}},
		{Method: "PUT", Pattern: "/school-setup/dismissal", Portals: portals, Request: types.Dismissal, Response: schoolsetup.Status{}},
		{Method: "GET", Pattern: "/staff-onboarding/", Portals: portals, Response: schoolsetup.StaffStatus{}},
		{Method: "PUT", Pattern: "/staff-onboarding/steps/{step}", Portals: portals, Request: types.StepState, Response: schoolsetup.StaffStatus{}},
		{Method: "PUT", Pattern: "/staff-onboarding/dismissal", Portals: portals, Request: types.Dismissal, Response: schoolsetup.StaffStatus{}},
	}
}

// mealPlanRouteContracts registers the meal plan reads and registrations of
// the staff portal and the Mensa months (#2352), with patterns relative to
// /api. The meal plan's http role may not import the contract types.
func mealPlanRouteContracts() []common.RouteContract {
	types := mealplanHTTP.RouteContractTypes()
	portals := []common.PortalScope{common.PortalTenant}
	window := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	daily := []common.QueryParam{{Name: "date", Kind: common.QueryDate}, {Name: "include", Kind: common.QueryString}}
	week := []common.QueryParam{{Name: "week_start", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/meal-plan/", Portals: portals, Query: week, Response: types.Week},
		{Method: "PUT", Pattern: "/meal-plan/{date}", Portals: portals, Request: types.Day, NoData: true},
		{Method: "DELETE", Pattern: "/meal-plan/{date}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/meal-plan/orders", Portals: portals, Query: window, Response: types.Orders},
		{Method: "GET", Pattern: "/meal-plan/participants", Portals: portals, Query: daily, Response: types.DailyList},
		{Method: "GET", Pattern: "/meal-plan/participants/week", Portals: portals, Query: week, Response: types.WeeklyList},
		{Method: "GET", Pattern: "/meal-plan/participation/{studentId}", Portals: portals, Query: window, Response: types.ChildParticipation},
		{Method: "PUT", Pattern: "/meal-plan/participation/{studentId}/days/{date}", Portals: portals, Request: types.ChildDay, NoData: true},
		{Method: "DELETE", Pattern: "/meal-plan/participation/{studentId}/days/{date}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/meal-plan/participation/{studentId}/schedule", Portals: portals, Request: types.ChildSchedule, Response: types.ScheduleChanged},
		{Method: "GET", Pattern: "/meal-billing-months/", Portals: portals, Response: types.BillingMonths},
		{Method: "GET", Pattern: "/meal-billing-months/{month}", Portals: portals, Response: types.BillingMonth},
		{Method: "POST", Pattern: "/meal-billing-months/{month}/release", Portals: portals, Request: types.BillingMonthRelease, Response: types.BillingMonth},
	}
}

// requestFeedRouteContracts registers the staff's controls of the parent
// request feed, with patterns relative to their mount. Care Plan's feed http
// role may not import the contract types; the public feed document is XML
// and stays outside the contract.
func requestFeedRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: requestFeedHTTP.FeedStatus{}},
		{Method: "POST", Pattern: "/", Portals: portals, Response: requestFeedHTTP.FeedLink{}},
		{Method: "POST", Pattern: "/rotate", Portals: portals, Response: requestFeedHTTP.FeedLink{}},
	}
}

// staffPortalCalendarContractMounts lists the staff calendar, the parent
// messages inbox and the device pages of the staff portal that left their
// pass-through route files in #2352.
func staffPortalCalendarContractMounts() []contractMount {
	portals := []common.PortalScope{common.PortalTenant}
	// Device Fleet's http role may not import the contract types; the root
	// names the device management's answers and bodies. The kiosk's device
	// API (PyrePortal) is not part of this mount and stays unregistered.
	list := []common.QueryParam{
		{Name: "device_type", Kind: common.QueryString},
		{Name: "status", Kind: common.QueryString},
		{Name: "registered_by_id", Kind: common.QueryString},
		{Name: "search", Kind: common.QueryString},
	}
	devices := []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: list, Response: []devicesAPI.DeviceResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: devicesAPI.DeviceRequest{}, Response: devicesAPI.DeviceCreationResponse{}},
		{Method: "GET", Pattern: "/device-slots", Portals: portals, Response: devicesAPI.DeviceSlotsResponse{}},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: devicesAPI.DeviceResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: devicesAPI.DeviceRequest{}, Response: devicesAPI.DeviceResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{id}/history", Portals: portals, Response: []devicesAPI.LifecycleEventResponse{}},
		{Method: "PATCH", Pattern: "/{deviceId}/status", Portals: portals, Request: devicesAPI.DeviceStatusRequest{}, NoData: true},
	}
	return []contractMount{
		{"/api/calendar", calendarAPI.StaffRouteContracts()},
		{"/api/messages", parentMessagingAPI.InboxRouteContracts()},
		{"/api/iot", devices},
	}
}

// staffPortalEnrollmentContractMounts lists the staff portal's enrollment,
// holiday week and holiday guest routes and the guardian invitation
// decisions that left their pass-through route files in #2352.
func staffPortalEnrollmentContractMounts() []contractMount {
	portals := []common.PortalScope{common.PortalTenant}
	return []contractMount{
		{"/api/enrollment", enrollmentHTTP.ConfigRouteContracts()},
		{"/api/enrollment", enrollmentHTTP.AdminRequestRouteContracts()},
		{"/api/enrollment", enrollmentHTTP.AdminReviewRouteContracts()},
		{"/api/holiday-weeks", enrollmentHTTP.HolidayHostRouteContracts()},
		{"/api/holiday-guests", enrollmentHTTP.HolidayGuestRouteContracts()},
		// People Directory's http role may not import the contract types;
		// both decisions answer no data.
		{"/api/guardians", []common.RouteContract{
			{Method: "POST", Pattern: "/invitations/{invitationId}/approve", Portals: portals, NoData: true},
			{Method: "POST", Pattern: "/invitations/{invitationId}/reject", Portals: portals, NoData: true},
		}},
	}
}

// staffPortalAdminContractMounts lists the staff portal's administration
// routes (staff, notices, statistics, groups, users, grade transitions) that
// left their pass-through route files in the closing round of #2352.
func staffPortalAdminContractMounts() []contractMount {
	return []contractMount{
		{"/api/staff", timeTrackingHTTP.StaffAdminWorkflowRouteContracts()},
		{"/api/admin/grade-transitions", gradeTransitionHTTP.RouteContracts()},
		{"/api/staff-notices", timetableHTTP.StaffNoticeRouteContracts()},
		{"/api/statistics", statisticsHTTP.RouteContracts()},
		{"/api/settings", settingsAdminRouteContracts()},
		{"/api/birthdays", birthdaysAPI.RouteContracts()},
		{"/api/feedback", feedbackStudentRouteContracts()},
		{"/api/reminders", reminderRouteContracts()},
		{"/api/staff", staffDirectoryRouteContracts()},
		{"/api/groups", groupsHTTP.RouteContracts()},
		{"/api/users", userRouteContracts()},
	}
}
