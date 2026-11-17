package contract

import "reflect"

// Options are the two legacy registers of ADR 0270. Both only shrink: an
// entry leaves when its route is migrated, and Build fails on an entry that
// no registration uses.
type Options struct {
	// NumericIDs lists the identifier fields that existing routes still send
	// as JSON numbers, as "package.Type.GoField". Every other int64 on a
	// registered type must be a common.ID. On a request type the entry is a
	// field Go reads only as a JSON number.
	NumericIDs []string
	// QueryVariants lists the routes whose response shape a query parameter
	// selects, as "METHOD /pattern".
	QueryVariants []string
	// Identifiers maps the Go identifier types to KindID or KindLaxID. The
	// root names them, so this package stays free of the HTTP packages.
	Identifiers map[reflect.Type]string
	// Readers says what the own UnmarshalJSON of a request type reads:
	// ReadsFields or ReadsLaxIDs. A request type with its own UnmarshalJSON
	// and no entry stops the generator; the root names them like the
	// identifier types.
	Readers map[reflect.Type]string
}

const (
	// ReadsFields: the reader takes the fields as encoding/json would.
	ReadsFields = "fields"
	// ReadsLaxIDs: as ReadsFields, and every int64 field takes a JSON number
	// or a decimal string.
	ReadsLaxIDs = "lax_ids"
)

// Registration is one route as the root hands it over: the owner's
// common.RouteContract with its full pattern.
type Registration struct {
	Method           string
	Pattern          string
	Portals          []string
	Query            []QueryParam
	Request          any
	Response         any
	Paginated        bool
	NoData           bool
	Variants         *VariantSpec
	Enums            []EnumSpec
	Deprecated       bool
	DeprecatedFields []string
}

// VariantSpec is a response whose shape a query parameter selects.
type VariantSpec struct {
	QueryParam string
	Default    string
	ByValue    map[string]any
}

// EnumSpec names a closed set of string values by Go type or by field.
type EnumSpec struct {
	Name   string
	Type   any
	Fields []string
	Values []string
}

// Legacy returns the registers of the routes registered today, with the
// identifier types the root names.
func Legacy(identifiers map[reflect.Type]string) Options {
	return Options{
		Identifiers: identifiers,
		NumericIDs: []string{
			"careplanhttp.StudentRequest.GroupID",
			"careplanhttp.UpdateStudentRequest.GroupID",
			"notifications.feedEntryResponse.ID",
			"organizationtenancy.TraegerBankAccount.ID",
			"organizationtenancy.TraegerDocumentGroup.ID",
			"organizationtenancy.TraegerDocumentRelease.GroupID",
			"organizationtenancy.TraegerDocumentRelease.ID",
			"organizationtenancy.TraegerDocumentRelease.SchoolID",
			"organizationtenancy.TraegerDocumentReleaseInput.GroupID",
			"organizationtenancy.TraegerDocumentReleaseInput.SchoolID",
			"organizationtenancy.TraegerDocumentSchool.ID",
			"organizationtenancy.TraegerReportDistrict.SchoolID",
			"organizationtenancy.TraegerReportTemplate.ID",
			"traeger.ReportDistrictRequest.SchoolID",
			"peopledirectory.NewStudentGuardian.GuardianProfileID",
			"presenceprojectionhttp.NameStudentResponse.ID",
			"presenceprojectionhttp.SlimStudentResponse.CompanionStudentIDs",
			"presenceprojectionhttp.SlimStudentResponse.GroupID",
			"presenceprojectionhttp.SlimStudentResponse.ID",
			"presenceprojectionhttp.StudentResponse.CompanionStudentIDs",
			"presenceprojectionhttp.StudentResponse.GroupID",
			"presenceprojectionhttp.StudentResponse.ID",
			"presenceprojectionhttp.StudentResponse.PersonID",
			"presenceprojectionhttp.StudentResponse.PhotoConsentGivenBy",
			"presenceprojectionhttp.SupervisorContact.ID",
		},
		QueryVariants: []string{"GET /api/students/"},
	}
}
