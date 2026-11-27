package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
)

// GuardianAbsenceRecords is the owner persistence a guardian absence report
// needs. Every call joins the caller's tenant transaction.
type GuardianAbsenceRecords interface {
	LockStudentAndExceptionDay(context.Context, int64, string) error
	ListPickupExceptions(context.Context, careplan.StudentScheduleFilter) ([]careplan.PickupException, error)
	UpsertStudentStatusDay(context.Context, careplan.StudentStatusDay) (careplan.StudentStatusDay, error)
	ListStudentStatusDays(context.Context, careplan.StudentStatusDayFilter) ([]careplan.StudentStatusDay, error)
}

// GuardianPickupRecords is the owner persistence of the guardian pickup leg.
type GuardianPickupRecords interface {
	DeletePickupException(context.Context, int64) error
}

// GuardianPickupExcusal couples the guardian pickup leg with the derived
// block excusal. A nil value skips the coupling.
type GuardianPickupExcusal interface {
	ReleaseBeforeDelete(context.Context, *careplan.PickupException) error
}
