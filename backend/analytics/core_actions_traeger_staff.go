package analytics

import (
	"fmt"
	"net/http"
)

// traegerStaffCoreActions classifies the writing routes of the staff records
// of a Träger (#4705), their Nachweise (#4707) and the Personal-Import
// (#4724) and the Vertretungspool (#4709). They belong to the
// Träger, not to a school, so like the other Träger-Portal routes they count
// for no school yet. init merges the table into coreActions.
var traegerStaffCoreActions = map[RouteKey]CoreAction{
	{http.MethodPost, "/traeger/staff-records/"}:                     notCaptured,
	{http.MethodPost, "/traeger/staff-records/link-preview"}:         notCaptured,
	{http.MethodPost, "/traeger/staff-records/hire"}:                 notCaptured,
	{http.MethodDelete, "/traeger/staff-records/{id}"}:               notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/personnel-number"}: notCaptured,
	// The personnel number with another employer (#8041).
	{http.MethodPut, "/traeger/staff-records/{id}/employer-numbers/{schoolId}"}: notCaptured,
	// The payroll values of another employer (#8041).
	{http.MethodPut, "/traeger/staff-exports/payroll/employers/{schoolId}"}: notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/person"}:                  notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/financial/reveal"}:       notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/financial"}:               notCaptured,
	// The Nachweise of the records (#4707).
	{http.MethodPost, "/traeger/staff-proofs/types"}:                   notCaptured,
	{http.MethodPut, "/traeger/staff-proofs/types/{id}"}:               notCaptured,
	{http.MethodPut, "/traeger/staff-proofs/school-kinds"}:             notCaptured,
	{http.MethodPut, "/traeger/staff-proofs/records/{id}/{typeId}"}:    notCaptured,
	{http.MethodDelete, "/traeger/staff-proofs/records/{id}/{typeId}"}: notCaptured,
	// The Abwesenheitsarten and Kontingente of the Träger (#4710).
	{http.MethodPost, "/traeger/absence-types/"}:                              notCaptured,
	{http.MethodPut, "/traeger/absence-types/{id}"}:                           notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/absence-accounts/{typeId}"}: notCaptured,
	// The Arbeitsverträge of a record (#4706).
	{http.MethodPost, "/traeger/staff-records/{id}/contracts"}:                                                     notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/contracts/{contractId}"}:                                         notCaptured,
	{http.MethodDelete, "/traeger/staff-records/{id}/contracts/{contractId}"}:                                      notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/contracts/{contractId}/soll"}:                                   notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/contracts/{contractId}/holiday-weeks"}:                          notCaptured,
	{http.MethodDelete, "/traeger/staff-records/{id}/contracts/{contractId}/holiday-weeks/{schoolId}/{weekStart}"}: notCaptured,
	// The Personal-Import (#4724).
	{http.MethodPost, "/traeger/staff-record-imports/"}:        notCaptured,
	{http.MethodPost, "/traeger/staff-record-imports/preview"}: notCaptured,
	// The Einsatzplanung over all Einsatzorte (#4708).
	{http.MethodPost, "/traeger/staff-planning/records/{id}/shifts"}:                                notCaptured,
	{http.MethodPut, "/traeger/staff-planning/records/{id}/shifts/{shiftId}"}:                       notCaptured,
	{http.MethodDelete, "/traeger/staff-planning/records/{id}/schools/{schoolId}/shifts/{shiftId}"}: notCaptured,
	// The Monatsabschluss of the Stundenkonto (#4711).
	{http.MethodPost, "/traeger/staff-records/{id}/time-account/close"}:  notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/time-account/reopen"}: notCaptured,
	// The Vertretungspool (#4709): the Personalverwaltung lifts a block;
	// a school blocks a Springer, the core action of the pool, and lifts
	// its own block.
	{http.MethodDelete, "/traeger/staff-pool/blocks/{id}"}: notCaptured,
	{http.MethodPost, "/api/staff-pool/blocks"}:            event("springer_blocked"),
	{http.MethodDelete, "/api/staff-pool/blocks/{id}"}:     notCaptured,
}

func init() {
	for key, action := range traegerStaffCoreActions {
		if _, ok := coreActions[key]; ok {
			panic(fmt.Sprintf("analytics: route %s %s classified twice", key.Method, key.Pattern))
		}
		coreActions[key] = action
	}
}
