package presence

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func (rs *Resource) presenceSupervisionResponses(ctx context.Context, filter studentpresence.GroupSupervisionFilter, operation string) ([]SupervisorResponse, error) {
	rows, err := rs.Presence.QueryGroupSupervisions(ctx, filter)
	if err != nil {
		return nil, &presenceError{Op: operation, Err: studentpresence.ErrDatabaseOperation}
	}
	responses := make([]SupervisorResponse, 0, len(rows))
	for _, row := range rows {
		response, err := presenceSupervisionResponse(row, rs.today())
		if err != nil {
			return nil, &presenceError{Op: operation, Err: studentpresence.ErrDatabaseOperation}
		}
		responses = append(responses, response)
	}
	return responses, nil
}

func (rs *Resource) presenceSessionSupervisors(ctx context.Context, groupID int64, today calendar.Date) ([]SupervisorResponse, error) {
	const operation = "GetActiveGroupWithSupervisors"
	groups, err := rs.Presence.ListLiveGroups(ctx, []int64{groupID})
	if err != nil || len(groups) == 0 {
		return nil, &presenceError{Op: operation, Err: studentpresence.ErrGroupNotFound}
	}
	day := today.String()
	return rs.presenceSupervisionResponses(ctx, studentpresence.GroupSupervisionFilter{GroupIDs: []int64{groupID}, ActiveOn: &day}, operation)
}

func presenceSupervisionResponse(row studentpresence.GroupSupervision, today calendar.Date) (SupervisorResponse, error) {
	start, err := calendar.ParseDate(row.StartDate)
	if err != nil {
		return SupervisorResponse{}, err
	}
	isActive := !start.After(today)
	var endTime *time.Time
	if row.EndDate != nil {
		end, err := calendar.ParseDate(*row.EndDate)
		if err != nil {
			return SupervisorResponse{}, err
		}
		at := end.UTCMidnight()
		endTime = &at
		isActive = isActive && today.Before(end)
	}
	return SupervisorResponse{
		ID: row.ID, StaffID: row.StaffID, ActiveGroupID: row.GroupID,
		StartTime: start.UTCMidnight(), EndTime: endTime, IsActive: isActive,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}, nil
}

func (rs *Resource) presenceSupervisor(ctx context.Context, id int64) (SupervisorResponse, error) {
	const operation = "GetGroupSupervisor"
	rows, err := rs.presenceSupervisionResponses(ctx, studentpresence.GroupSupervisionFilter{IDs: []int64{id}}, operation)
	if err != nil || len(rows) == 0 {
		return SupervisorResponse{}, &presenceError{Op: operation, Err: studentpresence.ErrGroupSupervisorNotFound}
	}
	return rows[0], nil
}
