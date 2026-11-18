package traegerviewhttp

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// The projection's lists and reports are exported through the shared list
// export of the Träger-Portal (common.ListTable, #4718).

// exportSchool reads the optional school of an export (school=ID). Zero
// means every school of the Träger.
func exportSchool(r *http.Request) (int64, error) {
	raw := r.URL.Query().Get("school")
	if raw == "" {
		return 0, nil
	}
	schoolID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || schoolID <= 0 {
		return 0, errors.New("school must be a positive ID")
	}
	return schoolID, nil
}

// readExportOptions reads format and school of an export and answers 400
// for an invalid one.
func readExportOptions(w http.ResponseWriter, r *http.Request) (string, int64, bool) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return "", 0, false
	}
	schoolID, err := exportSchool(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return "", 0, false
	}
	return format, schoolID, true
}

// renderSchoolNotFound answers a school of another Träger and an unknown ID
// alike, so the export reveals no school.
func renderSchoolNotFound(w http.ResponseWriter, r *http.Request) {
	common.RenderError(w, r, common.ErrorNotFoundWithCode(traegerview.ErrSchoolOutsideTraeger, common.CodeTraegerSchoolNotFound))
}
