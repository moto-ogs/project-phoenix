package timetracking

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// What became of the absence request mails (#7058). Both are reads of their
// own, so the request lists keep their query budgets and the cards can ask
// for the status of the rows they show.

// maxAbsenceMailIDs bounds one read; the request lists show fewer rows.
const maxAbsenceMailIDs = 200

// AbsenceDecisionMailsResponse maps an absence ID to the outcome of the newest
// mail that told the applicant about a decision or a question. An absence
// without such a mail is absent.
type AbsenceDecisionMailsResponse struct {
	AwaitingFeedback bool                `json:"awaiting_feedback"`
	Absences         map[ident.ID]string `json:"absences"`
}

// AbsenceRequestMailsResponse maps an absence ID to the mails of its latest
// notice to the approvers, counted by outcome. An absence without a notice
// mail is absent.
type AbsenceRequestMailsResponse struct {
	AwaitingFeedback bool                        `json:"awaiting_feedback"`
	Absences         map[ident.ID]map[string]int `json:"absences"`
}

// getAbsenceDecisionMails handles GET /api/staff/absences/mails?ids=1,2: the
// Leitung's view of the mails it sent the applicants. vacation:approve reads
// every request of the school, so the IDs need no further check; Delivery
// answers inside the tenant only.
func (rs *StaffAdminResource) getAbsenceDecisionMails(w http.ResponseWriter, r *http.Request) {
	ids, err := parseAbsenceMailIDs(strings.Join(r.URL.Query()["ids"], ","))
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	mails, active, err := rs.absenceMails.AbsenceDecisionMails(r.Context(), ids)
	if err != nil {
		rs.logger.Error("failed to read absence decision mails", "error", err.Error())
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	out := AbsenceDecisionMailsResponse{AwaitingFeedback: active, Absences: make(map[ident.ID]string, len(mails))}
	for id, outcome := range mails {
		out.Absences[ident.ID(id)] = outcome
	}
	common.Respond(w, r, http.StatusOK, out, "Absence mails retrieved")
}

// getOwnAbsenceRequestMails handles GET /api/time-tracking/absences/mails:
// for the caller's requests still waiting for a decision, whether the
// approvers got the notice by mail. The requests come from the caller's own
// absences, never from the request.
func (rs *Resource) getOwnAbsenceRequestMails(w http.ResponseWriter, r *http.Request) {
	staffID, err := rs.getStaffIDFromClaims(r.Context(), rs.identity(r.Context()))
	if err != nil {
		common.RenderError(w, r, ownStaffError(err))
		return
	}
	waiting, err := rs.StaffAbsenceService.ListAbsences(r.Context(), staffID, workforce.StaffAbsenceListFilter{Status: workforce.AbsenceStatusRequested})
	if err != nil {
		common.RenderError(w, r, classifyAbsenceError(err))
		return
	}
	ids := make([]int64, 0, len(waiting))
	for _, absence := range waiting {
		if absence != nil {
			ids = append(ids, absence.ID.Int64())
		}
	}
	mails, active, err := rs.absenceMails.AbsenceRequestMails(r.Context(), ids)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	out := AbsenceRequestMailsResponse{AwaitingFeedback: active, Absences: make(map[ident.ID]map[string]int, len(mails))}
	for id, counts := range mails {
		out.Absences[ident.ID(id)] = counts
	}
	common.Respond(w, r, http.StatusOK, out, "Absence mails retrieved")
}

// mountOwnAbsenceMailRoutes adds whether the Leitung got the notice of a
// waiting request by mail; without the mail status the route stays away.
func (rs *Resource) mountOwnAbsenceMailRoutes(r chi.Router, withTx common.Middleware) {
	if rs.absenceMails != nil {
		r.With(common.RequiresPermission(permissions.TimeTrackingOwn), withTx).Get("/absences/mails", rs.getOwnAbsenceRequestMails)
	}
}

// parseAbsenceMailIDs reads a comma-separated list of positive absence IDs.
func parseAbsenceMailIDs(raw string) ([]int64, error) {
	ids := []int64{}
	seen := map[int64]bool{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.ParseInt(part, 10, 64)
		if err != nil || id <= 0 {
			return nil, errors.New("ids must be positive absence IDs")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) > maxAbsenceMailIDs {
		return nil, errors.New("too many absence IDs")
	}
	return ids, nil
}
