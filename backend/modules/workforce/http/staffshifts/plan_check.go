package staffshifts

import (
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// The wire of the working-time check (#4708, ADR 0242): the planner
// confirms the warnings of a write with working_time_confirmed and gives
// working_time_reason where a warning needs one.

// WorkingTimeRequest is the confirmation part of every shift write.
type WorkingTimeRequest struct {
	Confirmed bool   `json:"working_time_confirmed"`
	Reason    string `json:"working_time_reason"`
}

// Confirmation is the capability's shape of the request part.
func (r WorkingTimeRequest) Confirmation() workforce.WorkingTimeConfirmation {
	return workforce.WorkingTimeConfirmation{Confirmed: r.Confirmed, Reason: r.Reason}
}
