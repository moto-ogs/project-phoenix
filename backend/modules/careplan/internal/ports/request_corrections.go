package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/carerequests"
)

type RequestCorrectionRecords interface {
	Find(context.Context, int64, bool) (carerequests.Request, error)
	Redecide(context.Context, int64, string, *string, int64, bool) error
	FindException(context.Context, int64) (*careplan.PickupException, error)
	DeleteException(context.Context, int64) error
	FindDepartureException(context.Context, int64) (*careplan.DepartureException, error)
	DeleteDepartureException(context.Context, int64) error
	// FindPickupNote locks the note and returns nil when it is gone.
	FindPickupNote(context.Context, int64) (*careplan.PickupNote, error)
	DeletePickupNote(context.Context, int64) error
	// ListDayPickups and DeleteApprovedPickupPerson take back the day's
	// pickup person an approval wrote (#8162).
	ListDayPickups(ctx context.Context, from, to calendar.Date, studentIDs []int64) ([]careplan.DayPickup, error)
	DeleteApprovedPickupPerson(ctx context.Context, studentID int64, date calendar.Date, id int64) (bool, error)
}

type RequestCorrectionEvent struct {
	Type    string
	Payload map[string]any
}

type RequestCorrectionEffects interface {
	CorrectionHistory(context.Context, *carerequests.Request) ([]RequestCorrectionEvent, error)
	RecordCorrection(context.Context, *carerequests.Request, int64, map[string]any) error
	NotifyCorrection(context.Context, *carerequests.Request, int64, bool, string) error
}

type RequestCorrectionPeople interface {
	LockStudent(context.Context, int64) (careplan.ReviewStudent, error)
	CanReview(context.Context, careplan.ReviewStudent) (bool, error)
}

type RequestCorrectionPlans interface {
	ApplyPickup(context.Context, *carerequests.Request, *string, bool) (carerequests.PickupApplied, error)
	ApplyPickupPermission(context.Context, *carerequests.Request) error
	RevertPickupPermission(context.Context, *carerequests.Request) error
}

// RequestCorrectionExcusal releases the attendance still owned by a pickup
// exception before the correction deletes it in the same transaction.
type RequestCorrectionExcusal interface {
	ReleaseBeforeDelete(context.Context, *careplan.PickupException) error
}
