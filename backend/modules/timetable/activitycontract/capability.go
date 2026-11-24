package activitycontract

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/timetable"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ActivityService defines operations for activity management
type ActivityService interface {
	CategoryOperations
	GroupOperations
	ScheduleOperations
	SupervisorOperations
	EnrollmentOperations
	timetable.OccupancyQuery
}

type CategoryOperations interface {
	// Category operations
	CreateCategory(ctx context.Context, category *Category) (*Category, error)
	ListCategories(ctx context.Context) ([]*Category, error)
	// CategoryUsageCounts reports how many activity groups reference each
	// category, keyed by category id, for the Stammdaten management screen
	// (#2131). Separate from listing: the aggregate is an extra scan only
	// that screen needs.
	CategoryUsageCounts(ctx context.Context) (map[int64]int, error)
	// UpdateCategory renames a non-system, non-archived category.
	UpdateCategory(ctx context.Context, id int64, input CategoryInput) (*Category, error)
	// ArchiveCategory retires a category without deleting it, so existing
	// Termine and Aktivitäten keep resolving it.
	ArchiveCategory(ctx context.Context, id int64) (*Category, error)
	// RestoreCategory un-archives a category.
	RestoreCategory(ctx context.Context, id int64) (*Category, error)
	// SetCategoryShiftTypeLinks maps categories to a Dienstplan shift type and
	// clears the mapping on de-selected ones (#1837 follow-up). expected holds
	// the link token per category the caller read (ADR 0311); see
	// timetable.CategoryCommand.
	SetCategoryShiftTypeLinks(ctx context.Context, shiftTypeID int64, categoryIDs []int64, expected map[int64]string) error
}

type GroupOperations interface {
	// Activity Group operations
	CreateGroup(ctx context.Context, group *Group, supervisorIDs []int64, schedules []*Schedule) (*Group, error)
	GetGroup(ctx context.Context, id int64) (*Group, error)
	UpdateGroup(ctx context.Context, group *Group, requestingStaffID int64, hasManagePermission bool) (*Group, error)
	// UpdateGroupWithDetails applies an edit to the group fields and, where
	// the edit names them, the supervisor set and the schedules, as one
	// failing-together unit; run inside a tenant tx so a partial failure
	// rolls everything back (issue #575 B10). It refuses an edit whose
	// ExpectedVersion is not the stored GroupVersion with
	// readstate.ErrChanged (ADR 0311).
	UpdateGroupWithDetails(ctx context.Context, edit GroupEdit, requestingStaffID int64, hasManagePermission bool) (*Group, error)
	DeleteGroup(ctx context.Context, id int64, requestingStaffID int64, hasManagePermission bool) error
	ListGroups(ctx context.Context, query *GroupListQuery) ([]*Group, error)
	GetGroupWithDetails(ctx context.Context, id int64) (*Group, []*SupervisorPlanned, []*Schedule, error)
	GetGroupsWithEnrollmentCounts(ctx context.Context) ([]*Group, map[int64]int, error)
	FindByCategory(ctx context.Context, categoryID int64) ([]*Group, error)

	// Permission check - returns true if user can modify (edit/delete) the activity
	// User can modify if: they created it, they are a supervisor, or they have manage permission
	CanModifyActivity(ctx context.Context, groupID int64, staffID int64, hasManagePermission bool) (bool, error)
}

type ScheduleOperations interface {
	// Schedule operations
	AddSchedule(ctx context.Context, groupID int64, schedule *Schedule) (*Schedule, error)
	DeleteSchedule(ctx context.Context, id int64) error
}

type SupervisorOperations interface {
	// Supervisor operations
	AddSupervisor(ctx context.Context, groupID int64, staffID int64, isPrimary bool) (*SupervisorPlanned, error)
	GetSupervisor(ctx context.Context, id int64) (*SupervisorPlanned, error)
	GetGroupSupervisors(ctx context.Context, groupID int64) ([]*SupervisorPlanned, error)
	GetSupervisorsForGroups(ctx context.Context, groupIDs []int64) (map[int64][]*SupervisorPlanned, error)
	DeleteSupervisor(ctx context.Context, id int64) error
	UpdateGroupSupervisors(ctx context.Context, groupID int64, staffIDs []int64) error
	ReplaceSupervisor(ctx context.Context, activityID, supervisorID int64, replacementStaffID *int64) error
}

type EnrollmentOperations interface {
	// Enrollment operations
	EnrollStudent(ctx context.Context, groupID, studentID int64) error
	UnenrollStudent(ctx context.Context, groupID, studentID int64) error
	UpdateGroupEnrollments(ctx context.Context, groupID int64, studentIDs []int64) error
	GetEnrolledStudents(ctx context.Context, groupID int64) ([]*timetable.OperationStudent, error)
	// GetEnrollmentCounts counts the children on each roster, each once, with
	// the same visibility and reader failures as GetEnrolledStudents, in the
	// supplied group order.
	GetEnrollmentCounts(ctx context.Context, groupIDs []int64) (map[int64]int, error)
	GetStudentEnrollments(ctx context.Context, studentID int64) ([]*Group, error)
	GetActiveStudentEnrollmentsByStudentIDs(ctx context.Context, studentIDs []int64, onDate calendar.Date) (map[int64][]*Group, error)
}
