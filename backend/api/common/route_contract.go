package common

// PortalScope names a portal whose proxy may reach a route. The value is the
// scope claim of that portal's session token.
type PortalScope string

const (
	// PortalTenant is the school staff portal.
	PortalTenant PortalScope = "tenant"
	// PortalParent is the guardians' portal, across every school of a guardian.
	PortalParent PortalScope = "parent"
	// PortalSchool is moto schule, the teachers' portal of one school.
	PortalSchool PortalScope = "school"
	// PortalTraeger is the Träger-Portal, bound to a Träger and no school.
	PortalTraeger PortalScope = "org"
	// PortalCaterer is the caterer portal, bound to no school.
	PortalCaterer PortalScope = "caterer"
	// PortalOperator is the operator portal of the moto team.
	PortalOperator PortalScope = "platform"
)

// RouteContract is the typed registration of one route (ADR 0270): what the
// route catalog's METHOD /pattern line does not say. The owner's http role
// declares it with a pattern relative to its mount; the root adds the mount
// and checks the result against the catalog.
type RouteContract struct {
	Method  string
	Pattern string
	// Portals lists every portal that may reach the route.
	Portals []PortalScope
	// Query lists every query parameter the handler reads.
	Query []QueryParam
	// Request is a zero value of the bound body type; nil without a body.
	Request any
	// Response is a zero value of the type rendered as the envelope's data.
	Response any
	// Paginated says the route answers through RespondPaginated.
	Paginated bool
	// Variants replaces Response on a legacy route whose query selects the
	// response shape. New routes may not use it.
	Variants *ResponseVariants
	// Enums names the closed value sets of this route's types.
	Enums []EnumContract
	// Deprecated announces the removal of the route one release ahead.
	Deprecated bool
	// DeprecatedFields announces the removal of fields one release ahead, as
	// "GoType.json_name".
	DeprecatedFields []string
}

// QueryKind is the value form of a query parameter.
type QueryKind string

const (
	QueryString QueryKind = "string"
	QueryInt    QueryKind = "int"
	QueryBool   QueryKind = "bool"
	QueryDate   QueryKind = "date"
	QueryID     QueryKind = "id"
)

// QueryParam is one query parameter a handler reads.
type QueryParam struct {
	Name string
	Kind QueryKind
	// Repeated says the handler reads every occurrence of the key.
	Repeated bool
	// Values closes a string parameter to these values.
	Values []string
}

// ResponseVariants describes a response whose shape a query parameter
// selects. The payload carries no discriminator.
type ResponseVariants struct {
	QueryParam string
	Default    string
	ByValue    map[string]any
}

// EnumContract names a closed set of string values. Reflection cannot see
// constants, so the owner states them. Type is a zero value of a named string
// type; Fields names plain string fields as "GoType.json_name".
type EnumContract struct {
	Name   string
	Type   any
	Fields []string
	Values []string
}
