package presence

import (
	"context"
	"errors"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type PresenceQueries interface {
	QueryGroupSupervisions(context.Context, studentpresence.GroupSupervisionFilter) ([]studentpresence.GroupSupervision, error)
	QueryLiveGroups(context.Context, studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error)
	ListLiveGroups(context.Context, []int64) ([]studentpresence.LiveGroup, error)
	ListVisits(context.Context, studentpresence.VisitFilter) ([]studentpresence.Visit, error)
}

func (rs *Resource) listPresenceLiveGroups(ctx context.Context, filter studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error) {
	rows, err := rs.Presence.QueryLiveGroups(ctx, filter)
	if err != nil {
		return nil, &presenceError{Op: "ListActiveGroups", Err: fmt.Errorf("list failed: %w", err)}
	}
	return rows, nil
}

func presenceQueryError(operation string, err error) error {
	if err == nil {
		return nil
	}
	cause := studentpresence.ErrDatabaseOperation
	if errors.Is(err, studentpresence.ErrVisitNotFound) {
		cause = studentpresence.ErrVisitNotFound
	}
	return &presenceError{Op: operation, Err: cause}
}

func newPresenceVisitResponse(visit studentpresence.Visit) VisitResponse {
	return VisitResponse{
		ID: ident.ID(visit.ID), StudentID: ident.ID(visit.StudentID), ActiveGroupID: ident.ID(visit.ActiveGroupID),
		CheckInTime: visit.EntryTime, CheckOutTime: visit.ExitTime, IsActive: visit.ExitTime == nil,
		CreatedAt: visit.CreatedAt, UpdatedAt: visit.UpdatedAt,
	}
}

// readableVisitFilter bounds completed visit reads even before the nightly job
// has run. A failed setting lookup returns no history, not a permissive default.
func (rs *Resource) readableVisitFilter(ctx context.Context, filter studentpresence.VisitFilter) (studentpresence.VisitFilter, error) {
	if filter.OpenOnly {
		return filter, nil
	}
	if rs.SettingsService == nil {
		return filter, errors.New("attendance log settings are required")
	}
	enabled, err := rs.SettingsService.ResolveBool(ctx, "gdpr.attendance_log_enabled")
	if err != nil {
		return filter, err
	}
	if !enabled {
		cutoff := rs.today().BerlinMidnight()
		filter.ClosedSince = &cutoff
	}
	return filter, nil
}

func (rs *Resource) listReadableVisits(ctx context.Context, filter studentpresence.VisitFilter) ([]studentpresence.Visit, error) {
	filter, err := rs.readableVisitFilter(ctx, filter)
	if err != nil {
		return nil, err
	}
	return rs.Presence.ListVisits(ctx, filter)
}
