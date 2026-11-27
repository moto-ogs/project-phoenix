package care

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// These consumer ports retain only the Care Plan operations used by the workflow.
// The set reads take the children of one school inside its tenant
// transaction; their statement count does not grow with the children.
type ArrivalSchedules interface {
	// GetStudentArrivalExceptionsForDate keys the day exceptions by child; a
	// child without one has no entry.
	GetStudentArrivalExceptionsForDate(ctx context.Context, ids []int64, date calendar.Date) (map[int64]*ArrivalException, error)
	// GetWeeklySchedulesByStudentIDsAndWeekday returns the projected weekly
	// rows of the children for weekday of the current week.
	GetWeeklySchedulesByStudentIDsAndWeekday(ctx context.Context, ids []int64, weekday int) ([]*ArrivalSchedule, error)
	GetStudentArrivalSchedules(ctx context.Context, id int64) ([]*ArrivalSchedule, error)
}
type PickupSchedules interface {
	GetEffectivePickupTimeForDate(ctx context.Context, id int64, date calendar.Date) (*EffectivePickupTime, error)
	// GetBulkEffectivePickupTimesForDate keys the effective pickup of each
	// child on date by child.
	GetBulkEffectivePickupTimesForDate(ctx context.Context, ids []int64, date calendar.Date) (map[int64]*EffectivePickupTime, error)
	GetStudentPickupSchedules(ctx context.Context, id int64) ([]*PickupSchedule, error)
}
type GuardianAbsenceReports interface {
	ReportGuardianAbsence(ctx context.Context, report GuardianAbsenceReport) ([]StudentStatusDay, error)
}
type GuardianPickupExceptions interface {
	WithdrawGuardianPickupException(ctx context.Context, change PickupException) error
}
type ExcusedAbsenceRequests interface {
	EditRequest(ctx context.Context, input ExcusedRequestEditInput) (*ExcusedAbsenceRequest, error)
	ListForStudent(ctx context.Context, id int64, since time.Time) ([]*ExcusedAbsenceRequest, error)
	Submit(ctx context.Context, input ExcusedRequestCreateInput) (*ExcusedAbsenceRequest, error)
}
type CareExceptions interface {
	LockStudentAndExceptionDay(ctx context.Context, id int64, date string) error
	ListPickupExceptions(ctx context.Context, filter StudentScheduleFilter) ([]PickupException, error)
	ListArrivalExceptions(ctx context.Context, filter StudentScheduleFilter) ([]ArrivalException, error)
	ListDepartureExceptions(ctx context.Context, filter StudentScheduleFilter) ([]DepartureException, error)
}
type OfferingChangeRequests interface {
	CatalogAt(ctx context.Context, id int64, date calendar.Date) (*OfferingChangeCatalog, error)
	EarliestEffectiveFrom(ctx context.Context) (calendar.Date, error)
	Edit(ctx context.Context, id int64, input CreateOfferingChangeInput, version string) (*OfferingChangeRequest, error)
	GetForStudent(ctx context.Context, id int64) (*OfferingChangeView, error)
	SubmitOfferingChange(ctx context.Context, input CreateOfferingChangeInput) (*OfferingChangeRequest, error)
	CourseCatalog(ctx context.Context, studentID int64, accountID int64) (*CourseCatalog, error)
	CreateCourseRequest(ctx context.Context, input CreateCourseRequestInput) (*OfferingChangeRequest, error)
	WithdrawCourseRequest(ctx context.Context, studentID int64, accountID int64, offeringID int64) error
}
