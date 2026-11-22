package supervisiondashboard

import (
	"context"
	"fmt"
)

// applyClassHandovers marks the children of the dashboard the Lehrkraft
// handed over today (#4794): the open visits, the released rooms and the
// planned blocks' rosters. Like sick and excused it needs users:read.
func (s *service) applyClassHandovers(ctx context.Context, projection *DashboardProjection, caller Caller, day Date) error {
	if s.deps.Handovers == nil || !caller.CanReadStudents {
		return nil
	}
	ids := handoverCandidateIDs(projection)
	if len(ids) == 0 {
		return nil
	}
	handovers, err := s.deps.Handovers.ClassHandovers(ctx, ids, day)
	if err != nil {
		return fmt.Errorf("load class handovers: %w", err)
	}
	if len(handovers) == 0 {
		return nil
	}
	mark := func(studentID int64) *SupervisionClassHandover {
		if handover, ok := handovers[studentID]; ok {
			return &handover
		}
		return nil
	}
	for i := range projection.Visits {
		projection.Visits[i].ClassHandover = mark(projection.Visits[i].StudentID.Int64())
	}
	for i := range projection.OpenRooms {
		for j := range projection.OpenRooms[i].Students {
			visit := &projection.OpenRooms[i].Students[j].Visit
			visit.ClassHandover = mark(visit.StudentID.Int64())
		}
	}
	for i := range projection.PlannedNow {
		for j := range projection.PlannedNow[i].RosterPreview {
			row := &projection.PlannedNow[i].RosterPreview[j]
			row.ClassHandover = mark(row.StudentID.Int64())
		}
	}
	return nil
}

// handoverCandidateIDs is the union of the children the dashboard shows.
func handoverCandidateIDs(projection *DashboardProjection) []int64 {
	seen := map[int64]bool{}
	var ids []int64
	add := func(id int64) {
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, visit := range projection.Visits {
		add(visit.StudentID.Int64())
	}
	for _, room := range projection.OpenRooms {
		for _, student := range room.Students {
			add(student.StudentID.Int64())
		}
	}
	for _, instance := range projection.PlannedNow {
		for _, row := range instance.RosterPreview {
			add(row.StudentID.Int64())
		}
	}
	return ids
}
