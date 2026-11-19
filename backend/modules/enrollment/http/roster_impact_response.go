package enrollmenthttp

import (
	"strconv"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// enrollmentRosterImpactResponse is the wire form of a booking change's effect on the
// child's Regeltermine (#5102). Weekdays are ISO (1 = Monday); template IDs
// travel as strings like every other ID.
type enrollmentRosterImpactResponse struct {
	EffectiveFrom string                                     `json:"effective_from"`
	Adjusted      []enrollmentAdjustedRosterTemplateResponse `json:"adjusted"`
	NotAdjusted   []enrollmentManualRosterTemplateResponse   `json:"not_adjusted"`
	// PickupOverrides are weekdays whose stored staff pickup time hides the
	// booked pickup time; the office can reset them to the booking.
	PickupOverrides []enrollmentPickupOverrideResponse `json:"pickup_overrides"`
}

type enrollmentPickupOverrideResponse struct {
	Weekday    int    `json:"weekday"`
	Date       string `json:"date"`
	StoredTime string `json:"stored_time"`
	BookedTime string `json:"booked_time"`
	// ResetNow: „Gebuchte Zeiten übernehmen“ may remove the stored time now.
	ResetNow bool `json:"reset_now"`
}

type enrollmentAdjustedRosterTemplateResponse struct {
	TemplateID      string `json:"template_id"`
	Name            string `json:"name"`
	RemovedWeekdays []int  `json:"removed_weekdays"`
	AddedWeekdays   []int  `json:"added_weekdays"`
}

type enrollmentManualRosterTemplateResponse struct {
	TemplateID string `json:"template_id"`
	Name       string `json:"name"`
	Weekdays   []int  `json:"weekdays"`
	ViaTarget  bool   `json:"via_target"`
	// Until is the day a later booking carries the Regeltermin again
	// (exclusive, #5497); null when none does. "Entfernen" ends there.
	Until *string `json:"until"`
}

func newRosterImpactResponse(impact RosterImpact) enrollmentRosterImpactResponse {
	out := enrollmentRosterImpactResponse{
		EffectiveFrom:   impact.EffectiveFrom.String(),
		Adjusted:        make([]enrollmentAdjustedRosterTemplateResponse, 0, len(impact.Adjusted)),
		NotAdjusted:     make([]enrollmentManualRosterTemplateResponse, 0, len(impact.NotAdjusted)),
		PickupOverrides: make([]enrollmentPickupOverrideResponse, 0, len(impact.PickupOverrides)),
	}
	for _, override := range impact.PickupOverrides {
		out.PickupOverrides = append(out.PickupOverrides, enrollmentPickupOverrideResponse{
			Weekday: override.Weekday, Date: override.Date.String(), StoredTime: override.StoredTime, BookedTime: override.BookedTime,
			ResetNow: override.ResetNow,
		})
	}
	for _, template := range impact.Adjusted {
		out.Adjusted = append(out.Adjusted, enrollmentAdjustedRosterTemplateResponse{
			TemplateID: strconv.FormatInt(template.TemplateID, 10), Name: template.Name,
			RemovedWeekdays: nonNilWeekdays(template.RemovedWeekdays), AddedWeekdays: nonNilWeekdays(template.AddedWeekdays),
		})
	}
	for _, template := range impact.NotAdjusted {
		response := enrollmentManualRosterTemplateResponse{
			TemplateID: strconv.FormatInt(template.TemplateID, 10), Name: template.Name,
			Weekdays: nonNilWeekdays(template.Weekdays), ViaTarget: template.ViaTarget,
		}
		if template.Until != nil {
			response.Until = new(template.Until.String())
		}
		out.NotAdjusted = append(out.NotAdjusted, response)
	}
	return out
}

func nonNilWeekdays(weekdays []int) []int {
	if weekdays == nil {
		return []int{}
	}
	return weekdays
}

// enrollmentChildRosterImpactResponse is one child's roster impact of an approved
// change request.
type enrollmentChildRosterImpactResponse struct {
	ChildID      string                         `json:"child_id"`
	StudentID    string                         `json:"student_id"`
	FirstName    string                         `json:"first_name"`
	RosterImpact enrollmentRosterImpactResponse `json:"roster_impact"`
}

func newChildRosterImpactResponses(impacts []capability.ChildRosterImpact) []enrollmentChildRosterImpactResponse {
	if len(impacts) == 0 {
		return nil
	}
	out := make([]enrollmentChildRosterImpactResponse, 0, len(impacts))
	for _, impact := range impacts {
		out = append(out, enrollmentChildRosterImpactResponse{
			ChildID: strconv.FormatInt(impact.ChildID, 10), StudentID: strconv.FormatInt(impact.StudentID, 10),
			FirstName: impact.FirstName, RosterImpact: newRosterImpactResponse(impact.Impact),
		})
	}
	return out
}
