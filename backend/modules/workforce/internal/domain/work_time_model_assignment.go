package domain

import (
	"fmt"
	"slices"
)

// StaffWorkTimeFact is what decides whether and from when a template may be
// assigned to one staff member (#6921).
type StaffWorkTimeFact struct {
	StaffID           int64
	WorkTimeModelID   *int64
	HasSchedule       bool
	SollKeptByTraeger bool
	// ClosedThrough is the latest closed, not reopened month (YYYY-MM).
	ClosedThrough string
}

// NormalizeAssignees validates the requested staff IDs of an assignment and
// returns them ascending and without duplicates, the order the per-staff
// locks are taken in.
func NormalizeAssignees(staffIDs []int64, limit int) ([]int64, error) {
	if len(staffIDs) == 0 {
		return nil, invalid("staff_ids must name at least one staff member")
	}
	for _, id := range staffIDs {
		if id <= 0 {
			return nil, invalid("staff_ids must be positive")
		}
	}
	ids := slices.Compact(slices.Sorted(slices.Values(staffIDs)))
	if len(ids) > limit {
		return nil, invalid("staff_ids must name at most %d staff members", limit)
	}
	return ids, nil
}

// AssignmentVersionStart is the first day of the schedule versions a template
// assignment writes for the given staff members. It applies the rule of a
// single replaced schedule (ScheduleVersionStart) to each of them: an earlier
// day only for members without any schedule, never inside a closed month. The
// whole assignment fails when one member does not allow the day, so the
// school never ends up with a half-applied start.
func AssignmentVersionStart(validFrom, today string, staffIDs []int64, history map[int64]bool, closed []*StaffMonthBalanceSnapshot) (string, error) {
	if validFrom == "" || validFrom == today {
		return today, nil
	}
	closedByStaff := make(map[int64][]*StaffMonthBalanceSnapshot, len(staffIDs))
	for _, snapshot := range closed {
		if snapshot != nil {
			closedByStaff[snapshot.StaffID.Int64()] = append(closedByStaff[snapshot.StaffID.Int64()], snapshot)
		}
	}
	for _, staffID := range staffIDs {
		if _, err := ScheduleVersionStart(validFrom, today, history[staffID], closedByStaff[staffID]); err != nil {
			return "", fmt.Errorf("staff member %d: %w", staffID, err)
		}
	}
	return validFrom, nil
}
