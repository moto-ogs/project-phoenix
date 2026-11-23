package workforce

import "context"

// StaffDay is what changes the staff of a day (#7903): the absences with plan
// effect (reported or approved) that overlap it and the group handovers that
// cover it, each ordered by ID.
type StaffDay struct {
	Absences  []StaffAbsence
	Handovers []GroupSubstitution
}

// StaffDayReads reads a day's StaffDay in one statement, in the caller's
// tenant transaction. It is the read of "Heute anders" (ADR 0299): the same
// rows ListStaffAbsences and ListGroupSubstitutions return for the day. The
// work-time composition serves it.
type StaffDayReads interface {
	StaffDay(ctx context.Context, day string) (StaffDay, error)
}
