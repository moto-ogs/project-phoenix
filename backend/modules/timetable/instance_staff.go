package timetable

import (
	"context"
	"time"
)

type InstanceStaff struct {
	ID            int64
	TenantID      int64
	CreatedAt     time.Time
	UpdatedAt     time.Time
	InstanceID    int64
	StaffID       int64
	RoomID        *int64
	IsPrimary     bool
	IsSubstitute  bool
	IsAbsent      bool
	AbsenceReason *string
	SickAbsenceID *int64
	// Block is the row's block; only InstanceStaffFilter.StaffChangesOnly
	// fills it (#7675).
	Block *InstanceStaffBlock
}

// InstanceStaffBlock is what a staff row's block shows on the day:
// its title and its wall clock, "HH:MM".
type InstanceStaffBlock struct {
	Title     string
	StartTime string
	EndTime   string
}

type InstanceStaffInput struct {
	InstanceID    int64
	StaffID       int64
	RoomID        *int64
	IsPrimary     bool
	IsSubstitute  bool
	IsAbsent      bool
	AbsenceReason *string
	SickAbsenceID *int64
}

type InstanceStaffFilter struct {
	IDs                       []int64
	InstanceIDs               []int64
	StaffIDs                  []int64
	SickAbsenceID             *int64
	Date                      *string
	FromDate                  *string
	ToDate                    *string
	OrderByCreated            bool
	OrderByInstanceAndCreated bool
	OrderByActivityTime       bool
	OrderByActivityDateTime   bool
	// StaffChangesOnly keeps the rows of the blocks of Date that take place
	// and on which a supervisor is marked absent or somebody covers, all
	// rows of such a block, and fills Block, in one statement ("Heute
	// anders", #7675). It requires Date.
	StaffChangesOnly bool
	Limit            int
	Offset           int
}

type InstanceStaffQuery interface {
	FindInstanceStaff(context.Context, int64) (InstanceStaff, error)
	ListInstanceStaff(context.Context, InstanceStaffFilter) ([]InstanceStaff, error)
	CountNonAbsentInstanceStaff(context.Context, []int64) (map[int64]int, error)
}

type InstanceStaffCommand interface {
	CreateInstanceStaff(context.Context, InstanceStaffInput) (InstanceStaff, error)
	UpdateInstanceStaff(context.Context, int64, InstanceStaffInput) (InstanceStaff, error)
	PatchInstanceStaff(context.Context, int64, InstanceStaffInput, []string) (int64, error)
	DeleteInstanceStaff(context.Context, int64) error
	DeleteInstanceStaffByInstance(context.Context, int64) error
	DeleteUpcomingInstanceStaff(context.Context, int64, string) (int64, error)
}

// InstanceStaffLocks takes the staff row locks of the staff members a day
// writer is about to plan, ascending, before the writer locks its first block
// row (#6583, tenant.LockStaffRows). The owner's instance staff capability
// implements it beside InstanceStaffCommand; the owner's own day writers use
// it, so it is not part of the owner facade.
type InstanceStaffLocks interface {
	LockStaffAssignments(context.Context, []int64) error
}

type InstanceStaffCapability interface {
	InstanceStaffQuery
	InstanceStaffCommand
}
