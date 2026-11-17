package api

import (
	"fmt"
	"reflect"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/api/contract"
	careStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/careplan/http"
	staffMessagingAPI "github.com/moto-ogs/project-phoenix/modules/communication/http/staffmessages"
	notificationsHTTP "github.com/moto-ogs/project-phoenix/modules/delivery/http/notifications"
	provisioningOperatorAPI "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/inbound/operator"
	parentBillingHTTP "github.com/moto-ogs/project-phoenix/modules/parentbilling/http"
	projectionStudentsHTTP "github.com/moto-ogs/project-phoenix/modules/presenceprojection/http"
	catererPortalHTTP "github.com/moto-ogs/project-phoenix/workflows/catererportal/http"
	parentAPI "github.com/moto-ogs/project-phoenix/workflows/parentportal/http"
)

// ContractDocument builds the model of the frontend/backend contract from
// the typed registrations of every owner (ADR 0270). The mounts repeat the
// ones in the serve mounts; the catalog check fails when they drift apart.
func ContractDocument() (contract.Document, error) {
	mounts := []struct {
		prefix string
		routes []common.RouteContract
	}{
		{"/api/students", projectionStudentsHTTP.StudentRouteContracts()},
		// The projection renders the answer of Care Plan's student writes
		// (studentHTTPResources binds it), so its type is named here.
		{"/api/students", careStudentsHTTP.StudentWriteContracts(projectionStudentsHTTP.StudentResponse{})},
		{"/parent", parentAPI.MeRouteContracts()},
		{"/api/notifications", notificationFeedRouteContracts(common.PortalTenant)},
		{"/school/notifications", notificationFeedRouteContracts(common.PortalSchool)},
		{"/school/staff-messages", staffMessagingAPI.SchoolRouteContracts()},
		{"/operator/billing", provisioningOperatorAPI.BillingRouteContracts()},
		{"/traeger/billing-families", parentBillingHTTP.BillingFamilyRouteContracts()},
		{"/caterer", catererPortalHTTP.RouteContracts()},
	}
	catalog, err := RouteCatalog()
	if err != nil {
		return contract.Document{}, err
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
				return contract.Document{}, fmt.Errorf("typed route %s %s is not in the route catalog", registration.Method, registration.Pattern)
			}
			registrations = append(registrations, registration)
		}
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
	}
	return contract.Build(registrations, options)
}

// notificationFeedRouteContracts registers the notification feed, with
// patterns relative to the /notifications mount of the portal. The staff
// portal and moto schule mount the same routes. Delivery's http role may not
// import the contract types, so it hands over the response type only.
func notificationFeedRouteContracts(portal common.PortalScope) []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/feed/unread-count",
			Portals:  []common.PortalScope{portal},
			Response: notificationsHTTP.FeedUnreadCountContract(),
		},
	}
}

func contractRegistration(prefix string, route common.RouteContract) contract.Registration {
	registration := contract.Registration{
		Method: route.Method, Pattern: prefix + route.Pattern,
		Request: route.Request, Response: route.Response, Paginated: route.Paginated,
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
