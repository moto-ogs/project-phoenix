package workforce

import "context"

// WorkTimeModelCatalog serves the school's catalog page of work-time
// templates (#6891): how many people a template reaches, whether it is still
// offered for new assignments, and the assignment of several people at once
// (#6921).
type WorkTimeModelCatalog interface {
	// WorkTimeModelUsage counts the live staff members bound to each template
	// of the caller's school, the same people a template edit rewrites.
	// Unused templates are absent.
	WorkTimeModelUsage(context.Context) (map[int64]int, error)
	// ArchiveWorkTimeModel stops offering a template for new assignments.
	// Staff already bound to it keep it and its Soll.
	ArchiveWorkTimeModel(context.Context, int64) (WorkTimeModel, error)
	// RestoreWorkTimeModel offers an archived template again.
	RestoreWorkTimeModel(context.Context, int64) (WorkTimeModel, error)
	// StaffWorkTimeFacts tells, for every staff member of the caller's school
	// that has any, the facts an assignment depends on. A member without an
	// entry has no template, no schedule, no Soll of the Träger and no
	// closed month.
	StaffWorkTimeFacts(context.Context) ([]StaffWorkTimeFact, error)
	// AssignWorkTimeModel binds one offered template to several live staff
	// members in one unit of work and writes their new schedule version.
	AssignWorkTimeModel(context.Context, AssignWorkTimeModel) (WorkTimeModelAssignment, error)
}

// MaxWorkTimeModelAssignees caps one assignment request.
const MaxWorkTimeModelAssignees = 500

// StaffWorkTimeFact is what decides whether and from when a template may be
// assigned to one staff member.
type StaffWorkTimeFact struct {
	StaffID int64
	// WorkTimeModelID is the template the member is bound to, if any.
	WorkTimeModelID *int64
	// HasSchedule is true once any schedule version exists. A start before
	// today is then refused: it would change a Soll already priced.
	HasSchedule bool
	// SollKeptByTraeger is true while a contract of the Träger governs the
	// Soll (#4706); the school cannot change it.
	SollKeptByTraeger bool
	// ClosedThrough is the latest closed month (YYYY-MM) or empty. A start
	// must lie after it.
	ClosedThrough string
}

// AssignWorkTimeModel is the input of WorkTimeModelCatalog.AssignWorkTimeModel.
type AssignWorkTimeModel struct {
	ModelID  int64
	StaffIDs []int64
	// ValidFrom is the first day of the new schedule version (YYYY-MM-DD).
	// Empty means today. An earlier day is accepted only for members without
	// any schedule and never inside a closed month.
	ValidFrom string
}

// WorkTimeModelAssignment reports the outcome of an assignment. Both lists
// are ascending.
type WorkTimeModelAssignment struct {
	// Assigned are the members now bound to the template.
	Assigned []int64
	// Unchanged were bound to it before; their schedule stays as it is.
	Unchanged []int64
	// ValidFrom is the first day of the written schedule versions.
	ValidFrom string
}
