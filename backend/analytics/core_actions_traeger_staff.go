package analytics

import (
	"fmt"
	"net/http"
)

// traegerStaffCoreActions classifies the writing routes of the staff records
// of a Träger (#4705) and their Nachweise (#4707). They belong to the
// Träger, not to a school, so like the other Träger-Portal routes they count
// for no school yet. init merges the table into coreActions.
var traegerStaffCoreActions = map[RouteKey]CoreAction{
	{http.MethodPost, "/traeger/staff-records/"}:                      notCaptured,
	{http.MethodPost, "/traeger/staff-records/link-preview"}:          notCaptured,
	{http.MethodDelete, "/traeger/staff-records/{id}"}:                notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/personnel-number"}:  notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/financial/reveal"}: notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/financial"}:         notCaptured,
	// The Nachweise of the records (#4707).
	{http.MethodPost, "/traeger/staff-proofs/types"}:                   notCaptured,
	{http.MethodPut, "/traeger/staff-proofs/types/{id}"}:               notCaptured,
	{http.MethodPut, "/traeger/staff-proofs/school-kinds"}:             notCaptured,
	{http.MethodPut, "/traeger/staff-proofs/records/{id}/{typeId}"}:    notCaptured,
	{http.MethodDelete, "/traeger/staff-proofs/records/{id}/{typeId}"}: notCaptured,
	// The Arbeitsverträge of a record (#4706).
	{http.MethodPost, "/traeger/staff-records/{id}/contracts"}:                                                     notCaptured,
	{http.MethodPut, "/traeger/staff-records/{id}/contracts/{contractId}"}:                                         notCaptured,
	{http.MethodDelete, "/traeger/staff-records/{id}/contracts/{contractId}"}:                                      notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/contracts/{contractId}/soll"}:                                   notCaptured,
	{http.MethodPost, "/traeger/staff-records/{id}/contracts/{contractId}/holiday-weeks"}:                          notCaptured,
	{http.MethodDelete, "/traeger/staff-records/{id}/contracts/{contractId}/holiday-weeks/{schoolId}/{weekStart}"}: notCaptured,
}

func init() {
	for key, action := range traegerStaffCoreActions {
		if _, ok := coreActions[key]; ok {
			panic(fmt.Sprintf("analytics: route %s %s classified twice", key.Method, key.Pattern))
		}
		coreActions[key] = action
	}
}
