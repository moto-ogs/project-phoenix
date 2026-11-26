package careplanhttp

import (
	context "context"

	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
)

// buildPickupDataResponse converts service pickup data to API response.
func buildPickupDataResponse(data *careplan.StudentPickupData) PickupDataResponse {
	response := PickupDataResponse{
		Schedules:          make([]PickupScheduleResponse, 0, len(data.Schedules)),
		EffectiveSchedules: make([]DatedPickupScheduleResponse, 0, len(data.EffectiveSchedules)),
		Exceptions:         make([]PickupExceptionResponse, 0, len(data.Exceptions)),
		Notes:              make([]PickupNoteResponse, 0, len(data.Notes)),
	}

	for _, s := range data.Schedules {
		response.Schedules = append(response.Schedules, mapScheduleToResponse(s))
	}
	for _, e := range data.Exceptions {
		response.Exceptions = append(response.Exceptions, mapExceptionToResponse(e))
	}
	for _, dated := range data.EffectiveSchedules {
		var scheduleResponse *PickupScheduleResponse
		if dated.Schedule != nil {
			mapped := mapScheduleToResponse(dated.Schedule)
			scheduleResponse = &mapped
		}
		var offeringResponse *PickupScheduleResponse
		if dated.OfferingSchedule != nil {
			mapped := mapScheduleToResponse(dated.OfferingSchedule)
			offeringResponse = &mapped
		}
		response.EffectiveSchedules = append(response.EffectiveSchedules, DatedPickupScheduleResponse{
			Date: dated.Date.String(), Schedule: scheduleResponse, OfferingSchedule: offeringResponse,
		})
	}
	for _, n := range data.Notes {
		response.Notes = append(response.Notes, mapNoteToResponse(n))
	}

	return response
}

// pickupDataResponse adds the current and future day values to the base
// pickup data, as every write response returns the same view as its GET.
func (rs *Resource) pickupDataResponse(ctx context.Context, studentID int64) (PickupDataResponse, error) {
	data, err := rs.PickupScheduleService.GetStudentPickupData(ctx, studentID)
	if err != nil {
		return PickupDataResponse{}, err
	}
	response := buildPickupDataResponse(data)
	response.DepartureExceptions, response.PickupPersons, err = rs.listDayPickups(ctx, studentID, "", "", false)
	if err != nil {
		return PickupDataResponse{}, err
	}
	return response, nil
}
