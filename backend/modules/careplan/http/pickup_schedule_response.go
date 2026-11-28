package careplanhttp

import (
	context "context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"

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
	if err := rs.addPickupOrigins(ctx, studentID, data.Exceptions, response.Exceptions); err != nil {
		return PickupDataResponse{}, err
	}
	response.DepartureExceptions, response.PickupPersons, err = rs.listDayPickups(ctx, studentID, "", "", false)
	if err != nil {
		return PickupDataResponse{}, err
	}
	return response, nil
}

// addPickupOrigins names, at each pickup time approved from a parent
// request, that request and who approved it (#8209). The approver is read
// from the request, so the day follows a later change of the request; a time
// whose request is gone or no longer approved shows no origin. responses
// holds the mapped exceptions in the order of exceptions.
func (rs *Resource) addPickupOrigins(ctx context.Context, studentID int64, exceptions []*careplan.PickupException, responses []PickupExceptionResponse) error {
	requestIDs := make([]int64, 0, len(exceptions))
	for _, exception := range exceptions {
		if exception.SourceRequestID != nil {
			requestIDs = append(requestIDs, *exception.SourceRequestID)
		}
	}
	if len(requestIDs) == 0 {
		return nil
	}
	origins, err := rs.CareRequestReviews.PickupOrigins(ctx, studentID, requestIDs)
	if err != nil {
		return fmt.Errorf("schedule: read origins of pickup times: %w", err)
	}
	for i, exception := range exceptions {
		if exception.SourceRequestID == nil {
			continue
		}
		origin, found := origins[*exception.SourceRequestID]
		if !found {
			continue
		}
		response := &PickupExceptionOriginResponse{RequestID: ident.ID(origin.RequestID), ApprovedByName: origin.ApprovedByName}
		if origin.ApprovedAt != nil {
			approvedAt := origin.ApprovedAt.Format(time.RFC3339)
			response.ApprovedAt = &approvedAt
		}
		responses[i].Origin = response
	}
	return nil
}
