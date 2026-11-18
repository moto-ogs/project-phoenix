package api

import (
	"fmt"
	"reflect"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/contract"
	"github.com/moto-ogs/project-phoenix/modules/appointments"
	careStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/careplan/http"
	"github.com/moto-ogs/project-phoenix/modules/classday"
	classdayHTTP "github.com/moto-ogs/project-phoenix/modules/classday/http"
	announcementAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/parentannouncements"
	staffMessagingAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/staffmessages"
	notificationsHTTP "github.com/moto-ogs/project-phoenix/modules/delivery/http/notifications"
	provisioningOperatorAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	organizationTenancyTraeger "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/traeger"
	parentBillingHTTP "github.com/moto-ogs/project-phoenix/modules/parentbilling/http"
	projectionStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	calendarAPI "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/http"
	timetableHTTP "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	workforceModule "github.com/moto-ogs/project-phoenix/modules/workforce"
	absencetypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
	staffShiftsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/staffshifts"
	timeTrackingHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/timetracking"
	workforceTraegerStaff "github.com/moto-ogs/project-phoenix/modules/workforce/http/traegerstaff"
	worktimemodelsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/worktimemodels"
	catererPortalHTTP "github.com/moto-ogs/project-phoenix/workflows/catererportal/http"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// contractRegistrations lists every typed registration under its mount and
// refuses one the route catalog does not know.
func contractRegistrations() ([]contract.Registration, error) {
	mounts := []struct {
		prefix string
		routes []common.RouteContract
	}{
		{"/api/students", projectionStudentsHTTP.StudentRouteContracts()},
		// The projection renders the answer of Care Plan's student writes
		// (studentHTTPResources binds it), so its type is named here.
		{"/api/students", careStudentsHTTP.StudentWriteContracts(projectionStudentsHTTP.StudentResponse{})},
		{"/parent", parentAPI.MeRouteContracts()},
		{"/api/notifications", notificationRouteContracts(common.PortalTenant)},
		{"/school/class-day", classdayHTTP.RouteContracts()},
		{"/school/notifications", notificationRouteContracts(common.PortalSchool)},
		{"/api/parent-announcements", announcementAPI.RouteContracts(common.PortalTenant)},
		{"/school/parent-letters", announcementAPI.RouteContracts(common.PortalSchool)},
		{"/api/staff-messages", staffMessagingAPI.RouteContracts(common.PortalTenant)},
		{"/api/time-tracking", timeTrackingRouteContracts()},
		{"/api/work-time-models", worktimemodelsHTTP.RouteContracts()},
		// Class Day owns the child sheet the supervision route answers with.
		{"/school/calendar", calendarAPI.SchoolRouteContracts()},
		{"/api/timetable", timetableHTTP.RouteContracts()},
		{"/school/supervisions", timetableHTTP.SchoolSupervisionRouteContracts(classday.SupervisionStudentSheet{})},
		{"/school/staff-messages", staffMessagingAPI.RouteContracts(common.PortalSchool)},
		{"/operator/billing", provisioningOperatorAPI.BillingRouteContracts()},
		{"/operator/devices", provisioningOperatorAPI.DeviceRouteContracts()},
		{"/traeger/master-data", organizationTenancyTraeger.MasterDataRouteContracts()},
		{"/traeger/documents", organizationTenancyTraeger.DocumentRouteContracts()},
		{"/traeger/report-templates", organizationTenancyTraeger.ReportTemplateRouteContracts()},
		{"/traeger/billing-families", parentBillingHTTP.BillingFamilyRouteContracts()},
		{"/traeger/notifications", schoolFeedRouteContracts(common.PortalTraeger)},
		{"/traeger/staff-records", workforceTraegerStaff.RecordRouteContracts()},
		{"/caterer", catererPortalHTTP.RouteContracts()},
		{"/caterer/notifications", schoolFeedRouteContracts(common.PortalCaterer)},
	}
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
