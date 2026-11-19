package traegerstaff

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// IDResponse names the record or type a write touched.
type IDResponse struct {
	ID int64 `json:"id"`
}

// PersonnelNumberRequest is the body PUT /{id}/personnel-number reads: the
// key is required, null clears the number. The handler reads the raw value
// to tell an absent key from null; this type states the wire form.
type PersonnelNumberRequest struct {
	PersonnelNumber *string `json:"personnel_number"`
}

// RecordRouteContracts registers the typed contract of the staff records
// (ADR 0270), with patterns relative to /traeger/staff-records. The export
// answers a file (#2352).
func RecordRouteContracts() []common.RouteContract {
	month := []common.QueryParam{{Name: "year", Kind: common.QueryInt}, {Name: "month", Kind: common.QueryInt}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: workforce.TraegerStaffOverview{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: []common.QueryParam{common.ListFormatQuery}, File: true},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: StaffLinkRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "POST", Pattern: "/link-preview", Portals: traegerPortal, Request: StaffLinkRequest{}, Response: workforce.TraegerStaffLinkPreview{}},
		{Method: "POST", Pattern: "/hire", Portals: traegerPortal, Request: HireRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "GET", Pattern: "/{id}", Portals: traegerPortal, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: traegerPortal, Response: IDResponse{}},
		{Method: "PUT", Pattern: "/{id}/personnel-number", Portals: traegerPortal, Request: PersonnelNumberRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "PUT", Pattern: "/{id}/person", Portals: traegerPortal, Request: PersonRequest{}, NoData: true},
		{Method: "GET", Pattern: "/{id}/financial", Portals: traegerPortal, Response: workforce.TraegerStaffFinancial{}},
		{Method: "POST", Pattern: "/{id}/financial/reveal", Portals: traegerPortal, Response: workforce.TraegerStaffFinancial{}},
		{Method: "PUT", Pattern: "/{id}/financial", Portals: traegerPortal, Request: StaffFinancialRequest{}, Response: IDResponse{}},
		{Method: "POST", Pattern: "/{id}/contracts", Portals: traegerPortal, Request: CreateContractRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "PUT", Pattern: "/{id}/contracts/{contractId}", Portals: traegerPortal, Request: UpdateContractRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "DELETE", Pattern: "/{id}/contracts/{contractId}", Portals: traegerPortal, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "POST", Pattern: "/{id}/contracts/{contractId}/soll", Portals: traegerPortal, Request: ContractSollRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "POST", Pattern: "/{id}/contracts/{contractId}/holiday-weeks", Portals: traegerPortal, Request: HolidayWeeksRequest{}, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "DELETE", Pattern: "/{id}/contracts/{contractId}/holiday-weeks/{schoolId}/{weekStart}", Portals: traegerPortal, Response: workforce.TraegerStaffRecordDetail{}},
		{Method: "GET", Pattern: "/{id}/absence-accounts", Portals: traegerPortal, Query: []common.QueryParam{{Name: "year", Kind: common.QueryInt}}, Response: workforce.TraegerAbsenceAccounts{}},
		{Method: "PUT", Pattern: "/{id}/absence-accounts/{typeId}", Portals: traegerPortal, Request: AbsenceAllowanceRequest{}, Response: IDResponse{}},
		{Method: "GET", Pattern: "/{id}/time-account", Portals: traegerPortal, Query: month, Response: workforce.TraegerTimeAccount{}},
		{Method: "POST", Pattern: "/{id}/time-account/close", Portals: traegerPortal, Request: TimeAccountMonthRequest{}, Response: workforce.TraegerTimeAccount{}},
		{Method: "POST", Pattern: "/{id}/time-account/reopen", Portals: traegerPortal, Request: TimeAccountMonthRequest{}, Response: workforce.TraegerTimeAccount{}},
	}
}

// ReleaseRouteContracts registers the operator's release „Personal beim
// Träger“ (ADR 0270, #2352), relative to the
// /operator/organizations/{id}/staff-release mount.
func ReleaseRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "", Portals: operator, Response: workforce.TraegerStaffReleaseState{}},
		{Method: "POST", Pattern: "", Portals: operator, Request: grantRequest{}, Response: workforce.TraegerStaffRelease{}},
		{Method: "DELETE", Pattern: "", Portals: operator, Response: withdrawnReleaseResponse{}},
	}
}

