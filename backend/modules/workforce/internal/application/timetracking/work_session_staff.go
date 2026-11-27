package timetracking

import (
	"context"
)

type WorkSessionStaffName struct {
	FirstName string
	LastName  string
}

type WorkSessionStaff interface {
	StaffScheduleQuery
	StaffNames(context.Context, []int64) (map[int64]WorkSessionStaffName, error)
	// BindSchedule persists the work time model and rotation anchor of the
	// staff member.
	BindSchedule(context.Context, StaffScheduleBinding) error
}

// TimeTrackingManagerStaff keeps, of the given staff members, those whose
// active account holds the right to manage the working time of others in
// this school (#8024). The terminal-only stamping rule exempts them. The root
// binds it to the permission model: roles combine, so one managing role
// suffices, a role name never decides, and a staff member without an active
// account manages nothing.
type TimeTrackingManagerStaff interface {
	FindTimeTrackingManagerStaffIDs(ctx context.Context, staffIDs []int64) (map[int64]bool, error)
}

// ExternalCaregiverStaff tells whether a staff member is an external
// caregiver (#3823), with or without an account (#4573). Externals record no
// working time, so starting a supervision opens no work session for them.
// The root binds it to School Membership's rule.
type ExternalCaregiverStaff interface {
	IsExternalCaregiver(ctx context.Context, staffID int64) (bool, error)
}
