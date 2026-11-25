package parent

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

type FamilyStartResponse struct {
	Day   calendar.Date             `json:"day"`
	Cards []FamilyStartCardResponse `json:"cards"`
}

type FamilyStartCardResponse struct {
	// Separates cached partial reads across changes to a guardian relationship.
	AccessVersion string                 `json:"access_version"`
	Child         ChildResponse          `json:"child"`
	Features      *ChildFeaturesResponse `json:"features"`
	Today         *TodayStatusResponse   `json:"today"`
}

func (rs *Resource) familyStart(w http.ResponseWriter, r *http.Request) {
	accountID, ok := rs.parentAccountID(w, r)
	if !ok {
		return
	}
	var studentID *int64
	if values, provided := r.URL.Query()["student_id"]; provided {
		id, valid := parsePositiveID(values[0])
		if !valid || len(values) != 1 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("student_id must be a positive identifier")))
			return
		}
		studentID = &id
	}
	family, err := rs.ParentService.FamilyStart(r.Context(), accountID, studentID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	out := FamilyStartResponse{Day: family.Day, Cards: make([]FamilyStartCardResponse, 0, len(family.Cards))}
	for _, card := range family.Cards {
		item := FamilyStartCardResponse{
			Child:         toChildResponse(card.Child, family.Day),
			AccessVersion: readstate.Fingerprint(card.Child.GuardianPermissions),
		}
		if card.Features != nil {
			flags := toChildFeaturesResponse(*card.Features)
			item.Features = &flags
		}
		if card.Today != nil {
			today := toTodayStatusResponse(card.Today)
			item.Today = &today
		}
		out.Cards = append(out.Cards, item)
	}
	w.Header().Set("Cache-Control", "private, no-store")
	common.Respond(w, r, http.StatusOK, out, "Family start retrieved")
}