// AbsenceTypeRouteContracts registers the absence types of the Träger, with
// patterns relative to /traeger/absence-types.
func AbsenceTypeRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: workforce.TraegerAbsenceTypeList{}},
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: AbsenceTypeRequest{}, Response: workforce.TraegerAbsenceType{}},
		{Method: "PUT", Pattern: "/{id}", Portals: traegerPortal, Request: AbsenceTypeRequest{}, Response: workforce.TraegerAbsenceType{}},
	}
}

// ProofRouteContracts registers the staff proofs, with patterns relative to
// /traeger/staff-proofs. The export answers a file.
func ProofRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: workforce.TraegerStaffProofList{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: []common.QueryParam{common.ListFormatQuery}, File: true},
		{Method: "GET", Pattern: "/types", Portals: traegerPortal, Response: []workforce.TraegerStaffProofType{}},
		{Method: "POST", Pattern: "/types", Portals: traegerPortal, Request: ProofTypeRequest{}, Response: workforce.TraegerStaffProofType{}},
		{Method: "PUT", Pattern: "/types/{id}", Portals: traegerPortal, Request: ProofTypeRequest{}, Response: workforce.TraegerStaffProofType{}},
		{Method: "GET", Pattern: "/school-kinds", Portals: traegerPortal, Response: []workforce.TraegerSchoolProofKinds{}},
		{Method: "PUT", Pattern: "/school-kinds", Portals: traegerPortal, Request: ProofMappingRequest{}, Response: []workforce.TraegerSchoolProofKinds{}},
		{Method: "PUT", Pattern: "/records/{id}/{typeId}", Portals: traegerPortal, Request: ProofRequest{}, Response: []workforce.TraegerStaffProof{}},
		{Method: "DELETE", Pattern: "/records/{id}/{typeId}", Portals: traegerPortal, Response: []workforce.TraegerStaffProof{}},
	}
}

// PlanningRouteContracts registers the staff planning across schools, with
// patterns relative to /traeger/staff-planning. The export answers a file.
func PlanningRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: weekQuery, Response: workforce.TraegerPlanningWeek{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: weekExportQuery, File: true},
		{Method: "GET", Pattern: "/future-shifts", Portals: traegerPortal, Response: []workforce.TraegerFutureShifts{}},
		{Method: "POST", Pattern: "/records/{id}/shifts", Portals: traegerPortal, Request: PlanShiftRequest{}, Response: workforce.TraegerPlanningShift{}},
		{Method: "PUT", Pattern: "/records/{id}/shifts/{shiftId}", Portals: traegerPortal, Request: PlanShiftRequest{}, Response: workforce.TraegerPlanningShift{}},
		{Method: "DELETE", Pattern: "/records/{id}/schools/{schoolId}/shifts/{shiftId}", Portals: traegerPortal, NoData: true},
	}
}

// PoolRouteContracts registers the Träger's view of the substitute pool,
// with patterns relative to /traeger/staff-pool. The export answers a file.
func PoolRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: weekQuery, Response: workforce.PoolWeek{}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: weekExportQuery, File: true},
		{Method: "DELETE", Pattern: "/blocks/{id}", Portals: traegerPortal, NoData: true},
	}
}

// ExportRouteContracts registers the checks before the payroll and time
// exports and the files themselves (#2352), with patterns relative to
// /traeger/staff-exports.
func ExportRouteContracts() []common.RouteContract {
	month := []common.QueryParam{{Name: "year", Kind: common.QueryInt}, {Name: "month", Kind: common.QueryInt}, {Name: "format", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/payroll", Portals: traegerPortal, Query: month, Response: workforce.TraegerPayrollReport{}},
		{Method: "GET", Pattern: "/payroll/export", Portals: traegerPortal, Query: month, File: true},
		{Method: "GET", Pattern: "/times", Portals: traegerPortal, Query: month, Response: workforce.TraegerTimeReport{}},
		{Method: "GET", Pattern: "/times/export", Portals: traegerPortal, Query: month, File: true},
	}
}

var (
	weekQuery       = []common.QueryParam{{Name: "week", Kind: common.QueryDate}}
	weekExportQuery = []common.QueryParam{{Name: "week", Kind: common.QueryDate}, common.ListFormatQuery}
)
