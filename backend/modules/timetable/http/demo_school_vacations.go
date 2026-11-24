package timetablehttp

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// maxDemoSchoolVacationsBytes bounds one request; the seed sends four windows.
const maxDemoSchoolVacationsBytes = 64 << 10

// DemoSchoolVacationsRequest names the vacation windows the public demo's
// seeder stores for every federal state.
type DemoSchoolVacationsRequest struct {
	Vacations []schoolcalendar.SchoolVacation `json:"vacations"`
}

// DemoSchoolVacationsResponse reports how many rows the seed stored.
type DemoSchoolVacationsResponse struct {
	Stored int `json:"stored"`
}

// DemoSchoolVacationsHandler lets the public demo's seeder store fixed
// vacations, so the Betreuungsplan of a fresh demo school shows its vacation
// hint (ADR 0298). The root mounts it on the operator routes under
// APP_ENV=demo only. The vacations belong to no school: the seed writes every
// state in its own administrative transaction.
func DemoSchoolVacationsHandler(seed schoolcalendar.SchoolVacationSeed) http.HandlerFunc {
	if seed == nil {
		panic("school calendar http: the demo school vacations need the vacation seed")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body DemoSchoolVacationsRequest
		decoder := wire.NewObjectDecoder(http.MaxBytesReader(w, r.Body, maxDemoSchoolVacationsBytes))
		if err := decoder.Decode(&body); err != nil {
			common.RenderError(w, r, common.OperatorInvalidRequest(fmt.Errorf("invalid school vacations: %w", err)))
			return
		}
		if len(body.Vacations) == 0 {
			common.RenderError(w, r, common.OperatorInvalidRequest(errors.New("vacations are required")))
			return
		}
		stored, err := seed.SeedSchoolVacations(r.Context(), body.Vacations)
		if errors.Is(err, schoolcalendar.ErrInvalidSchoolVacationWindow) {
			common.RenderError(w, r, common.OperatorInvalidRequest(err))
			return
		}
		if err != nil {
			common.RenderError(w, r, common.ErrorInternalServerWrap("Schulferien konnten nicht angelegt werden", err))
			return
		}
		common.Respond(w, r, http.StatusCreated, DemoSchoolVacationsResponse{Stored: stored}, "School vacations seeded")
	}
}
