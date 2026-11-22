package carecontracthttp

import (
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The correction of the modules imported contracts book (#7764). The preview
// and the correction take the same multipart form as the import: the file,
// the day the corrections hold from and, for the correction, the fingerprint
// of the confirmed preview. The owner opens its units itself, so the routes
// carry no transaction.

// correctOfferings serves the preview of a correction file and, with apply,
// the correction itself.
func (rs *ImportResource) correctOfferings(apply bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reviewer, ok := reviewerOf(w, r)
		if !ok {
			return
		}
		request, err := offeringCorrectionRequestOf(w, r)
		if err != nil {
			renderImportError(w, r, err)
			return
		}
		request.Apply = apply
		result, err := rs.imports.CorrectOfferings(r.Context(), reviewer, request)
		if err != nil {
			renderImportError(w, r, err)
			return
		}
		status := http.StatusOK
		if apply {
			status = http.StatusCreated
		}
		common.Respond(w, r, status, result, "Offering correction read")
	}
}

// offeringCorrectionRequestOf reads the upload of a correction and the day
// it holds from.
func offeringCorrectionRequestOf(w http.ResponseWriter, r *http.Request) (carecontract.OfferingCorrectionRequest, error) {
	upload, err := readImportUpload(w, r)
	if err != nil {
		return carecontract.OfferingCorrectionRequest{}, err
	}
	day, err := calendar.ParseDate(r.FormValue("effective_from"))
	if err != nil {
		return carecontract.OfferingCorrectionRequest{}, &carecontract.ValidationError{Fields: map[string]string{"effective_from": "invalid"}}
	}
	return carecontract.OfferingCorrectionRequest{Content: upload.content, FileName: upload.fileName,
		Delimiter: r.FormValue("delimiter"), Fingerprint: r.FormValue("fingerprint"), EffectiveFrom: day}, nil
}
