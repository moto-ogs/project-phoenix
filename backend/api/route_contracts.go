package api

import (
	"fmt"
	"reflect"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/contract"
	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	careStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/careplan/http"
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
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	presenceStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/studentpresence/http"
	timetableHTTP "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	traegerPortalHTTP "github.com/moto-ogs/project-phoenix/modules/traegerportal"
	traegerViewHTTP "github.com/moto-ogs/project-phoenix/modules/traegerview/http"
	workforceModule "github.com/moto-ogs/project-phoenix/modules/workforce"
	absencetypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
	staffShiftsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/staffshifts"
	timeTrackingHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/timetracking"
	workforceTraegerStaff "github.com/moto-ogs/project-phoenix/modules/workforce/http/traegerstaff"
	worktimemodelsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/worktimemodels"
	catererPortalHTTP "github.com/moto-ogs/project-phoenix/workflows/catererportal/http"
	holidayClosureHTTP "github.com/moto-ogs/project-phoenix/workflows/holidayclosurenotification/http"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
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
	catalog, err := RouteCatalog()
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(catalog))
	for _, route := range catalog {
		known[route.Method+" "+route.Pattern] = true
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
	options := contract.Legacy(map[reflect.Type]string{
		reflect.TypeFor[common.ID]():     contract.KindID,
		reflect.TypeFor[common.JSONID](): contract.KindLaxID,
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
	}
	// Appointments keeps its own day type.
	options.Dates = []reflect.Type{reflect.TypeFor[appointments.Date]()}
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
	return []common.RouteContract{{
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
